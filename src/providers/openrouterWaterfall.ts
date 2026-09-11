import type { CompletionRequest, CompletionResult, LLMProvider } from "./types.js";
import { ProviderError } from "./types.js";

const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "anthropic/claude-sonnet-5";
const DEFAULT_COOLDOWN_SECONDS = 60;
const DEAD_KEY_COOLDOWN_SECONDS = 60 * 60; // invalid/auth-rejected keys: park for an hour, don't hammer them

interface KeyState {
  key: string;
  /** Index for logging only — never log the raw key. */
  index: number;
  cooldownUntil: number; // epoch ms; 0 = ready
}

/**
 * OpenRouter provider with multi-key waterfall failover: always tries keys in the
 * configured priority order, skipping any still in cooldown, and only advances to
 * the next key when the current one fails. A key that recovers (cooldown expires)
 * is tried again from the top on the next call — true waterfall, not round-robin.
 */
export class OpenRouterWaterfallProvider implements LLMProvider {
  readonly name = "openrouter";
  private readonly keys: KeyState[];

  constructor(
    rawKeys = process.env.OPENROUTER_API_KEYS,
    private readonly model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
    private readonly cooldownSeconds = Number(
      process.env.OPENROUTER_COOLDOWN_SECONDS || DEFAULT_COOLDOWN_SECONDS
    )
  ) {
    this.keys = (rawKeys ?? "")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean)
      .map((key, index) => ({ key, index, cooldownUntil: 0 }));
  }

  isAvailable(): boolean {
    return this.keys.length > 0;
  }

  private readyKeys(): KeyState[] {
    const now = Date.now();
    return this.keys.filter((k) => k.cooldownUntil <= now);
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    if (this.keys.length === 0) {
      throw new ProviderError("No OPENROUTER_API_KEYS configured", this.name, false);
    }

    const errors: string[] = [];
    for (const keyState of this.readyKeys()) {
      try {
        const text = await this.attempt(keyState, req);
        return {
          text,
          providerName: this.name,
          route: `${this.name}:key-${keyState.index + 1}`,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`key-${keyState.index + 1}: ${message}`);
        // Waterfall: this key failed, cool it down, fall through to the next ready key.
        continue;
      }
    }

    throw new ProviderError(
      `All OpenRouter keys exhausted or cooling down. Attempts: ${errors.join(" | ") || "none ready"}`,
      this.name,
      true
    );
  }

  private async attempt(keyState: KeyState, req: CompletionRequest): Promise<string> {
    let res: Response;
    try {
      res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${keyState.key}`,
          "HTTP-Referer": "https://github.com/",
          "X-Title": "research-agency-ai",
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
    } catch (networkErr) {
      this.coolDown(keyState, this.cooldownSeconds);
      throw new Error(
        `network error (${networkErr instanceof Error ? networkErr.message : String(networkErr)})`
      );
    }

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        // Bad/revoked key — park it much longer so the waterfall stops wasting calls on it.
        this.coolDown(keyState, DEAD_KEY_COOLDOWN_SECONDS);
      } else if (res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after"));
        this.coolDown(keyState, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : this.cooldownSeconds);
      } else if (res.status >= 500) {
        this.coolDown(keyState, this.cooldownSeconds);
      }
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = (await res.json()) as {
      choices: Array<{ message?: { content?: string } }>;
    };
    const text = (data.choices?.[0]?.message?.content ?? "").trim();
    if (!text) {
      throw new Error("empty response body");
    }
    return text;
  }

  private coolDown(keyState: KeyState, seconds: number): void {
    keyState.cooldownUntil = Date.now() + seconds * 1000;
  }
}
