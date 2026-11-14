import { z } from "zod";
import { ErrorTypeSchema, listTargets, toPublicDrill, type Drill } from "../../engine/drillSchema";
import type { Flag } from "../../engine/scoring";
import { callStructured } from "./call";
import { buildSolverSystemPrompt } from "./prompts";
import type { LlmLogger, StructuredProvider } from "./types";

/** A pool drill is kept if a blind solver finds at least this share of its planted mistakes. */
export const CROSS_CHECK_PASS_RATE = 0.5;

export interface CrossCheckResult {
  found: number;
  total: number;
  passed: boolean;
  flags: Flag[];
}

const DEFAULT_TIMEOUT_MS = 45_000;
const MAX_TOKENS = 1_500;

const ReviewSchema = z.object({
  flags: z.array(z.object({ targetId: z.string(), type: ErrorTypeSchema })),
});
const REVIEW_JSON_SCHEMA = z.toJSONSchema(ReviewSchema) as Record<string, unknown>;

/** Exactly what a player sees: the brief and the document. Nothing from the answer key. */
export function buildSolverPrompt(drill: Drill): string {
  const visible = toPublicDrill(drill);
  const lines: string[] = [
    `Brief — ${visible.brief.from} (${visible.brief.role}) asked the AI assistant: ${visible.brief.ask}`,
    "",
    `Document (${visible.artifact.kind}): ${visible.artifact.title}`,
  ];
  for (const block of visible.artifact.blocks) {
    if (block.type === "text") {
      for (const segment of block.segments) lines.push(`[${segment.id}] (${block.style}) ${segment.text}`);
    } else {
      lines.push(`Table columns: ${block.columns.join(" | ")}`);
      for (const row of block.rows) lines.push(row.map((cell) => `[${cell.id}] ${cell.text}`).join(" | "));
    }
  }
  lines.push("", `Flag at most ${visible.maxFlags} targets.`);
  return lines.join("\n");
}

/**
 * A different model solves the drill blind. If it finds at least half of the
 * planted mistakes, they are findable from the document alone — not arbitrary.
 * Throws when the solver itself fails; the caller decides what that means.
 */
export async function crossCheckDrill(
  drill: Drill,
  deps: { solver: StructuredProvider; log: LlmLogger; timeoutMs?: number },
): Promise<CrossCheckResult> {
  const response = await callStructured(
    deps.solver,
    {
      purpose: "cross_check",
      system: buildSolverSystemPrompt(),
      prompt: buildSolverPrompt(drill),
      toolName: "submit_review",
      toolDescription: "Return the targets you would overrule, each with its mistake type.",
      jsonSchema: REVIEW_JSON_SCHEMA,
      maxTokens: MAX_TOKENS,
      timeoutMs: deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    },
    deps.log,
    (answer) => (ReviewSchema.safeParse(answer.data).success ? undefined : "malformed review"),
  );

  const parsed = ReviewSchema.safeParse(response.data);
  const known = new Set(listTargets(drill.artifact).map((target) => target.id));
  const flags: Flag[] = (parsed.success ? parsed.data.flags : [])
    .filter((flag) => known.has(flag.targetId))
    .slice(0, drill.key.length + 2);
  const flagged = new Set(flags.map((flag) => flag.targetId));
  const found = drill.key.filter((item) => flagged.has(item.targetId)).length;
  return { found, total: drill.key.length, passed: found / drill.key.length >= CROSS_CHECK_PASS_RATE, flags };
}
