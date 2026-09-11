import { Agent } from "../agents/agent.js";
import type { AgentRunResult } from "../agents/agent.js";
import { ROLES, getRole } from "../agents/roles.js";
import { LLMRouter } from "../providers/router.js";
import { QAReviewer } from "../qa/qaReviewer.js";
import { runWithQA } from "../qa/reviewLoop.js";
import { parseEngagementPlan } from "./engagementPlan.js";
import {
  createContext,
  priorOutputsAsContext,
  recordOutput,
  recordSkipped,
  writeEngagementToDisk,
  type EngagementContext,
} from "./context.js";

export interface QAConfig {
  enabled: boolean;
  maxRevisions: number;
}

export interface RunPipelineOptions {
  brief: string;
  router: LLMRouter;
  outputDir: string;
  qa?: Partial<QAConfig>;
  onPhase?: (phase: string, detail?: string) => void;
}

export interface RunPipelineResult {
  context: EngagementContext;
  outputDir: string;
}

function buildAgents(router: LLMRouter): Record<string, Agent> {
  const agents: Record<string, Agent> = {};
  for (const role of ROLES) {
    agents[role.id] = new Agent(role, router);
  }
  return agents;
}

function resolveQAConfig(opts?: Partial<QAConfig>): QAConfig {
  return {
    enabled: opts?.enabled ?? process.env.QA_ENABLED !== "false",
    maxRevisions: opts?.maxRevisions ?? Number(process.env.QA_MAX_REVISIONS ?? 2),
  };
}

/**
 * The autonomous end-to-end engagement pipeline, modeling how a real research
 * agency's 12 roles hand work to each other — and modeling that not every
 * client request needs the same shape of engagement.
 *
 * DYNAMIC WORKFLOW: the Research Director's phase ends with a scoping decision
 * (see `engagementPlan.ts`) that this pipeline actually obeys — a consultation
 * or desk-research-only request skips qual/quant fieldwork and data analysis
 * entirely rather than padding every brief into a full fieldwork study.
 *
 * EFFICIENCY: Project Manager, desk research, and (whichever of) qual/quant
 * design all depend only on the Research Director's output, not on each
 * other, so they run in parallel rather than serialized one after another.
 *
 * QUALITY: every deliverable that does run is passed through a brutal-QA
 * revision loop (see `qa/reviewLoop.ts`) against a 6-dimension rubric before
 * being accepted, and the whole engagement closes with a holistic 360°
 * capstone analysis.
 */
export async function runPipeline(opts: RunPipelineOptions): Promise<RunPipelineResult> {
  const { brief, router, outputDir, onPhase } = opts;
  const qaConfig = resolveQAConfig(opts.qa);
  const agents = buildAgents(router);
  const qa = new QAReviewer(router);
  const ctx = createContext(brief);

  const report = (phase: string, detail?: string) => onPhase?.(phase, detail);

  const run = async (roleId: string, task: string, contextRoleIds?: string[]): Promise<AgentRunResult> => {
    const agent = agents[roleId];
    report(getRole(roleId).title, "started");
    const priorContext = priorOutputsAsContext(ctx, contextRoleIds);
    const fullPrompt = `${task}\n\n## Context from colleagues so far\n\n${priorContext}`;

    const result = await runWithQA(agent, fullPrompt, qa, {
      brief,
      enabled: qaConfig.enabled,
      maxRevisions: qaConfig.maxRevisions,
      onAttempt: (attempt, verdict) => {
        if (attempt === 0) return;
        report(getRole(roleId).title, `QA revision ${attempt}: ${verdict.verdict} (${verdict.overallScore}/10)`);
      },
    });

    recordOutput(ctx, result);
    const qaNote = result.qa
      ? ` | QA: ${result.qa.verdict} (${result.qa.overallScore}/10, ${result.qa.revisions} revision(s))`
      : "";
    report(getRole(roleId).title, `done via ${result.route}${qaNote}`);
    return result;
  };

  const skip = (roleId: string, reason: string) => {
    const role = getRole(roleId);
    recordSkipped(ctx, roleId, role.title, reason);
    report(role.title, `skipped — ${reason}`);
  };

  // Phase 1 — strategic go/no-go
  await run(
    "managing_director",
    `A new client brief has come in:\n\n${brief}\n\nDecide whether to pursue it and set the mandate.`,
    []
  );

  // Phase 2 — client-facing proposal framing
  await run(
    "account_director",
    `Turn the brief and the Managing Director's mandate into a proposal framing.\n\nClient brief:\n${brief}`,
    ["managing_director"]
  );

  // Phase 3 — methodology + dynamic scoping decision
  const researchDirectorResult = await run(
    "research_director",
    `Choose the methodology and set quality guardrails based on the proposal framing.\n\nClient brief:\n${brief}`,
    ["managing_director", "account_director"]
  );
  const plan = parseEngagementPlan(researchDirectorResult.output);
  ctx.plan = plan;
  report(
    "Engagement scope",
    `${plan.engagementType} (qual:${plan.needsQualitative ? "y" : "n"} quant:${plan.needsQuantitative ? "y" : "n"} fieldwork:${plan.needsFieldwork ? "y" : "n"} data:${plan.needsDataAnalysis ? "y" : "n"})${plan.parseOk ? "" : " [fell back to safe default — could not parse Research Director's scoping block]"}`
  );

  // Phase 4 — parallel workstreams. Project Manager, desk research, and
  // whichever of qual/quant design are actually needed all depend only on
  // the Research Director's output, not on each other — run together.
  const phase4RoleIds = ["research_director"];
  const parallelTasks: Array<Promise<AgentRunResult>> = [
    run(
      "project_manager",
      `Build the project plan and timeline for this engagement based on the chosen methodology and scope (${plan.engagementType}).`,
      phase4RoleIds
    ),
    run(
      "research_consultant_analyst",
      `Conduct the desk/secondary research workstream for this engagement.\n\nClient brief:\n${brief}`,
      phase4RoleIds
    ),
  ];

  if (plan.needsQualitative) {
    parallelTasks.push(
      run(
        "qualitative_researcher",
        `Design the qualitative component for this engagement.\n\nClient brief:\n${brief}`,
        phase4RoleIds
      )
    );
  } else {
    skip("qualitative_researcher", `Research Director scoped this as "${plan.engagementType}" — no qualitative component needed. ${plan.rationale}`);
  }

  if (plan.needsQuantitative) {
    parallelTasks.push(
      run(
        "quantitative_researcher",
        `Design the quantitative component for this engagement.\n\nClient brief:\n${brief}`,
        phase4RoleIds
      )
    );
  } else {
    skip("quantitative_researcher", `Research Director scoped this as "${plan.engagementType}" — no quantitative component needed. ${plan.rationale}`);
  }

  await Promise.all(parallelTasks);

  // Phase 5 — fieldwork operationalization (only if there's primary data collection to run)
  if (plan.needsFieldwork && (plan.needsQualitative || plan.needsQuantitative)) {
    await run(
      "fieldwork_coordinator",
      `Turn the qualitative and quantitative designs into an operational recruitment and data-collection plan.`,
      ["project_manager", "qualitative_researcher", "quantitative_researcher"]
    );
  } else {
    skip("fieldwork_coordinator", `No primary data collection in scope for this engagement ("${plan.engagementType}").`);
  }

  // Phase 6 — data processing (only if there's data worth processing)
  if (plan.needsDataAnalysis && (plan.needsQualitative || plan.needsQuantitative)) {
    await run(
      "data_analyst",
      `Describe the data-processing workstream and produce an illustrative results summary from the (simulated) collected data.`,
      ["fieldwork_coordinator", "qualitative_researcher", "quantitative_researcher", "research_consultant_analyst"]
    );
  } else {
    skip("data_analyst", `No primary dataset in scope for this engagement ("${plan.engagementType}") — insights will draw on desk research only.`);
  }

  // Phase 7 — synthesis / insights narrative
  await run(
    "insights_strategist",
    `Synthesize everything produced so far into the headline insights and prioritized recommendations for the client report.\n\nClient brief:\n${brief}`,
    [
      "research_director",
      "research_consultant_analyst",
      "qualitative_researcher",
      "quantitative_researcher",
      "data_analyst",
    ]
  );

  // Phase 8 — visualization / deck-or-memo outline, right-sized to engagement scope
  await run(
    "designer_visualization",
    `Turn the insights narrative into a client-presentable structure. Engagement scope: ${plan.engagementType} — size the output accordingly (full deck outline for a full study, a tight executive-memo structure for a consultation/advisory engagement).`,
    ["insights_strategist"]
  );

  // Phase 9 — commercial & compliance close-out
  await run(
    "ops_finance_legal",
    `Produce the invoicing schedule, procurement checklist, and compliance close-out for this engagement. Engagement scope: ${plan.engagementType}.`,
    ["project_manager", "account_director", "fieldwork_coordinator"]
  );

  // Phase 10 — final sign-off
  await run(
    "managing_director",
    `Review the completed engagement end-to-end and give a final sign-off summary: is this deliverable client-ready, what's the single biggest residual risk, and what should the Account Director lead with when presenting to the client.`,
    ["account_director", "research_director", "insights_strategist", "ops_finance_legal", "designer_visualization"]
  );

  // Phase 11 — 360° capstone audit of the whole engagement (not itself QA'd — it is the review)
  report("360° Engagement Analysis", "started");
  const analysis = await qa.perform360Analysis({
    brief,
    outputs: ctx.outputs.map((o) => ({ roleTitle: o.roleTitle, output: o.output })),
  });
  recordOutput(ctx, {
    roleId: "qa_360_analysis",
    roleTitle: "360° Engagement Analysis (Chief Quality Officer)",
    output: analysis.text,
    route: analysis.route,
  });
  report("360° Engagement Analysis", `done via ${analysis.route}`);

  const dir = await writeEngagementToDisk(ctx, outputDir);
  return { context: ctx, outputDir: dir };
}
