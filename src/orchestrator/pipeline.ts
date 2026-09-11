import { Agent } from "../agents/agent.js";
import type { AgentRunResult } from "../agents/agent.js";
import { ROLES, getRole } from "../agents/roles.js";
import { LLMRouter } from "../providers/router.js";
import { QAReviewer } from "../qa/qaReviewer.js";
import { runWithQA } from "../qa/reviewLoop.js";
import { parseEngagementPlan } from "./engagementPlan.js";
import { classifyDepth, type EngagementDepth } from "./depthClassifier.js";
import { defaultMemoryPath, formatLessons, lessonsFor, loadMemory, recordLesson, saveMemory, type MemoryStore } from "../memory/agencyMemory.js";
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

export interface MemoryConfig {
  enabled: boolean;
  path: string;
}

export interface RunPipelineOptions {
  brief: string;
  router: LLMRouter;
  outputDir: string;
  qa?: Partial<QAConfig>;
  memory?: Partial<MemoryConfig>;
  /** "auto" (default) classifies the request; force a value to skip that call. */
  depth?: "auto" | EngagementDepth;
  /** Pre-formatted, already-computed real statistics (see src/analysis/stats.ts) — grounds quant work in reality instead of illustrative filler. */
  realDataset?: string;
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

function resolveMemoryConfig(opts?: Partial<MemoryConfig>): MemoryConfig {
  return {
    enabled: opts?.enabled ?? process.env.AGENCY_MEMORY_ENABLED !== "false",
    path: opts?.path ?? defaultMemoryPath(),
  };
}

/**
 * The autonomous end-to-end engagement pipeline. Four things make this a
 * research EXECUTION engine rather than a report-shape generator:
 *
 * 1. DYNAMIC DEPTH: an intake triage decides whether this is a full client
 *    engagement (proposal, timeline, invoicing ceremony) or a direct research
 *    request (just answer the question) — and skips the commercial-ceremony
 *    roles (Managing Director, Account Director, Ops/Finance/Legal) entirely
 *    for the latter. Layered on top of the existing DYNAMIC SCOPE (the
 *    Research Director's qual/quant/fieldwork/data-analysis decision).
 * 2. REAL DESK RESEARCH: the Research Consultant/Analyst's call runs with
 *    live web search (via the Claude subscription passthrough's WebSearch
 *    tool, or Anthropic's native web_search tool) when the active provider
 *    supports it — real, current, citable sources instead of only
 *    training-data recall.
 * 3. REAL QUANTITATIVE GROUNDING: if a real dataset was supplied (see
 *    `--data`), the Quantitative Researcher and Data Analyst are handed
 *    actual computed statistics and required to work from them, not invent
 *    numbers. If none was supplied, they're required to say so and produce a
 *    plan, not fabricated "illustrative" results.
 * 4. INDEPENDENT QA + PERSISTENT LEARNING: QA runs on a different provider
 *    than the one that generated the draft whenever more than one is
 *    available (see `qa/reviewLoop.ts`), and every critique that triggered a
 *    revision is written to a local, durable lesson store and fed back into
 *    the same role's prompt on the *next* engagement — genuine improvement
 *    across runs without needing to fine-tune anything.
 */
export async function runPipeline(opts: RunPipelineOptions): Promise<RunPipelineResult> {
  const { brief, router, outputDir, onPhase } = opts;
  const qaConfig = resolveQAConfig(opts.qa);
  const memoryConfig = resolveMemoryConfig(opts.memory);
  const agents = buildAgents(router);
  const qa = new QAReviewer(router);
  const ctx = createContext(brief);
  ctx.usedRealDataset = Boolean(opts.realDataset);

  const store: MemoryStore = memoryConfig.enabled ? await loadMemory(memoryConfig.path) : { lessons: [] };

  const report = (phase: string, detail?: string) => onPhase?.(phase, detail);

  const run = async (
    roleId: string,
    task: string,
    contextRoleIds?: string[],
    extra?: { useWebSearch?: boolean }
  ): Promise<AgentRunResult> => {
    const agent = agents[roleId];
    report(getRole(roleId).title, "started");

    const lessons = memoryConfig.enabled ? lessonsFor(store, roleId) : [];
    for (const l of lessons) ctx.appliedLessons.push({ roleId, lesson: l.lesson });
    const lessonBlock = lessons.length > 0 ? `\n\n${formatLessons(lessons)}` : "";

    const priorContext = priorOutputsAsContext(ctx, contextRoleIds);
    const fullPrompt = `${task}${lessonBlock}\n\n## Context from colleagues so far\n\n${priorContext}`;

    let firstFailCritique: string | undefined;

    const result = await runWithQA(agent, fullPrompt, qa, {
      brief,
      enabled: qaConfig.enabled,
      maxRevisions: qaConfig.maxRevisions,
      useWebSearch: extra?.useWebSearch,
      onAttempt: (attempt, verdict) => {
        if (attempt === 0) {
          if (verdict.verdict === "REVISE") firstFailCritique = verdict.critique;
          return;
        }
        report(getRole(roleId).title, `QA revision ${attempt}: ${verdict.verdict} (${verdict.overallScore}/10)`);
      },
    });

    recordOutput(ctx, result);
    if (memoryConfig.enabled && firstFailCritique) {
      recordLesson(store, roleId, firstFailCritique);
    }

    const qaNote = result.qa
      ? ` | QA: ${result.qa.verdict} (${result.qa.overallScore}/10, ${result.qa.revisions} revision(s)${result.qa.crossProviderChecked ? ", independent" : ""})`
      : "";
    report(getRole(roleId).title, `done via ${result.route}${qaNote}`);
    return result;
  };

  const skip = (roleId: string, reason: string) => {
    const role = getRole(roleId);
    recordSkipped(ctx, roleId, role.title, reason);
    report(role.title, `skipped — ${reason}`);
  };

  // Phase 0 — intake triage: full commercial engagement, or a direct research request?
  let depth: EngagementDepth;
  let depthRationale: string;
  if (opts.depth && opts.depth !== "auto") {
    depth = opts.depth;
    depthRationale = "Depth forced via configuration/CLI flag.";
    report("Engagement depth", `${depth} (forced)`);
  } else {
    const classification = await classifyDepth(router, brief);
    depth = classification.decision.depth;
    depthRationale = classification.decision.rationale;
    report(
      "Engagement depth",
      `${depth}${classification.decision.parseOk ? "" : " [fell back to safe default]"} — ${depthRationale}`
    );
  }
  ctx.depth = depth;
  ctx.depthRationale = depthRationale;
  const isFullEngagement = depth === "full_engagement";

  // Phase 1 — strategic go/no-go (skipped for a direct research request — no client relationship to manage)
  if (isFullEngagement) {
    await run(
      "managing_director",
      `A new client brief has come in:\n\n${brief}\n\nDecide whether to pursue it and set the mandate.`,
      []
    );
  } else {
    skip("managing_director", `Direct research request, not a commissioned client engagement. ${depthRationale}`);
  }

  // Phase 2 — client-facing proposal framing (same reasoning)
  if (isFullEngagement) {
    await run(
      "account_director",
      `Turn the brief and the Managing Director's mandate into a proposal framing.\n\nClient brief:\n${brief}`,
      ["managing_director"]
    );
  } else {
    skip("account_director", `Direct research request — no proposal/budget framing needed. ${depthRationale}`);
  }

  // Phase 3 — methodology + dynamic scoping decision
  const researchDirectorResult = await run(
    "research_director",
    isFullEngagement
      ? `Choose the methodology and set quality guardrails based on the proposal framing.\n\nClient brief:\n${brief}`
      : `Choose the methodology and set quality guardrails directly from the request below — this is a direct research request, there is no separate client proposal framing.\n\nRequest:\n${brief}`,
    isFullEngagement ? ["managing_director", "account_director"] : []
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
      `Conduct the desk/secondary research workstream for this engagement. If you have live web search available, use it and cite real, current sources with dates — don't rely on recall alone for anything time-sensitive.\n\nClient brief:\n${brief}`,
      phase4RoleIds,
      { useWebSearch: true }
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
    const datasetBlock = opts.realDataset
      ? `\n\n## Real dataset already supplied by the client — use ONLY these numbers, don't invent additional statistics:\n\n${opts.realDataset}`
      : `\n\n## No primary dataset has been supplied yet — this is a design for data collection that hasn't happened, not an analysis of real numbers.`;
    parallelTasks.push(
      run(
        "quantitative_researcher",
        `Design the quantitative component for this engagement.\n\nClient brief:\n${brief}${datasetBlock}`,
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
    const datasetBlock = opts.realDataset
      ? `\n\n## Real dataset (use ONLY these computed numbers, don't invent additional ones):\n\n${opts.realDataset}`
      : `\n\n## No primary dataset has been supplied for this engagement. Do NOT invent illustrative numbers presented as findings — produce a research design & analysis PLAN (what you would compute once data exists), clearly labeled as a plan, not results.`;
    await run(
      "data_analyst",
      `Describe the data-processing workstream and produce a results summary from the collected data.${datasetBlock}`,
      ["fieldwork_coordinator", "qualitative_researcher", "quantitative_researcher", "research_consultant_analyst"]
    );
  } else {
    skip("data_analyst", `No primary dataset in scope for this engagement ("${plan.engagementType}") — insights will draw on desk research only.`);
  }

  // Phase 7 — synthesis / insights narrative
  await run(
    "insights_strategist",
    `Synthesize everything produced so far into the headline insights and prioritized recommendations.\n\nClient brief:\n${brief}`,
    [
      "research_director",
      "research_consultant_analyst",
      "qualitative_researcher",
      "quantitative_researcher",
      "data_analyst",
    ]
  );

  // Phase 8 — visualization / deck-or-memo outline, right-sized to engagement scope.
  // Kept even for a direct-research request: structuring the answer well is the
  // deliverable itself, not client-relationship ceremony.
  await run(
    "designer_visualization",
    `Turn the insights narrative into a client-presentable structure. Engagement scope: ${plan.engagementType} — size the output accordingly (full deck outline for a full study, a tight executive-memo structure for a consultation/direct-research answer).`,
    ["insights_strategist"]
  );

  // Phase 9 — commercial & compliance close-out (skipped for a direct research request — nothing to bill)
  if (isFullEngagement) {
    await run(
      "ops_finance_legal",
      `Produce the invoicing schedule, procurement checklist, and compliance close-out for this engagement. Engagement scope: ${plan.engagementType}.`,
      ["project_manager", "account_director", "fieldwork_coordinator"]
    );
  } else {
    skip("ops_finance_legal", `Direct research request — no commercial engagement to invoice or close out. ${depthRationale}`);
  }

  // Phase 10 — final sign-off (skipped for the same reason)
  if (isFullEngagement) {
    await run(
      "managing_director",
      `Review the completed engagement end-to-end and give a final sign-off summary: is this deliverable client-ready, what's the single biggest residual risk, and what should the Account Director lead with when presenting to the client.`,
      ["account_director", "research_director", "insights_strategist", "ops_finance_legal", "designer_visualization"]
    );
  }

  // Phase 11 — 360° capstone audit of the whole engagement (not itself QA'd — it is the review).
  // This is a control, not process ceremony, so it always runs.
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
    providerName: analysis.route.split(/[+:]/)[0],
  });
  report("360° Engagement Analysis", `done via ${analysis.route}`);

  if (memoryConfig.enabled) {
    try {
      await saveMemory(store, memoryConfig.path);
    } catch (err) {
      report("Continuous improvement", `could not save lessons learned: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const dir = await writeEngagementToDisk(ctx, outputDir);
  return { context: ctx, outputDir: dir };
}
