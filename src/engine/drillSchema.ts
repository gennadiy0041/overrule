/**
 * The drill contract — shared by the generator, the verifier, the scorer and the UI.
 *
 * A drill is a realistic work document "written by AI" with 3–4 planted mistakes
 * (`key`) and up to two lines that only look wrong (`decoys`). The answer key
 * (`key`, `decoys`, `numericChecks`) never leaves the server before the user
 * submits — see `toPublicDrill`.
 */
import { z } from "zod";

export const ERROR_TYPES = ["numbers", "facts", "logic", "risk", "audience"] as const;
export const ErrorTypeSchema = z.enum(ERROR_TYPES);
export type ErrorType = z.infer<typeof ErrorTypeSchema>;

/** Human-readable definitions; also fed to the generator prompt. */
export const ERROR_TYPE_INFO: Readonly<Record<ErrorType, { label: string; hint: string }>> = {
  numbers: { label: "Numbers", hint: "Arithmetic, % vs points, wrong base, totals that don't add up, units" },
  facts: { label: "Facts", hint: "A claim that isn't in the source data; an invented statistic or source" },
  logic: { label: "Logic", hint: "The conclusion contradicts the data; correlation sold as cause" },
  risk: { label: "Risk", hint: "Legal, compliance or privacy exposure; an unsupported absolute claim" },
  audience: { label: "Audience", hint: "Ignores what was asked; wrong tone or length; internal info sent outside" },
};

export const LEVELS = [1, 2, 3, 4, 5] as const;
export const LevelSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);
export type Level = z.infer<typeof LevelSchema>;

export interface LevelSpec {
  minErrors: number;
  maxErrors: number;
  decoys: number;
  maxWords: number;
  subtlety: string;
}

export const LEVEL_SPECS: Readonly<Record<Level, LevelSpec>> = {
  1: { minErrors: 3, maxErrors: 3, decoys: 0, maxWords: 150, subtlety: "Obvious mistakes" },
  2: { minErrors: 3, maxErrors: 3, decoys: 1, maxWords: 200, subtlety: "Noticeable on a careful read" },
  3: { minErrors: 3, maxErrors: 4, decoys: 1, maxWords: 280, subtlety: "Subtle wording" },
  4: { minErrors: 4, maxErrors: 4, decoys: 2, maxWords: 380, subtlety: "Multi-step maths" },
  5: { minErrors: 4, maxErrors: 4, decoys: 2, maxWords: 480, subtlety: "Text must be checked against the table" },
};

/** A flaggable unit: one sentence-sized run of text, or one table cell. */
export const SegmentSchema = z.object({
  id: z.string().min(1).max(16),
  text: z.string().min(1).max(700),
});
export type Segment = z.infer<typeof SegmentSchema>;

export const TextBlockSchema = z.object({
  type: z.literal("text"),
  style: z.enum(["subject", "heading", "paragraph", "bullet"]),
  segments: z.array(SegmentSchema).min(1).max(12),
});

export const TableBlockSchema = z.object({
  type: z.literal("table"),
  columns: z.array(z.string().min(1).max(60)).min(2).max(7),
  rows: z.array(z.array(SegmentSchema).min(2).max(7)).min(1).max(12),
});

export const BlockSchema = z.discriminatedUnion("type", [TextBlockSchema, TableBlockSchema]);
export type Block = z.infer<typeof BlockSchema>;

export const ARTIFACT_KINDS = ["email", "report", "summary", "policy", "reply", "plan"] as const;

export const ArtifactSchema = z.object({
  kind: z.enum(ARTIFACT_KINDS),
  title: z.string().min(3).max(140),
  blocks: z.array(BlockSchema).min(1).max(14),
});
export type Artifact = z.infer<typeof ArtifactSchema>;

/** Who asked the AI for this document, and what they asked for. */
export const BriefSchema = z.object({
  from: z.string().min(2).max(80),
  role: z.string().min(2).max(120),
  // The ask carries the source figures and constraints a reviewer needs, so it can run long.
  ask: z.string().min(10).max(900),
});

export const SeveritySchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type Severity = z.infer<typeof SeveritySchema>;

export const KeyItemSchema = z.object({
  targetId: z.string().min(1),
  type: ErrorTypeSchema,
  /** 1 = cosmetic, 2 = would embarrass you, 3 = would cost money or trust. */
  severity: SeveritySchema,
  explanation: z.string().min(10).max(500),
  correction: z.string().min(3).max(400),
  /** A reusable habit: what to look for next time. */
  cue: z.string().min(3).max(200),
});
export type KeyItem = z.infer<typeof KeyItemSchema>;

export const DecoySchema = z.object({
  targetId: z.string().min(1),
  looksWrongBecause: z.string().min(3).max(300),
  fineBecause: z.string().min(3).max(400),
});
export type Decoy = z.infer<typeof DecoySchema>;

/**
 * A machine-checkable claim about a number in the document. `expression` is plain
 * arithmetic (numbers, + − * /, parentheses) evaluated by engine/safeMath.
 * For a planted error the stated value must be off by more than `tolerance`;
 * for a correct line it must be within it.
 */
export const NumericCheckSchema = z.object({
  targetId: z.string().min(1),
  expression: z.string().min(1).max(200),
  stated: z.number(),
  tolerance: z.number().nonnegative(),
  isError: z.boolean(),
});
export type NumericCheck = z.infer<typeof NumericCheckSchema>;

/** The part of a drill an LLM writes. */
export const DrillContentSchema = z.object({
  brief: BriefSchema,
  artifact: ArtifactSchema,
  key: z.array(KeyItemSchema).min(3).max(4),
  decoys: z.array(DecoySchema).max(2),
  numericChecks: z.array(NumericCheckSchema).max(24),
});
export type DrillContent = z.infer<typeof DrillContentSchema>;

/** A complete drill: generated content plus the task it trains. */
export const DrillSchema = DrillContentSchema.extend({
  id: z.string().min(1),
  soc: z.string().regex(/^\d{2}-\d{4}\.\d{2}$/),
  occupation: z.string().min(1),
  /** The O*NET task (E1/E2 only) this drill trains. */
  taskId: z.number().int(),
  task: z.string().min(1),
  level: LevelSchema,
});
export type Drill = z.infer<typeof DrillSchema>;

/** What the client may see before submitting: no key, no decoys, no numeric checks. */
export type PublicDrill = Omit<Drill, "key" | "decoys" | "numericChecks"> & {
  /** Flag budget: number of planted errors + 2. */
  maxFlags: number;
};

export const EXTRA_FLAGS = 2;

export function toPublicDrill(drill: Drill): PublicDrill {
  return {
    id: drill.id,
    soc: drill.soc,
    occupation: drill.occupation,
    taskId: drill.taskId,
    task: drill.task,
    level: drill.level,
    brief: drill.brief,
    artifact: drill.artifact,
    maxFlags: drill.key.length + EXTRA_FLAGS,
  };
}

/** Every flaggable segment and table cell, in reading order. */
export function listTargets(artifact: Artifact): Segment[] {
  const targets: Segment[] = [];
  for (const block of artifact.blocks) {
    if (block.type === "text") targets.push(...block.segments);
    else for (const row of block.rows) targets.push(...row);
  }
  return targets;
}

/** Word count of everything the reader sees (title, text, table headers and cells). */
export function countWords(artifact: Artifact): number {
  const parts: string[] = [artifact.title];
  for (const block of artifact.blocks) {
    if (block.type === "table") parts.push(...block.columns);
  }
  parts.push(...listTargets(artifact).map((t) => t.text));
  return parts.join(" ").split(/\s+/).filter(Boolean).length;
}
