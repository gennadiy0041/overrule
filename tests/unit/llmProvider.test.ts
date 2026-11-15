/**
 * The Claude client and its strict tool schema, against a fake `fetch`: no network.
 */
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { DrillContentSchema } from "../../src/engine/drillSchema";
import { createClaudeProvider } from "../../src/server/llm/anthropic";
import { toAnthropicStrictSchema } from "../../src/server/llm/schema";
import { LlmError, type StructuredRequest } from "../../src/server/llm/types";

const REQUEST: StructuredRequest = {
  purpose: "generate",
  system: "You write drills.",
  prompt: "Write one.",
  toolName: "emit_drill",
  toolDescription: "Return the drill.",
  jsonSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: { title: { type: "string", minLength: 3, maxLength: 140 } },
    required: ["title"],
    additionalProperties: false,
  },
  maxTokens: 1_000,
  timeoutMs: 5_000,
};

interface SentTool {
  strict?: boolean;
  input_schema: Record<string, unknown>;
}

/** A fake Messages API: answers each request with the next scripted response and records what was sent. */
function fakeApi(responses: Array<{ status: number; body: unknown }>) {
  const sent: SentTool[] = [];
  const fetchFake = (async (_url: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body)) as { tools: SentTool[] };
    sent.push(body.tools[0]!);
    const next = responses.shift() ?? { status: 500, body: { error: "no scripted response" } };
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as unknown as typeof fetch;
  return { fetchFake, sent };
}

const TOOL_ANSWER = {
  status: 200,
  body: {
    stop_reason: "tool_use",
    content: [{ type: "tool_use", name: "emit_drill", input: { title: "Q3 summary" } }],
    usage: { input_tokens: 120, output_tokens: 40 },
  },
};

describe("strict tool schema", () => {
  const strict = toAnthropicStrictSchema(z.toJSONSchema(DrillContentSchema) as Record<string, unknown>);
  const text = JSON.stringify(strict);

  test("carries no keyword a strict schema refuses, and closes every object", () => {
    expect(text).not.toMatch(/"(\$schema|minLength|maxLength|minItems|maxItems|minimum|maximum|oneOf|pattern)":/);
    const objects = text.match(/"type":"object"/g)?.length ?? 0;
    expect(objects).toBeGreaterThan(5);
    expect(text.match(/"additionalProperties":false/g)?.length).toBe(objects);
  });

  test("keeps the limits readable for the model as descriptions", () => {
    const brief = (strict["properties"] as Record<string, { properties: Record<string, { description?: string }> }>)["brief"]!;
    expect(brief.properties["ask"]?.description).toBe("Length in characters: 10 to 900.");
    expect(text).toContain("Number of items: 1 to 14.");
  });

  test("property names that look like keywords are data and survive", () => {
    const converted = toAnthropicStrictSchema({
      type: "object",
      properties: { maxLength: { type: "string", description: "A label.", maxLength: 5 } },
      required: ["maxLength"],
    }) as { properties: Record<string, { description: string }>; additionalProperties: boolean };
    expect(converted.properties["maxLength"]?.description).toBe("A label. Length in characters: at most 5.");
    expect(converted.additionalProperties).toBe(false);
  });
});

describe("Claude client", () => {
  test("declares the tool strict and reads the answer from the tool call", async () => {
    const api = fakeApi([TOOL_ANSWER]);
    const provider = createClaudeProvider({ apiKey: "test-key", model: "claude-sonnet-5-5", fetch: api.fetchFake });
    const answer = await provider.generate(REQUEST);
    expect(answer).toEqual({ data: { title: "Q3 summary" }, inputTokens: 120, outputTokens: 40 });
    expect(api.sent).toHaveLength(1);
    expect(api.sent[0]!.strict).toBe(true);
    expect(JSON.stringify(api.sent[0]!.input_schema)).not.toContain("maxLength");
  });

  test("when the API refuses the strict schema, the same request goes out without it, from then on", async () => {
    const refusal = { status: 400, body: { error: { type: "invalid_request_error", message: "tools.0.input_schema: unsupported schema" } } };
    const api = fakeApi([refusal, TOOL_ANSWER, TOOL_ANSWER]);
    const provider = createClaudeProvider({ apiKey: "test-key", model: "claude-sonnet-5-5", fetch: api.fetchFake });

    expect((await provider.generate(REQUEST)).data).toEqual({ title: "Q3 summary" });
    expect(api.sent.map((tool) => tool.strict === true)).toEqual([true, false]);
    expect(JSON.stringify(api.sent[1]!.input_schema)).toContain("maxLength");

    await provider.generate(REQUEST);
    expect(api.sent.map((tool) => tool.strict === true)).toEqual([true, false, false]);
  });

  test("a 400 that is not about the schema (no credit) fails as before and keeps strict on", async () => {
    const noCredit = { status: 400, body: { error: { type: "invalid_request_error", message: "Your credit balance is too low" } } };
    const api = fakeApi([noCredit, TOOL_ANSWER]);
    const provider = createClaudeProvider({ apiKey: "test-key", model: "claude-sonnet-5-5", fetch: api.fetchFake });

    await expect(provider.generate(REQUEST)).rejects.toBeInstanceOf(LlmError);
    expect(api.sent).toHaveLength(1);
    await provider.generate(REQUEST);
    expect(api.sent[1]!.strict).toBe(true);
  });

  test("an answer without the tool call, or cut off at the token limit, is a failure", async () => {
    const prose = { status: 200, body: { stop_reason: "end_turn", content: [{ type: "text", text: "Here is the drill…" }] } };
    const cutOff = { status: 200, body: { stop_reason: "max_tokens", content: [] } };
    const api = fakeApi([prose, cutOff]);
    const provider = createClaudeProvider({ apiKey: "test-key", model: "claude-sonnet-5-5", fetch: api.fetchFake });
    await expect(provider.generate(REQUEST)).rejects.toThrow("no tool call in the answer");
    await expect(provider.generate(REQUEST)).rejects.toThrow("answer cut off at max_tokens");
  });
});
