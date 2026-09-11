import type { Agent, AgentRunResult } from "../agents/agent.js";
import type { QAReviewer } from "./qaReviewer.js";
import type { QAVerdict } from "./format.js";

export interface RunWithQAOptions {
  brief: string;
  enabled: boolean;
  maxRevisions: number;
  useWebSearch?: boolean;
  onAttempt?: (attempt: number, verdict: QAVerdict) => void;
}

/**
 * Runs one agent's task through the brutal-QA revision loop: generate, get
 * reviewed against the 360° rubric — by a *different* provider than the one
 * that generated the draft, whenever more than one is actually available, so
 * QA isn't just the same model grading its own homework — and if REVISE,
 * regenerate with the critique folded in, up to `maxRevisions` times. Always
 * terminates with a result (the last draft is force-accepted after the cap,
 * clearly flagged, rather than looping forever or failing the whole
 * engagement over one stubborn deliverable).
 */
export async function runWithQA(
  agent: Agent,
  taskPrompt: string,
  qa: QAReviewer,
  opts: RunWithQAOptions
): Promise<AgentRunResult> {
  let result = await agent.run(taskPrompt, { useWebSearch: opts.useWebSearch });

  if (!opts.enabled) {
    return result;
  }

  let attempt = 0;
  let review = await qa.review({
    brief: opts.brief,
    roleTitle: agent.title,
    deliverable: result.output,
    excludeProviders: [result.providerName],
  });
  let crossProviderChecked = review.providerName !== result.providerName;
  opts.onAttempt?.(attempt, review.verdict);

  while (review.verdict.verdict === "REVISE" && attempt < opts.maxRevisions) {
    attempt++;
    const revisionPrompt = `${taskPrompt}

## Your previous draft FAILED brutal QA — revise it. Rewrite the deliverable itself; don't just respond to the critique in prose.

Previous draft:
${result.output}

QA critique (overall ${review.verdict.overallScore}/10, dimension scores: ${JSON.stringify(review.verdict.scores)}):
${review.verdict.critique}`;

    result = await agent.run(revisionPrompt, { useWebSearch: opts.useWebSearch });
    review = await qa.review({
      brief: opts.brief,
      roleTitle: agent.title,
      deliverable: result.output,
      excludeProviders: [result.providerName],
    });
    crossProviderChecked = crossProviderChecked && review.providerName !== result.providerName;
    opts.onAttempt?.(attempt, review.verdict);
  }

  const finalVerdict: AgentRunResult["qa"] = {
    verdict:
      review.verdict.verdict === "PASS"
        ? attempt > 0
          ? "PASS_AFTER_REVISION"
          : "PASS"
        : "REVISE_MAX_ATTEMPTS",
    overallScore: review.verdict.overallScore,
    scores: review.verdict.scores,
    critique: review.verdict.critique,
    revisions: attempt,
    parseOk: review.verdict.parseOk,
    crossProviderChecked,
  };

  return { ...result, qa: finalVerdict };
}
