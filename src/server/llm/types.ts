/**
 * Provider-neutral contract for the model layer. The rest of the server only
 * knows "ask a provider for one JSON object that matches a schema" — which makes
 * the model a replaceable part behind deterministic verification.
 */

export type ProviderName = "claude" | "gemini";

/** Why a model was called — recorded with every call for /metrics. */
export type LlmPurpose = "generate" | "grade_why" | "cross_check";

export interface LlmCallRecord {
  purpose: LlmPurpose;
  provider: ProviderName;
  model: string;
  ms: number;
  ok: boolean;
  inputTokens?: number;
  outputTokens?: number;
  /** Short reason when `ok` is false: a provider error, or "verify: <codes>" for a rejected draft. */
  error?: string;
}

export type LlmLogger = (record: LlmCallRecord) => void;

export interface StructuredRequest {
  purpose: LlmPurpose;
  system: string;
  prompt: string;
  /** Name and description of the single "tool" whose input is the answer. */
  toolName: string;
  toolDescription: string;
  /** JSON Schema of the answer (object at the root). */
  jsonSchema: Record<string, unknown>;
  maxTokens: number;
  timeoutMs: number;
  /** Override the provider's default model for this call. */
  model?: string;
}

export interface StructuredResponse {
  /** The parsed JSON answer — untrusted until validated by the caller. */
  data: unknown;
  inputTokens?: number;
  outputTokens?: number;
}

export interface StructuredProvider {
  readonly name: ProviderName;
  readonly model: string;
  generate(request: StructuredRequest): Promise<StructuredResponse>;
}

export type LlmErrorKind = "http" | "timeout" | "network" | "malformed";

const MAX_ERROR_LENGTH = 300;

/** A provider failure. The message is short and never contains keys or request bodies. */
export class LlmError extends Error {
  constructor(
    readonly provider: ProviderName,
    readonly kind: LlmErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(`${provider}${status === undefined ? "" : ` ${status}`}: ${message}`.slice(0, MAX_ERROR_LENGTH));
    this.name = "LlmError";
  }
}
