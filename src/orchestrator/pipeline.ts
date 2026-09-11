import { Agent } from "../agents/agent.js";
import { ROLES, getRole } from "../agents/roles.js";
import { LLMRouter } from "../providers/router.js";
import {
  createContext,
  priorOutputsAsContext,
  recordOutput,
  writeEngagementToDisk,
  type EngagementContext,
} from "./context.js";

export interface RunPipelineOptions {
  brief: string;
  router: LLMRouter;
  outputDir: string;
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

/**
 * The autonomous end-to-end engagement pipeline, modeling how a real research
 * agency's 12 roles hand work to each other. Sequential where a role's output is
 * a hard input to the next (strategy -> proposal -> methodology -> plan), parallel
 * where roles genuinely work side by side once they share the same brief
 * (desk research / qual design / quant design; and later fieldwork ops alongside
 * design/visualization prep).
 */
export async function runPipeline(opts: RunPipelineOptions): Promise<RunPipelineResult> {
  const { brief, router, outputDir, onPhase } = opts;
  const agents = buildAgents(router);
  const ctx = createContext(brief);

  const report = (phase: string, detail?: string) => onPhase?.(phase, detail);

  const run = async (roleId: string, task: string, contextRoleIds?: string[]) => {
    const agent = agents[roleId];
    report(getRole(roleId).title, "started");
    const priorContext = priorOutputsAsContext(ctx, contextRoleIds);
    const result = await agent.run(`${task}\n\n## Context from colleagues so far\n\n${priorContext}`);
    recordOutput(ctx, result);
    report(getRole(roleId).title, `done via ${result.route}`);
    return result;
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

  // Phase 3 — methodology
  await run(
    "research_director",
    `Choose the methodology and set quality guardrails based on the proposal framing.\n\nClient brief:\n${brief}`,
    ["managing_director", "account_director"]
  );

  // Phase 4 — project plan
  await run(
    "project_manager",
    `Build the project plan and timeline for this engagement based on the chosen methodology.`,
    ["account_director", "research_director"]
  );

  // Phase 5 — parallel design workstreams (desk research, qual design, quant design)
  report("Design workstreams", "running in parallel: desk research, qualitative design, quantitative design");
  const phase5RoleIds = ["research_director", "project_manager"];
  const [deskResearch, qualDesign, quantDesign] = await Promise.all([
    run(
      "research_consultant_analyst",
      `Conduct the desk/secondary research workstream for this engagement.\n\nClient brief:\n${brief}`,
      phase5RoleIds
    ),
    run(
      "qualitative_researcher",
      `Design the qualitative component (if warranted) for this engagement.\n\nClient brief:\n${brief}`,
      phase5RoleIds
    ),
    run(
      "quantitative_researcher",
      `Design the quantitative component (if warranted) for this engagement.\n\nClient brief:\n${brief}`,
      phase5RoleIds
    ),
  ]);

  // Phase 6 — fieldwork operationalization
  await run(
    "fieldwork_coordinator",
    `Turn the qualitative and quantitative designs into an operational recruitment and data-collection plan.`,
    ["project_manager", qualDesign.roleId, quantDesign.roleId]
  );

  // Phase 7 — data processing
  await run(
    "data_analyst",
    `Describe the data-processing workstream and produce an illustrative results summary from the (simulated) collected data.`,
    ["fieldwork_coordinator", qualDesign.roleId, quantDesign.roleId, deskResearch.roleId]
  );

  // Phase 8 — synthesis / insights narrative
  await run(
    "insights_strategist",
    `Synthesize everything produced so far into the headline insights and prioritized recommendations for the client report.\n\nClient brief:\n${brief}`,
    [
      "research_director",
      deskResearch.roleId,
      qualDesign.roleId,
      quantDesign.roleId,
      "data_analyst",
    ]
  );

  // Phase 9 — visualization / deck outline
  await run(
    "designer_visualization",
    `Turn the insights narrative into a client-presentable slide-by-slide deck outline with chart recommendations.`,
    ["insights_strategist"]
  );

  // Phase 10 — commercial & compliance close-out
  await run(
    "ops_finance_legal",
    `Produce the invoicing schedule, procurement checklist, and compliance close-out for this engagement.`,
    ["project_manager", "account_director", "fieldwork_coordinator"]
  );

  // Phase 11 — final sign-off
  await run(
    "managing_director",
    `Review the completed engagement end-to-end and give a final sign-off summary: is this deliverable client-ready, what's the single biggest residual risk, and what should the Account Director lead with when presenting to the client.`,
    ["account_director", "research_director", "insights_strategist", "ops_finance_legal", "designer_visualization"]
  );

  const dir = await writeEngagementToDisk(ctx, outputDir);
  return { context: ctx, outputDir: dir };
}
