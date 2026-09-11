export interface CompletionRequest {
  /** System prompt establishing the agent's role, expertise, and output expectations. */
  system: string;
  /** The task/context for this specific call. */
  prompt: string;
  /** Soft cap the provider should aim for; not all providers enforce it. */
  maxTokens?: number;
}

export interface CompletionResult {
  text: string;
  /** Which provider actually served the request (for logging/audit). */
  providerName: string;
  /** e.g. "anthropic-direct", "openrouter:key-3", "passthru" */
  route: string;
}

export interface LLMProvider {
  readonly name: string;
  /** Returns true if this provider has what it needs (keys/auth) to attempt a call. */
  isAvailable(): Promise<boolean> | boolean;
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly providerName: string,
    readonly retryable: boolean,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
