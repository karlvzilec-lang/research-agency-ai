import type { CompletionRequest, CompletionResult, LLMProvider } from "./types.js";
import { ProviderError } from "./types.js";

const API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-5";
const ANTHROPIC_VERSION = "2023-06-01";

/** Direct Anthropic API calls using the user's own ANTHROPIC_API_KEY (separate billing, not the Claude Code subscription). */
export class AnthropicDirectProvider implements LLMProvider {
  readonly name = "anthropic-direct";

  constructor(
    private readonly apiKey = process.env.ANTHROPIC_API_KEY,
    private readonly model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL
  ) {}

  isAvailable(): boolean {
    return Boolean(this.apiKey);
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    if (!this.apiKey) {
      throw new ProviderError("ANTHROPIC_API_KEY not set", this.name, false);
    }

    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: req.maxTokens ?? 4096,
        system: req.system,
        messages: [{ role: "user", content: req.prompt }],
      }),
    });

    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      const body = await res.text().catch(() => "");
      throw new ProviderError(
        `Anthropic API error ${res.status}: ${body.slice(0, 300)}`,
        this.name,
        retryable
      );
    }

    const data = (await res.json()) as {
      content: Array<{ type: string; text?: string }>;
    };
    const text = data.content
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text)
      .join("\n")
      .trim();

    return { text, providerName: this.name, route: this.name };
  }
}
