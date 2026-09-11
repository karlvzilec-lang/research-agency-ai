import type { LLMRouter } from "../providers/router.js";
import { QA_DIMENSION_LABELS, QA_OUTPUT_FORMAT_TEMPLATE, parseQAVerdict, type QAVerdict } from "./format.js";

const QA_PERSONA = `You are the research agency's Chief Quality Officer — the internal "brutal QA" reviewer,
a partner-level expert with 20+ years reviewing work at the world's top research and insights agencies.
You are ruthless, unsentimental, and allergic to fluff, hedging, generic filler, and unsupported claims.
Your job is to protect the agency's reputation by catching anything a demanding paying client would push
back on, before it ever reaches them. You are reviewing one colleague's deliverable in isolation — judge
it on its own terms against the client brief and the rubric below, not against a hypothetical perfect report.`;

const RUBRIC = (Object.entries(QA_DIMENSION_LABELS) as Array<[keyof typeof QA_DIMENSION_LABELS, string]>)
  .map(([key, label]) => `- ${label} (${key})`)
  .join("\n");

export interface QAReviewParams {
  brief: string;
  roleTitle: string;
  deliverable: string;
}

export interface QA360Params {
  brief: string;
  outputs: Array<{ roleTitle: string; output: string }>;
}

/**
 * The "brutal QA + 360° analysis" layer every deliverable is required to pass
 * through: a per-deliverable adversarial review against a six-dimension rubric
 * ("360° view"), plus a final holistic audit of the whole engagement.
 */
export class QAReviewer {
  constructor(private readonly router: LLMRouter) {}

  async review(params: QAReviewParams): Promise<{ verdict: QAVerdict; route: string }> {
    const system = `${QA_PERSONA}

Score the deliverable on this 360-degree rubric (1-10 each):
${RUBRIC}

For "risk_compliance" specifically: check alignment with ISO 20252 (research process quality), GDPR-equivalent
data-privacy practice, and — if this is a telecom-operator engagement — eTOM process alignment. Mark it down if
compliance is asserted but not actually demonstrated in the text.

${QA_OUTPUT_FORMAT_TEMPLATE}`;

    const prompt = `Client brief:\n${params.brief}\n\nDeliverable under review, produced by: ${params.roleTitle}\n\n---\n${params.deliverable}\n---\n\nReview it now.`;

    const result = await this.router.complete({ system, prompt });
    return { verdict: parseQAVerdict(result.text), route: result.route };
  }

  async perform360Analysis(params: QA360Params): Promise<{ text: string; route: string }> {
    const system = `${QA_PERSONA}

You are now closing out the ENTIRE engagement, not a single deliverable. Produce a holistic 360-degree
engagement analysis covering exactly these angles, 2-4 evidence-based sentences each, citing what
actually appears in the outputs below (never invent something that isn't there):

- Client Value — does this actually answer the brief's real question?
- Methodological Soundness — does the qual/quant design justify the conclusions drawn?
- Commercial Risk — what could go wrong if the client acts on this, and how exposed is the agency?
- Operational Feasibility — is the plan realistic given the stated timeline/budget?
- Competitive Differentiation — would this read as generic consultancy boilerplate to the client, or does it show real command of their specific situation?
- Actionability — can the client's team actually act on this without further work?

End with exactly these two lines:
OVERALL ENGAGEMENT GRADE: <A-F>
SHIP DECISION: SHIP IT or DO NOT SHIP — FIX FIRST (if the latter, list the 1-3 specific items to fix)`;

    const combined = params.outputs
      .map((o) => `### ${o.roleTitle}\n\n${o.output}`)
      .join("\n\n---\n\n");

    const prompt = `Client brief:\n${params.brief}\n\nFull set of engagement outputs to audit:\n\n${combined}`;

    const result = await this.router.complete({ system, prompt });
    return { text: result.text, route: result.route };
  }
}
