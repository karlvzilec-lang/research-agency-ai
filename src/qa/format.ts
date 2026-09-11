export const QA_DIMENSIONS = [
  "strategic_fit",
  "methodology",
  "analytical_depth",
  "commercial_actionability",
  "client_readiness",
  "risk_compliance",
] as const;

export type QADimension = (typeof QA_DIMENSIONS)[number];

export const QA_DIMENSION_LABELS: Record<QADimension, string> = {
  strategic_fit: "Strategic Fit & Client Relevance",
  methodology: "Methodological Rigor",
  analytical_depth: "Analytical Depth & Evidence",
  commercial_actionability: "Commercial Actionability",
  client_readiness: "Client-Readiness & Polish",
  risk_compliance: "Risk, Compliance & Ethics",
};

export const QA_OUTPUT_FORMAT_TEMPLATE = `Respond in EXACTLY this format, nothing before or after it:

VERDICT: PASS or REVISE
SCORES:
- strategic_fit: <1-10>
- methodology: <1-10>
- analytical_depth: <1-10>
- commercial_actionability: <1-10>
- client_readiness: <1-10>
- risk_compliance: <1-10>
OVERALL: <1-10, one decimal ok>
CRITIQUE:
<3-6 sentences. Name the single biggest weakness even on a PASS. Be specific: cite exact claims or gaps, never generic praise or generic complaints.>`;

export interface QAVerdict {
  verdict: "PASS" | "REVISE";
  scores: Partial<Record<QADimension, number>>;
  overallScore: number;
  critique: string;
  /** false if the reviewer's response didn't match the expected format at all. */
  parseOk: boolean;
}

const MIN_PASS_SCORE = 6;

export function parseQAVerdict(raw: string): QAVerdict {
  const verdictMatch = raw.match(/VERDICT:\s*(PASS|REVISE)/i);
  const overallMatch = raw.match(/OVERALL:\s*([\d.]+)/i);
  const critiqueMatch = raw.match(/CRITIQUE:\s*([\s\S]*)/i);

  const scores: Partial<Record<QADimension, number>> = {};
  for (const dim of QA_DIMENSIONS) {
    const m = raw.match(new RegExp(`${dim}\\s*:\\s*([\\d.]+)`, "i"));
    if (m) scores[dim] = Number(m[1]);
  }

  const parseOk = Boolean(verdictMatch);
  const scoreValues = Object.values(scores).filter((n): n is number => typeof n === "number");
  const overallScore = overallMatch
    ? Number(overallMatch[1])
    : scoreValues.length > 0
      ? Math.round((scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length) * 10) / 10
      : 0;

  let verdict: "PASS" | "REVISE" = verdictMatch
    ? (verdictMatch[1].toUpperCase() as "PASS" | "REVISE")
    : "REVISE";

  // Don't trust a self-contradictory PASS riding on a low score — brutal QA
  // doesn't get to grade-inflate itself out of a genuine weak spot.
  if (verdict === "PASS" && overallScore > 0 && overallScore < MIN_PASS_SCORE) {
    verdict = "REVISE";
  }

  return {
    verdict,
    scores,
    overallScore,
    critique: critiqueMatch ? critiqueMatch[1].trim() : raw.trim().slice(0, 1000),
    parseOk,
  };
}
