import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentRunResult } from "../agents/agent.js";

export interface EngagementContext {
  id: string;
  brief: string;
  startedAt: string;
  outputs: AgentRunResult[];
}

export function createContext(brief: string): EngagementContext {
  const startedAt = new Date();
  return {
    id: startedAt.toISOString().replace(/[:.]/g, "-"),
    brief,
    startedAt: startedAt.toISOString(),
    outputs: [],
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
      "",
    ].join("\n");
    await writeFile(path.join(dir, filename), body, "utf8");
  }

  const finalReport = [
    `# Research Engagement Report`,
    "",
    `Generated: ${ctx.startedAt}`,
    "",
    "## Client Brief",
    "",
    ctx.brief,
    "",
    ...ctx.outputs.flatMap((o) => ["## " + o.roleTitle, "", o.output, ""]),
  ].join("\n");
  const finalPath = path.join(dir, "FINAL-REPORT.md");
  await writeFile(finalPath, finalReport, "utf8");

  return dir;
}
