import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentRunResult } from "../agents/agent.js";
import type { EngagementPlan } from "./engagementPlan.js";
import type { EngagementDepth } from "./depthClassifier.js";

export interface AppliedLesson {
  roleId: string;
  lesson: string;
}

export interface EngagementContext {
  id: string;
  brief: string;
  startedAt: string;
  outputs: AgentRunResult[];
  plan?: EngagementPlan;
  depth?: EngagementDepth;
  depthRationale?: string;
  usedRealDataset?: boolean;
  appliedLessons: AppliedLesson[];
}

export function createContext(brief: string): EngagementContext {
  const startedAt = new Date();
  return {
    id: startedAt.toISOString().replace(/[:.]/g, "-"),
    brief,
    startedAt: startedAt.toISOString(),
    outputs: [],
    appliedLessons: [],
  };
}

/**
 * Renders prior colleagues' outputs as context for the next agent's prompt.
 * Pass `onlyRoleIds` to narrow it (e.g. only show the Research Director's brief
 * to the qual/quant leads, not the full history) — omit for "everything so far".
 */
export function priorOutputsAsContext(ctx: EngagementContext, onlyRoleIds?: string[]): string {
  const relevant = onlyRoleIds
    ? ctx.outputs.filter((o) => onlyRoleIds.includes(o.roleId))
    : ctx.outputs;

  if (relevant.length === 0) return "(nothing produced yet — you are first)";

  return relevant
    .map((o) => `### Output from ${o.roleTitle}\n\n${o.output}`)
    .join("\n\n---\n\n");
}

export function recordOutput(ctx: EngagementContext, result: AgentRunResult): void {
  ctx.outputs.push(result);
}

/** Records a role that was deliberately skipped by the dynamic engagement plan/depth — no LLM call needed. */
export function recordSkipped(ctx: EngagementContext, roleId: string, roleTitle: string, reason: string): void {
  ctx.outputs.push({
    roleId,
    roleTitle,
    output: `_Not required for this engagement._\n\n${reason}`,
    route: "skipped (dynamic scoping)",
    providerName: "skipped",
  });
}

function qaBlock(output: AgentRunResult): string {
  if (!output.qa) return "";
  const scoreLines = Object.entries(output.qa.scores)
    .map(([k, v]) => `- ${k}: ${v}/10`)
    .join("\n");
  return [
    "",
    "## Quality Assurance — 360° Review",
    "",
    `**Verdict:** ${output.qa.verdict} — **Overall:** ${output.qa.overallScore}/10 (${output.qa.revisions} revision(s))`,
    `**Independent review:** ${output.qa.crossProviderChecked ? "yes — a different provider graded this than the one that generated it" : "no — only one provider was available, so this is self-reviewed"}`,
    "",
    scoreLines,
    "",
    `**Reviewer critique:** ${output.qa.critique}`,
  ].join("\n");
}

function qaSummaryTable(outputs: AgentRunResult[]): string {
  const rows = outputs
    .filter((o) => o.qa)
    .map(
      (o) =>
        `| ${o.roleTitle} | ${o.qa!.verdict} | ${o.qa!.overallScore}/10 | ${o.qa!.revisions} | ${o.qa!.crossProviderChecked ? "yes" : "no"} |`
    )
    .join("\n");
  if (!rows) return "_QA disabled for this run._";
  return ["| Deliverable | Verdict | Overall | Revisions | Independent |", "|---|---|---|---|---|", rows].join("\n");
}

export async function writeEngagementToDisk(ctx: EngagementContext, outRoot: string): Promise<string> {
  const dir = path.join(outRoot, ctx.id);
  await mkdir(dir, { recursive: true });

  await writeFile(path.join(dir, "00-brief.md"), `# Client Brief\n\n${ctx.brief}\n`, "utf8");

  for (const [i, output] of ctx.outputs.entries()) {
    const num = String(i + 1).padStart(2, "0");
    const filename = `${num}-${output.roleId}.md`;
    const body = [
      `# ${output.roleTitle}`,
      "",
      `_Route: ${output.route}_`,
      "",
      output.output,
      qaBlock(output),
      "",
    ].join("\n");
    await writeFile(path.join(dir, filename), body, "utf8");
  }

  const finalReport = [
    "# Research Engagement Report",
    "",
    `Generated: ${ctx.startedAt}`,
    "",
    "## Client Brief",
    "",
    ctx.brief,
    "",
    "## Engagement Scope (dynamic workflow decision)",
    "",
    ...(ctx.depth
      ? [
          `**Process depth:** ${ctx.depth}${ctx.depthRationale ? ` — ${ctx.depthRationale}` : ""}`,
          "",
        ]
      : []),
    ...(ctx.plan
      ? [
          `**Research type:** ${ctx.plan.engagementType}`,
          "",
          `**Rationale:** ${ctx.plan.rationale}`,
          "",
          `Qualitative: ${ctx.plan.needsQualitative ? "yes" : "no"} · Quantitative: ${ctx.plan.needsQuantitative ? "yes" : "no"} · Fieldwork: ${ctx.plan.needsFieldwork ? "yes" : "no"} · Data analysis: ${ctx.plan.needsDataAnalysis ? "yes" : "no"}`,
          "",
          `**Data source:** ${ctx.usedRealDataset ? "a real dataset was supplied and analyzed with computed statistics" : "no primary dataset supplied — any quantitative sections are a research design/analysis PLAN, not results"}`,
          "",
        ]
      : []),
    "## Quality Assurance Summary",
    "",
    qaSummaryTable(ctx.outputs),
    "",
    ...(ctx.appliedLessons.length > 0
      ? [
          "## Continuous Improvement — Lessons Applied This Run",
          "",
          "Learned from QA critiques on prior engagements and fed back in as guardrails:",
          "",
          ...ctx.appliedLessons.map((l) => `- **${l.roleId}:** ${l.lesson}`),
          "",
        ]
      : []),
    ...ctx.outputs.flatMap((o) => ["## " + o.roleTitle, "", o.output, qaBlock(o), ""]),
  ].join("\n");
  const finalPath = path.join(dir, "FINAL-REPORT.md");
  await writeFile(finalPath, finalReport, "utf8");

  return dir;
}
