import type { LLMRouter } from "../providers/router.js";

export type EngagementDepth = "direct_research" | "full_engagement";

const DEPTH_MARKER = "DEPTH: direct_research or full_engagement";

const SYSTEM_PROMPT = `You are the research agency's intake triage. Read the incoming request and decide how much
of the agency's process it actually needs — controls (quality review) always apply regardless of your
answer, this decision is only about whether the client-management/commercial ceremony is warranted.

direct_research = the requester just wants a research answer, analysis, or expert read — no client
  proposal, budget negotiation, timeline, invoicing, or sign-off ceremony is wanted or implied. Most
  "can you look into X / what's driving Y / sanity-check this for me" requests are this.
full_engagement = this reads like an actual commissioned client engagement that genuinely needs
  proposal framing, budget, timeline, and formal commercial close-out.

If genuinely unsure, prefer full_engagement — it costs more process, never less research.

${DEPTH_MARKER}
DEPTH_RATIONALE: <one sentence>

Respond in EXACTLY that two-line format, nothing else.`;

export interface DepthDecision {
  depth: EngagementDepth;
  rationale: string;
  parseOk: boolean;
}

export function parseDepthDecision(raw: string): DepthDecision {
  const depthMatch = raw.match(/DEPTH:\s*(direct_research|full_engagement)/i);
  const rationaleMatch = raw.match(/DEPTH_RATIONALE:\s*(.+)/i);

  if (!depthMatch) {
    return {
      depth: "full_engagement",
      rationale: "Defaulted to the full engagement process — the triage decision didn't parse, and extra process is the safe failure mode.",
      parseOk: false,
    };
  }

  return {
    depth: depthMatch[1].toLowerCase() as EngagementDepth,
    rationale: rationaleMatch ? rationaleMatch[1].trim() : "(no rationale parsed)",
    parseOk: true,
  };
}

export async function classifyDepth(
  router: LLMRouter,
  brief: string
): Promise<{ decision: DepthDecision; route: string }> {
  const result = await router.complete({
    system: SYSTEM_PROMPT,
    prompt: `Request:\n\n${brief}`,
  });
  return { decision: parseDepthDecision(result.text), route: result.route };
}
