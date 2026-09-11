import type { CompletionRequest, CompletionResult, LLMProvider } from "./types.js";
import { ProviderError } from "./types.js";

const DEFAULT_BASE_URL = "http://localhost:11434/v1"; // Ollama's OpenAI-compatible endpoint
const PING_TIMEOUT_MS = 2000;
const DEFAULT_GENERATE_TIMEOUT_MS = 180_000; // local inference can be slow, especially on CPU

/**
 * Local LLM provider — any OpenAI-compatible chat completions server: Ollama
 * (default), LM Studio, llama.cpp's server, vLLM, text-generation-webui, etc.
 * Used automatically in "auto" mode if something is actually reachable at
 * LOCAL_LLM_BASE_URL ("if installed"); silently skipped otherwise. Free and
 * private, so in "auto" mode it's tried before any paid API key.
 */
export class LocalProvider implements LLMProvider {
  readonly name = "local";
  private cachedModel?: string;

  constructor(
    private readonly baseUrl = (process.env.LOCAL_LLM_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    private readonly configuredModel = process.env.LOCAL_LLM_MODEL || undefined,
    private readonly generateTimeoutMs = Number(process.env.LOCAL_LLM_TIMEOUT_MS) || DEFAULT_GENERATE_TIMEOUT_MS
  ) {}

  private async listModels(): Promise<string[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.baseUrl}/models`, { signal: controller.signal });
      if (!res.ok) return [];
      const data = (await res.json()) as { data?: Array<{ id: string }> };
      return (data.data ?? []).map((m) => m.id).filter(Boolean);
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  /** Reachable + (if no model configured) at least one model loaded/pulled. */
  async isAvailable(): Promise<boolean> {
    if (this.configuredModel) {
      // Still confirm the server itself responds; don't just trust the env var.
      const models = await this.listModels();
      return models.length >= 0 && (await this.pingReachable());
    }
    const models = await this.listModels();
    if (models.length === 0) return false;
    this.cachedModel = models[0];
    return true;
  }

  private async pingReachable(): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.baseUrl}/models`, { signal: controller.signal });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  private async resolveModel(): Promise<string> {
    if (this.configuredModel) return this.configuredModel;
    if (this.cachedModel) return this.cachedModel;
    const models = await this.listModels();
    if (models.length === 0) {
      throw new ProviderError(
        `No local model available at ${this.baseUrl}. Is Ollama/LM Studio running with a model pulled/loaded?`,
        this.name,
        false
      );
    }
    this.cachedModel = models[0];
    return this.cachedModel;
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const model = await this.resolveModel();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.generateTimeoutMs);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          max_tokens: req.maxTokens ?? 4096,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.prompt },
          ],
        }),
      });
    } catch (err) {
      throw new ProviderError(
        `Local LLM at ${this.baseUrl} unreachable or timed out (${err instanceof Error ? err.message : String(err)})`,
        this.name,
        true
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ProviderError(
        `Local LLM error ${res.status} (model "${model}"): ${body.slice(0, 300)}`,
        this.name,
        res.status >= 500
      );
    }

    const data = (await res.json()) as {
      choices: Array<{ message?: { content?: string } }>;
    };
    const text = (data.choices?.[0]?.message?.content ?? "").trim();
    if (!text) {
      throw new ProviderError(`Local LLM (model "${model}") returned an empty response`, this.name, true);
    }

    return { text, providerName: this.name, route: `${this.name}:${model}` };
  }
}
