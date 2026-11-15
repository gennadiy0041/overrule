import { z } from "zod";
import type { WhyScore } from "../../engine/scoring";
import { heuristicWhyScore } from "../../engine/whyHeuristic";
import { callStructured } from "./call";
import { buildGradingSystemPrompt } from "./prompts";
import type { LlmLogger, StructuredProvider } from "./types";

export interface WhyItem {
  targetId: string;
  /** The player's note — untrusted input. */
  why: string;
  explanation: string;
  correction: string;
  cue: string;
}

const DEFAULT_TIMEOUT_MS = 12_000;
/** Room for the model's own working-out plus one score per note; an answer cut off here falls back to the heuristic. */
const MAX_TOKENS = 2_000;

const GradesSchema = z.object({
  scores: z.array(
    z.object({
      targetId: z.string(),
      score: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    }),
  ),
});
const GRADES_JSON_SCHEMA = z.toJSONSchema(GradesSchema) as Record<string, unknown>;

function buildPrompt(items: ReadonlyArray<WhyItem>): string {
  const blocks = items.map(
    (item) =>
      `targetId: ${item.targetId}\nActual problem: ${item.explanation} Fix: ${item.correction}\n<note>${item.why.replace(/<\/?note>/gi, "")}</note>`,
  );
  return `Grade these ${items.length} notes. Return one score per targetId.\n\n${blocks.join("\n\n")}`;
}

function heuristic(items: ReadonlyArray<WhyItem>): Record<string, WhyScore> {
  return Object.fromEntries(items.map((item) => [item.targetId, heuristicWhyScore(item.why, item)]));
}

/**
 * Grade the optional "why" notes of one attempt in a single model call.
 * This is the only place a model influences a score, and it is bounded: on any
 * failure — no provider, an error, a timeout, a malformed or incomplete answer —
 * the keyword heuristic grades every note instead.
 */
export async function gradeWhy(
  items: ReadonlyArray<WhyItem>,
  deps: { provider?: StructuredProvider; log: LlmLogger; timeoutMs?: number },
): Promise<Record<string, WhyScore>> {
  if (items.length === 0) return {};
  if (!deps.provider) return heuristic(items);

  let grades: Record<string, WhyScore> | undefined;
  try {
    await callStructured(
      deps.provider,
      {
        purpose: "grade_why",
        system: buildGradingSystemPrompt(),
        prompt: buildPrompt(items),
        toolName: "grade_notes",
        toolDescription: "Return a 0–2 score for every note.",
        jsonSchema: GRADES_JSON_SCHEMA,
        maxTokens: MAX_TOKENS,
        timeoutMs: deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      },
      deps.log,
      (response) => {
        const parsed = GradesSchema.safeParse(response.data);
        if (!parsed.success) return "malformed grades";
        const byTarget = new Map(parsed.data.scores.map((entry) => [entry.targetId, entry.score]));
        if (items.some((item) => !byTarget.has(item.targetId))) return "incomplete grades";
        grades = Object.fromEntries(items.map((item) => [item.targetId, byTarget.get(item.targetId)!]));
        return undefined;
      },
    );
  } catch {
    // Logged by callStructured; the heuristic takes over below.
  }
  return grades ?? heuristic(items);
}
