import { toAnthropicInputSchema } from "./schema";
import { LlmError, type StructuredProvider, type StructuredRequest, type StructuredResponse } from "./types";

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const BODY_EXCERPT = 200;

interface MessagesResponse {
  content?: Array<{ type: string; name?: string; input?: unknown }>;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** Turn a thrown fetch error into an `LlmError` without leaking the request. */
export function fetchFailure(provider: "claude" | "gemini", error: unknown): LlmError {
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError" || name === "AbortError") return new LlmError(provider, "timeout", "timed out");
  return new LlmError(provider, "network", name || "network error");
}

/**
 * Appended to every system prompt. Current Claude models reject a forced
 * `tool_choice`, so the single tool is offered with `auto` and the model is told
 * to answer through it. An answer without the tool call is treated as malformed
 * and takes the normal retry / fallback path.
 */
const TOOL_INSTRUCTION =
  "Respond by calling the provided tool exactly once. Do not answer in plain text; put the whole answer in the tool input.";

/**
 * Claude over plain `fetch`. Strict JSON comes from tool use: the answer is the
 * input of the one tool we define, described by a JSON Schema.
 */
export function createClaudeProvider(options: { apiKey: string; model: string; fetch?: typeof fetch }): StructuredProvider {
  const send = options.fetch ?? fetch;

  async function generate(request: StructuredRequest): Promise<StructuredResponse> {
    let status: number;
    let text: string;
    try {
      const response = await send(API_URL, {
        method: "POST",
        headers: {
          "x-api-key": options.apiKey,
          "anthropic-version": API_VERSION,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: request.model ?? options.model,
          max_tokens: request.maxTokens,
          system: `${request.system}\n\n${TOOL_INSTRUCTION}`,
          messages: [{ role: "user", content: request.prompt }],
          tools: [
            {
              name: request.toolName,
              description: request.toolDescription,
              input_schema: toAnthropicInputSchema(request.jsonSchema),
            },
          ],
          tool_choice: { type: "auto" },
        }),
        signal: AbortSignal.timeout(request.timeoutMs),
      });
      status = response.status;
      text = await response.text();
    } catch (error) {
      throw fetchFailure("claude", error);
    }

    if (status < 200 || status >= 300) throw new LlmError("claude", "http", text.slice(0, BODY_EXCERPT), status);

    let body: MessagesResponse;
    try {
      body = JSON.parse(text) as MessagesResponse;
    } catch {
      throw new LlmError("claude", "malformed", "response is not JSON");
    }
    if (body.stop_reason === "max_tokens") throw new LlmError("claude", "malformed", "answer cut off at max_tokens");
    const call = body.content?.find((block) => block.type === "tool_use" && block.name === request.toolName);
    if (!call || call.input === undefined) throw new LlmError("claude", "malformed", "no tool call in the answer");

    return {
      data: call.input,
      ...(body.usage?.input_tokens === undefined ? {} : { inputTokens: body.usage.input_tokens }),
      ...(body.usage?.output_tokens === undefined ? {} : { outputTokens: body.usage.output_tokens }),
    };
  }

  return { name: "claude", model: options.model, generate };
}
