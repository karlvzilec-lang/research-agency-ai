import spawn from "cross-spawn";
import type { CompletionRequest, CompletionResult, LLMProvider } from "./types.js";
import { ProviderError } from "./types.js";

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Env vars that could silently redirect the CLI away from your subscription —
 * a proxy base URL, a stray API key, or cloud-provider auth flags. Stripped so
 * "passthru" always means what it says: your logged-in Claude subscription,
 * not whatever ANTHROPIC_* override happens to be sitting in the environment.
 */
const ENV_VARS_TO_STRIP = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_API_BASE_URL",
  "ANTHROPIC_MODEL",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
];

interface ClaudeCliResult {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
}

/**
 * Subscription passthrough: shells out to the user's own, already-authenticated
 * `claude` CLI (the same binary Claude Code itself uses) in non-interactive
 * print mode, rather than calling the Anthropic API directly. This rides
 * whatever plan the CLI is logged into (Pro/Max/Team) instead of separate
 * per-token billing — the Claude Agent SDK's own auth requires an API key per
 * Anthropic's terms, so passthrough has to go through the CLI, not the SDK.
 *
 * Requires: `npm install -g @anthropic-ai/claude-code` and `claude /login`
 * once, in a normal terminal, on this machine.
 */
export class PassthruProvider implements LLMProvider {
  readonly name = "passthru";

  constructor(
    private readonly cliPath = process.env.CLAUDE_CLI_PATH || "claude",
    private readonly model = process.env.CLAUDE_PASSTHRU_MODEL,
    private readonly timeoutMs = Number(process.env.CLAUDE_PASSTHRU_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS
  ) {}

  /** Cheap presence check (binary resolves and runs). Does not confirm login. */
  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn(this.cliPath, ["--version"], { stdio: "ignore" });
      child.on("error", () => resolve(false));
      child.on("exit", (code) => resolve(code === 0));
    });
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    // Real live web research for desk-research-type calls: allow exactly WebSearch/WebFetch
    // (nothing else — no Bash/Write/Edit/file access) so this call can cite real, current
    // sources through the same subscription. Every other call stays fully tool-free.
    const allowedTools = req.useWebSearch ? "WebSearch WebFetch" : "";
    const args = [
      "-p",
      req.prompt,
      "--system-prompt",
      req.system,
      "--output-format",
      "json",
      "--strict-mcp-config",
      "--allowedTools",
      allowedTools,
    ];
    if (this.model) args.push("--model", this.model);

    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of ENV_VARS_TO_STRIP) delete env[key];

    const raw = await this.spawnAndCollect(args, env);

    let parsed: ClaudeCliResult;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ProviderError(
        `Could not parse claude CLI output as JSON: ${raw.slice(0, 300)}`,
        this.name,
        false
      );
    }

    if (parsed.is_error || parsed.subtype !== "success") {
      const message = parsed.result || "unknown error from claude CLI";
      const retryable = /rate.?limit|overloaded|timeout|ECONNRESET|connection/i.test(message);
      throw new ProviderError(`claude CLI: ${message}`, this.name, retryable);
    }

    return {
      text: (parsed.result ?? "").trim(),
      providerName: this.name,
      route: req.useWebSearch ? `${this.name}+web_search` : this.name,
    };
  }

  private spawnAndCollect(args: string[], env: NodeJS.ProcessEnv): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.cliPath, args, { env });

      let stdout = "";
      let stderr = "";
      let settled = false;

      const timer = setTimeout(() => {
        settled = true;
        child.kill();
        reject(new ProviderError(`claude CLI timed out after ${this.timeoutMs}ms`, this.name, true));
      }, this.timeoutMs);

      child.stdout?.on("data", (chunk) => (stdout += chunk));
      child.stderr?.on("data", (chunk) => (stderr += chunk));

      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(
          new ProviderError(
            `Could not launch "${this.cliPath}". Is @anthropic-ai/claude-code installed and on PATH? (${err.message})`,
            this.name,
            false,
            err
          )
        );
      });

      child.on("exit", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (stdout.trim()) {
          resolve(stdout);
        } else {
          reject(
            new ProviderError(
              `claude CLI exited with code ${code} and no output. stderr: ${stderr.slice(0, 300)}`,
              this.name,
              true
            )
          );
        }
      });
    });
  }
}
