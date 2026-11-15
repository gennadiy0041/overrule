import { fetchFailure } from "./anthropic";
import { LlmError, type StructuredProvider, type StructuredRequest, type StructuredResponse } from "./types";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const BODY_EXCERPT = 200;
/**
 * Gemini counts its hidden reasoning against the output budget, so the JSON can be
 * cut off long before `maxTokens` visible tokens. Leave generous headroom.
 */
const OUTPUT_HEADROOM = 4;

interface GenerateContentResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
}

function schemaInstruction(request: StructuredRequest): string {
  return `Return exactly one JSON object (${request.toolDescription}) that validates against this JSON Schema:\n${JSON.stringify(request.jsonSchema)}`;
}

/**
 * Gemini over plain `fetch`, in JSON mode. Its `responseSchema` dialect rejects our
 * nested union schema (HTTP 400), so the JSON Schema travels in the prompt instead;
 * the answer is validated by the same zod schema and verifier as any other draft.
 */
export function createGeminiProvider(options: { apiKey: string; model: string; fetch?: typeof fetch }): StructuredProvider {
  const send = options.fetch ?? fetch;

  async function generate(request: StructuredRequest): Promise<StructuredResponse> {
    let status: number;
    let text: string;
    try {
      const response = await send(`${API_BASE}/${request.model ?? options.model}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": options.apiKey, "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: [{ role: "user", parts: [{ text: `${request.prompt}\n\n${schemaInstruction(request)}` }] }],
          generationConfig: {
            responseMimeType: "application/json",
            maxOutputTokens: request.maxTokens * OUTPUT_HEADROOM,
          },
        }),
        signal: AbortSignal.timeout(request.timeoutMs),
      });
      status = response.status;
      text = await response.text();
    } catch (error) {
      throw fetchFailure("gemini", error);
    }

    if (status < 200 || status >= 300) throw new LlmError("gemini", "http", text.slice(0, BODY_EXCERPT), status);

    let body: GenerateContentResponse;
    try {
      body = JSON.parse(text) as GenerateContentResponse;
    } catch {
      throw new LlmError("gemini", "malformed", "response is not JSON");
    }
    const candidate = body.candidates?.[0];
    if (candidate?.finishReason === "MAX_TOKENS") throw new LlmError("gemini", "malformed", "answer cut off at MAX_TOKENS");
    const answer = candidate?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    if (answer.trim() === "") throw new LlmError("gemini", "malformed", `empty answer (${candidate?.finishReason ?? "no candidate"})`);

    let data: unknown;
    try {
      data = JSON.parse(answer);
    } catch {
      throw new LlmError("gemini", "malformed", "answer is not valid JSON");
    }
    const usage = body.usageMetadata;
    return {
      data,
      ...(usage?.promptTokenCount === undefined ? {} : { inputTokens: usage.promptTokenCount }),
      // Hidden reasoning is billed as output, so it belongs in the count the budget is built on.
      ...(usage?.candidatesTokenCount === undefined
        ? {}
        : { outputTokens: usage.candidatesTokenCount + (usage.thoughtsTokenCount ?? 0) }),
    };
  }

  return { name: "gemini", model: options.model, generate };
}
