import type { CompletionRequest, CompletionResult, LLMProvider } from "./types.js";
import { ProviderError } from "./types.js";

const API_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-5";

/** Direct OpenAI API calls using the user's own OPENAI_API_KEY. */
export class OpenAIDirectProvider implements LLMProvider {
  readonly name = "openai-direct";

  constructor(
    private readonly apiKey = process.env.OPENAI_API_KEY,
    private readonly model = process.env.OPENAI_MODEL || DEFAULT_MODEL
  ) {}

  isAvailable(): boolean {
    return Boolean(this.apiKey);
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    if (!this.apiKey) {
      throw new ProviderError("OPENAI_API_KEY not set", this.name, false);
    }

    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: req.maxTokens ?? 4096,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.prompt },
        ],
      }),
    });

    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      const body = await res.text().catch(() => "");
      throw new ProviderError(
        `OpenAI API error ${res.status}: ${body.slice(0, 300)}`,
        this.name,
        retryable
      );
    }

    const data = (await res.json()) as {
      choices: Array<{ message?: { content?: string } }>;
    };
    const text = (data.choices?.[0]?.message?.content ?? "").trim();

    return { text, providerName: this.name, route: this.name };
  }
}
