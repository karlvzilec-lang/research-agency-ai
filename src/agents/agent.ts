import type { LLMRouter } from "../providers/router.js";
import type { RoleDefinition } from "./roles.js";

export interface AgentRunResult {
  roleId: string;
  roleTitle: string;
  output: string;
  route: string;
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

  async run(taskPrompt: string): Promise<AgentRunResult> {
    const result = await this.router.complete({
      system: `${this.role.title} — ${this.role.mainResponsibility}\n\n${this.role.systemPrompt}`,
      prompt: taskPrompt,
    });

    return {
      roleId: this.role.id,
      roleTitle: this.role.title,
      output: result.text,
      route: result.route,
    };
  }
}
