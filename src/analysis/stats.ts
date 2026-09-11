export interface NumericColumnStats {
  count: number;
  mean: number;
  median: number;
  stdev: number;
  min: number;
  max: number;
}

export interface CategoricalColumnStats {
  count: number;
  distinctValues: number;
  topValues: Array<{ value: string; count: number; pct: number }>;
}

export interface ColumnAnalysis {
  name: string;
  type: "numeric" | "categorical";
  numeric?: NumericColumnStats;
  categorical?: CategoricalColumnStats;
}

export interface CorrelationPair {
  a: string;
  b: string;
  r: number;
}

export interface DatasetAnalysis {
  rowCount: number;
  columns: ColumnAnalysis[];
  correlations: CorrelationPair[];
}

function isNumeric(value: string): boolean {
  if (value.trim() === "") return false;
  return Number.isFinite(Number(value));
}

function mean(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function stdev(nums: number[], m: number): number {
  if (nums.length < 2) return 0;
  const variance = nums.reduce((sum, x) => sum + (x - m) ** 2, 0) / (nums.length - 1);
  return Math.sqrt(variance);
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function pearson(x: number[], y: number[]): number {
  const n = x.length;
  const mx = mean(x);
  const my = mean(y);
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? 0 : num / denom;
}

/**
 * Real, deterministic descriptive statistics + pairwise Pearson correlations
 * on an actual dataset — no LLM involved, no invented numbers. This is what
 * grounds the Data Analyst / Quantitative Researcher in reality when the
 * client supplies real data via `--data`, instead of illustrative filler.
 * A column is treated as numeric if at least 80% of its non-empty values
 * parse as numbers.
 */
export function analyzeDataset(rows: Record<string, string>[]): DatasetAnalysis {
  if (rows.length === 0) {
    return { rowCount: 0, columns: [], correlations: [] };
  }

  const columnNames = Object.keys(rows[0]);
  const columns: ColumnAnalysis[] = [];
  const numericColumns: Record<string, number[]> = {};

  for (const name of columnNames) {
    const values = rows.map((r) => r[name] ?? "").filter((v) => v.trim() !== "");
    const numericCount = values.filter(isNumeric).length;
    const isNumericColumn = values.length > 0 && numericCount / values.length >= 0.8;

    if (isNumericColumn) {
      const nums = values.filter(isNumeric).map(Number);
      const m = mean(nums);
      numericColumns[name] = nums;
      columns.push({
        name,
        type: "numeric",
        numeric: {
          count: nums.length,
          mean: round(m),
          median: round(median(nums)),
          stdev: round(stdev(nums, m)),
          min: round(Math.min(...nums)),
          max: round(Math.max(...nums)),
        },
      });
    } else {
      const freq = new Map<string, number>();
      for (const v of values) freq.set(v, (freq.get(v) ?? 0) + 1);
      const topValues = [...freq.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([value, count]) => ({ value, count, pct: round((count / values.length) * 100) }));
      columns.push({
        name,
        type: "categorical",
        categorical: { count: values.length, distinctValues: freq.size, topValues },
      });
    }
  }

  const correlations: CorrelationPair[] = [];
  const numericNames = Object.keys(numericColumns);
  for (let i = 0; i < numericNames.length; i++) {
    for (let j = i + 1; j < numericNames.length; j++) {
      const a = numericNames[i];
      const b = numericNames[j];
      const xa = numericColumns[a];
      const xb = numericColumns[b];
      const n = Math.min(xa.length, xb.length);
      if (n < 3) continue;
      correlations.push({ a, b, r: round(pearson(xa.slice(0, n), xb.slice(0, n)), 3) });
    }
  }
  correlations.sort((p, q) => Math.abs(q.r) - Math.abs(p.r));

  return { rowCount: rows.length, columns, correlations };
}

export function formatDatasetAnalysis(analysis: DatasetAnalysis): string {
  if (analysis.rowCount === 0) return "(empty dataset)";

  const lines: string[] = [
    `Real dataset supplied: ${analysis.rowCount} rows, ${analysis.columns.length} columns. These are COMPUTED statistics — base your analysis strictly on them, don't invent additional numbers.`,
    "",
    "### Column statistics (computed, not estimated)",
    "",
  ];

  for (const col of analysis.columns) {
    if (col.type === "numeric" && col.numeric) {
      const s = col.numeric;
      lines.push(
        `- **${col.name}** (numeric, n=${s.count}): mean=${s.mean}, median=${s.median}, stdev=${s.stdev}, range=[${s.min}, ${s.max}]`
      );
    } else if (col.categorical) {
      const s = col.categorical;
      const top = s.topValues.map((t) => `${t.value} (${t.pct}%)`).join(", ");
      lines.push(`- **${col.name}** (categorical, ${s.distinctValues} distinct values): top values — ${top}`);
    }
  }

  if (analysis.correlations.length > 0) {
    lines.push("", "### Strongest numeric correlations (Pearson r, computed)", "");
    for (const c of analysis.correlations.slice(0, 10)) {
      lines.push(`- ${c.a} ↔ ${c.b}: r = ${c.r}`);
    }
  }

  return lines.join("\n");
}
