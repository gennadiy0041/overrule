/**
 * Callers describe the answer they want as one neutral JSON Schema (zod's
 * `z.toJSONSchema`). Each provider accepts a different dialect, so each client
 * adapts the schema itself with the pure helpers below.
 */

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Anthropic tool input: plain JSON Schema with an object root; only the `$schema` marker has to go. */
export function toAnthropicInputSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _dialect, ...rest } = schema;
  return rest;
}

/** Keywords a strict Anthropic tool schema does not accept: sizes and ranges are checked by our own code instead. */
const STRICT_UNSUPPORTED: ReadonlySet<string> = new Set([
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "pattern",
  "uniqueItems",
]);

function rangeHint(noun: string, min: Json | undefined, max: Json | undefined): string | null {
  if (typeof min === "number" && typeof max === "number") return `${noun}: ${min} to ${max}.`;
  if (typeof max === "number") return `${noun}: at most ${max}.`;
  if (typeof min === "number") return `${noun}: at least ${min}.`;
  return null;
}

function strictNode(node: Json): Json {
  if (Array.isArray(node)) return node.map(strictNode);
  if (!isObject(node)) return node;

  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "$schema" || STRICT_UNSUPPORTED.has(key)) continue;
    if (key === "oneOf") out["anyOf"] = strictNode(value);
    else if (key === "properties" && isObject(value)) {
      // Property names are data, not keywords: only their schemas are rewritten.
      out[key] = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, strictNode(child)]));
    } else out[key] = strictNode(value);
  }

  // The limits the grammar cannot enforce stay visible to the model as plain words.
  const hints = [
    rangeHint("Length in characters", node["minLength"], node["maxLength"]),
    rangeHint("Number of items", node["minItems"], node["maxItems"]),
    rangeHint("Value", node["minimum"], node["maximum"]),
  ].filter((hint): hint is string => hint !== null);
  if (hints.length > 0) {
    out["description"] = [typeof node["description"] === "string" ? node["description"] : "", ...hints].join(" ").trim();
  }
  if (out["type"] === "object" && !("additionalProperties" in out)) out["additionalProperties"] = false;
  return out;
}

/**
 * Anthropic strict tool input: the answer is decoded against the schema itself, so a
 * field can no longer arrive with the wrong shape (an object sent as a string, a value
 * outside an enum). Strict schemas accept no size or range keywords; those are dropped
 * here, kept as hints in the descriptions, and still enforced by zod and the verifier.
 */
export function toAnthropicStrictSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return strictNode(schema as JsonObject) as Record<string, unknown>;
}

/** Keywords Gemini's `responseSchema` (an OpenAPI 3.0 subset) understands. Everything else is dropped. */
const GEMINI_KEYWORDS: ReadonlySet<string> = new Set([
  "type",
  "description",
  "enum",
  "properties",
  "required",
  "items",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "anyOf",
  "nullable",
]);

/** `anyOf: [{const: 1}, {const: 2}, {const: 3}]` — a union of literals. */
function literalUnion(node: JsonObject): Json[] | null {
  const options = node["anyOf"] ?? node["oneOf"];
  if (!Array.isArray(options) || options.length === 0) return null;
  const values: Json[] = [];
  for (const option of options) {
    if (!isObject(option) || !("const" in option)) return null;
    values.push(option["const"]!);
  }
  return values;
}

function convert(node: Json): Json {
  if (Array.isArray(node)) return node.map(convert);
  if (!isObject(node)) return node;

  // Gemini enums are strings only: numeric literal unions become an integer range.
  const literals = literalUnion(node);
  if (literals) {
    if (literals.every((value): value is number => typeof value === "number")) {
      return { type: "integer", minimum: Math.min(...literals), maximum: Math.max(...literals) };
    }
    return { type: "string", enum: literals.map(String) };
  }
  if ("const" in node) {
    const value = node["const"]!;
    return typeof value === "number"
      ? { type: "integer", minimum: value, maximum: value }
      : { type: "string", enum: [String(value)] };
  }

  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "oneOf") out["anyOf"] = convert(value);
    else if (key === "properties" && isObject(value)) {
      out[key] = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, convert(child)]));
    } else if (GEMINI_KEYWORDS.has(key)) out[key] = convert(value);
  }
  return out;
}

/** Gemini `responseSchema`: no `$schema`, `additionalProperties`, `const`, `oneOf` or string-length keywords. */
export function toGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return convert(schema as JsonObject) as Record<string, unknown>;
}
