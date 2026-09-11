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

    // Real live web search (Anthropic's server-side web_search tool) for desk-research-type
    // calls, so "findings" can cite actual current sources instead of only training-data recall.
    // Best-effort: if the account/API version rejects this specific tool shape (a 4xx that isn't
    // a plain rate limit), retry once without it rather than failing the whole call over an
    // optional capability.
    if (req.useWebSearch) {
      try {
        return await this.request(req, true);
      } catch (err) {
        const status = err instanceof ProviderError ? (err.cause as { status?: number } | undefined)?.status : undefined;
        if (status && status >= 400 && status < 500 && status !== 429) {
          return await this.request(req, false);
        }
        throw err;
      }
    }

    return this.request(req, false);
  }

  private async request(req: CompletionRequest, withWebSearch: boolean): Promise<CompletionResult> {
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: req.maxTokens ?? 4096,
      system: req.system,
      messages: [{ role: "user", content: req.prompt }],
    };
    if (withWebSearch) {
      body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }];
    }

    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey!,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      const responseBody = await res.text().catch(() => "");
      throw new ProviderError(
        `Anthropic API error ${res.status}${withWebSearch ? " (with web_search tool)" : ""}: ${responseBody.slice(0, 300)}`,
        this.name,
        retryable,
        { status: res.status }
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

    return { text, providerName: this.name, route: withWebSearch ? `${this.name}+web_search` : this.name };
  }
}
