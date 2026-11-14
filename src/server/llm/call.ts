import type { LlmLogger, StructuredProvider, StructuredRequest, StructuredResponse } from "./types";

const MAX_ERROR_LENGTH = 300;

function describe(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR_LENGTH);
}

/**
 * Call a provider and record the outcome. Every model call in the product goes
 * through here, so `llm_calls` is a complete ledger of latency, cost and failures.
 *
 * `judge` lets the caller mark a technically successful call as failed — e.g. a
 * drill draft that the verifier rejected — by returning the reason.
 */
export async function callStructured(
  provider: StructuredProvider,
  request: StructuredRequest,
  log: LlmLogger,
  judge?: (response: StructuredResponse) => string | undefined,
): Promise<StructuredResponse> {
  const started = performance.now();
  const base = { purpose: request.purpose, provider: provider.name, model: request.model ?? provider.model };
  try {
    const response = await provider.generate(request);
    const rejection = judge?.(response);
    log({
      ...base,
      ms: performance.now() - started,
      ok: rejection === undefined,
      ...(response.inputTokens === undefined ? {} : { inputTokens: response.inputTokens }),
      ...(response.outputTokens === undefined ? {} : { outputTokens: response.outputTokens }),
      ...(rejection === undefined ? {} : { error: rejection.slice(0, MAX_ERROR_LENGTH) }),
    });
    return response;
  } catch (error) {
    log({ ...base, ms: performance.now() - started, ok: false, error: describe(error) });
    throw error;
  }
}
