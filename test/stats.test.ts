import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../src/analysis/loadCsv.js";
import { analyzeDataset, formatDatasetAnalysis } from "../src/analysis/stats.js";

test("parseCsv handles headers, plain fields, and quoted fields with embedded commas", () => {
  const csv = `name,age,note\nAlice,34,"Likes cats, dogs"\nBob,29,fine\n`;
  const rows = parseCsv(csv);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { name: "Alice", age: "34", note: "Likes cats, dogs" });
  assert.deepEqual(rows[1], { name: "Bob", age: "29", note: "fine" });
});

test("analyzeDataset computes real descriptive stats and correlations, no LLM involved", () => {
  const rows = [
    { spend: "10", satisfaction: "3", segment: "A" },
    { spend: "20", satisfaction: "5", segment: "A" },
    { spend: "30", satisfaction: "7", segment: "B" },
    { spend: "40", satisfaction: "9", segment: "B" },
  ];

  const analysis = analyzeDataset(rows);
  assert.equal(analysis.rowCount, 4);

  const spendCol = analysis.columns.find((c) => c.name === "spend");
  assert.equal(spendCol?.type, "numeric");
  assert.equal(spendCol?.numeric?.mean, 25);
  assert.equal(spendCol?.numeric?.min, 10);
  assert.equal(spendCol?.numeric?.max, 40);

  const segmentCol = analysis.columns.find((c) => c.name === "segment");
  assert.equal(segmentCol?.type, "categorical");
  assert.equal(segmentCol?.categorical?.distinctValues, 2);

  // spend and satisfaction are perfectly linearly related here -> r should be ~1
  const corr = analysis.correlations.find(
    (c) => (c.a === "spend" && c.b === "satisfaction") || (c.a === "satisfaction" && c.b === "spend")
  );
  assert.ok(corr);
  assert.ok(corr!.r > 0.99);

  const formatted = formatDatasetAnalysis(analysis);
  assert.match(formatted, /4 rows/);
  assert.match(formatted, /spend/);
});

test("analyzeDataset handles an empty dataset gracefully", () => {
  const analysis = analyzeDataset([]);
  assert.equal(analysis.rowCount, 0);
  assert.equal(formatDatasetAnalysis(analysis), "(empty dataset)");
});
