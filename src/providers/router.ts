import type { CompletionRequest, CompletionResult, LLMProvider } from "./types.js";
import { ProviderError } from "./types.js";
import { PassthruProvider } from "./passthru.js";
import { AnthropicDirectProvider } from "./anthropicDirect.js";
import { OpenAIDirectProvider } from "./openaiDirect.js";
import { OpenRouterWaterfallProvider } from "./openrouterWaterfall.js";
import { MockProvider } from "./mock.js";

export type LLMMode = "auto" | "passthru" | "api" | "mock";

export interface RouterOptions {
  mode?: LLMMode;
  onRouteUsed?: (route: string, providerName: string) => void;
}

/**
 * Top-level provider router implementing the two operating modes:
 *
 *   1. "passthru" — runs through the Claude Agent SDK, reusing the user's existing
 *      logged-in Claude subscription (no separate API billing).
 *   2. "api"      — direct API keys. Tries Anthropic, then OpenAI, then OpenRouter's
 *      multi-key waterfall (auto-rotating across OPENROUTER_API_KEYS on failure).
 *
 * "auto" (the default) prefers passthru — since it rides the subscription you're
 * already paying for — and transparently falls back to the API chain if the
 * subscription session isn't available or a call fails. This is what satisfies
 * "use the current subscription as passthru, if not 100% allow another provider
 * like OpenRouter with multi-key auto rotation (waterfall)".
 */
export class LLMRouter {
  private readonly mode: LLMMode;
  private readonly passthru = new PassthruProvider();
  private readonly apiChain: LLMProvider[] = [
    new AnthropicDirectProvider(),
    new OpenAIDirectProvider(),
    new OpenRouterWaterfallProvider(),
  ];
  private readonly mock = new MockProvider();

  constructor(private readonly opts: RouterOptions = {}) {
    this.mode = opts.mode ?? (process.env.LLM_MODE as LLMMode) ?? "auto";
  }

  private async orderedProviders(): Promise<LLMProvider[]> {
    switch (this.mode) {
      case "mock":
        return [this.mock];
      case "passthru":
        return [this.passthru];
      case "api":
        return this.availableApiChain();
      case "auto":
      default: {
        const chain: LLMProvider[] = [];
        if (await this.passthru.isAvailable()) chain.push(this.passthru);
        chain.push(...(await this.availableApiChain()));
        return chain;
      }
    }
  }

  private async availableApiChain(): Promise<LLMProvider[]> {
    const checks = await Promise.all(this.apiChain.map((p) => p.isAvailable()));
    return this.apiChain.filter((_, i) => checks[i]);
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const providers = await this.orderedProviders();
    if (providers.length === 0) {
      throw new ProviderError(
        `No LLM provider available for mode "${this.mode}". Configure a subscription login ` +
          `(passthru) or one of ANTHROPIC_API_KEY / OPENAI_API_KEY / OPENROUTER_API_KEYS.`,
        "router",
        false
      );
    }

    const errors: string[] = [];
    for (const provider of providers) {
      try {
        const result = await provider.complete(req);
        this.opts.onRouteUsed?.(result.route, result.providerName);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${provider.name}: ${message}`);
        continue; // fall through to the next provider in the chain
      }
    }

    throw new ProviderError(
      `All providers in mode "${this.mode}" failed. Attempts: ${errors.join(" | ")}`,
      "router",
      false
    );
  }
}
