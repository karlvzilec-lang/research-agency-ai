import type { LLMRouter } from "../providers/router.js";
import type { QADimension } from "../qa/format.js";
import type { RoleDefinition } from "./roles.js";

export interface AgentQAInfo {
  verdict: "PASS" | "PASS_AFTER_REVISION" | "REVISE_MAX_ATTEMPTS";
  overallScore: number;
  scores: Partial<Record<QADimension, number>>;
  critique: string;
  revisions: number;
  parseOk: boolean;
  /** True if the reviewer actually ran on a different provider than the one that generated the draft. */
  crossProviderChecked: boolean;
}

export interface AgentRunResult {
  roleId: string;
  roleTitle: string;
  output: string;
  route: string;
  /** Which provider actually generated this (stable name, unlike `route` which may carry a suffix). */
  providerName: string;
  /** Present when the output went through the brutal-QA review loop. */
  qa?: AgentQAInfo;
}

export interface AgentRunOptions {
  /** Ask a provider that supports it to ground this call in real, live web search. */
  useWebSearch?: boolean;
}

/**
 * Thin wrapper binding one role definition to the shared provider router.
 * Each phase of the pipeline builds a task prompt (brief + prior context) and
 * runs it through the role's system prompt.
 */
export class Agent {
  constructor(
    private readonly role: RoleDefinition,
    private readonly router: LLMRouter
  ) {}

  get id(): string {
    return this.role.id;
  }

  get title(): string {
    return this.role.title;
  }

  async run(taskPrompt: string, opts: AgentRunOptions = {}): Promise<AgentRunResult> {
    const result = await this.router.complete({
      system: `${this.role.title} — ${this.role.mainResponsibility}\n\n${this.role.systemPrompt}`,
      prompt: taskPrompt,
      useWebSearch: opts.useWebSearch,
    });

    return {
      roleId: this.role.id,
      roleTitle: this.role.title,
      output: result.text,
      route: result.route,
      providerName: result.providerName,
    };
  }
}
