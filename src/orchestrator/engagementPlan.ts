export interface EngagementPlan {
  engagementType: string;
  needsQualitative: boolean;
  needsQuantitative: boolean;
  needsFieldwork: boolean;
  needsDataAnalysis: boolean;
  rationale: string;
  /** false if the Research Director's output didn't carry a parseable scoping block. */
  parseOk: boolean;
}

export const ENGAGEMENT_PLAN_FORMAT_TEMPLATE = `Then, end your output with EXACTLY this block (nothing after it), scoping the rest of the engagement:

ENGAGEMENT_TYPE: <short label — e.g. full_mixed_methods, quant_only, qual_only, consultation_desk_research, strategic_advisory>
NEEDS_QUALITATIVE: yes or no
NEEDS_QUANTITATIVE: yes or no
NEEDS_FIELDWORK: yes or no
NEEDS_DATA_ANALYSIS: yes or no
PLAN_RATIONALE: <one sentence on why this scope, not a bigger or smaller one>

Scope it honestly. Not every brief needs primary fieldwork — a request that's really asking for expert
advisory or a rapid desk-research read should be answered as a consultation (NEEDS_QUALITATIVE: no,
NEEDS_QUANTITATIVE: no, NEEDS_FIELDWORK: no, NEEDS_DATA_ANALYSIS: no) rather than padded into a full study
the client didn't ask for and won't want to pay for.`;

const SAFE_DEFAULT: Omit<EngagementPlan, "parseOk"> = {
  engagementType: "full_mixed_methods (safe default — Research Director's scoping block did not parse)",
  needsQualitative: true,
  needsQuantitative: true,
  needsFieldwork: true,
  needsDataAnalysis: true,
  rationale:
    "Defaulted to the full pipeline because the scoping decision could not be parsed — safer to over-deliver than silently skip research a client asked for.",
};

function parseYesNo(raw: string, label: string): boolean | undefined {
  const m = raw.match(new RegExp(`${label}:\\s*(yes|no)`, "i"));
  return m ? m[1].toLowerCase() === "yes" : undefined;
}

export function parseEngagementPlan(raw: string): EngagementPlan {
  const typeMatch = raw.match(/ENGAGEMENT_TYPE:\s*(.+)/i);
  const rationaleMatch = raw.match(/PLAN_RATIONALE:\s*(.+)/i);

  const needsQualitative = parseYesNo(raw, "NEEDS_QUALITATIVE");
  const needsQuantitative = parseYesNo(raw, "NEEDS_QUANTITATIVE");
  const needsFieldwork = parseYesNo(raw, "NEEDS_FIELDWORK");
  const needsDataAnalysis = parseYesNo(raw, "NEEDS_DATA_ANALYSIS");

  const parseOk =
    Boolean(typeMatch) &&
    [needsQualitative, needsQuantitative, needsFieldwork, needsDataAnalysis].every((v) => v !== undefined);

  if (!parseOk) {
    return { ...SAFE_DEFAULT, parseOk: false };
  }

  return {
    engagementType: typeMatch![1].trim(),
    needsQualitative: needsQualitative!,
    needsQuantitative: needsQuantitative!,
    needsFieldwork: needsFieldwork!,
    needsDataAnalysis: needsDataAnalysis!,
    rationale: rationaleMatch ? rationaleMatch[1].trim() : "(no rationale parsed)",
    parseOk: true,
  };
}
