/**
 * Scoring an attempt.
 *
 * Whether a flag is a hit is decided here, by code, against the answer key — never by an LLM.
 * The only model-graded input is the optional "why" note on a hit (rubric 0–2). It arrives as
 * plain numbers in `whyScores`, so a slow or mistaken grader can cost a few bonus points but can
 * never invent or erase a catch.
 *
 *   maxPoints = Σ_key  (10·severity + 5 + 6)
 *   points    = Σ_hits (10·severity + 5·[type correct] + 3·why) − 5·false flags − 8·decoy flags
 *   p         = clamp(points / maxPoints, 0, 1)
 *
 * Worked example on the reference drill (tests/fixtures/reference-drill.json): flags on s3
 * (numbers, why 2), s6 (logic, why 1), the decoy s4 and the plain line s1
 * → 31 + 38 − 8 − 5 = 56 of 144, p ≈ 0.389.
 */
import { EXTRA_FLAGS, type Drill, type ErrorType, type KeyItem, type Severity } from "./drillSchema";

export interface Flag {
  targetId: string;
  type: ErrorType;
  /** Optional free-text note. It is graded elsewhere and comes back in as a `WhyScore`. */
  why?: string;
}

/** Rubric for the "why" note: 2 = named the core problem, 1 = partly, 0 = missed it. */
export type WhyScore = 0 | 1 | 2;

/**
 * Severity carries most of the weight: spotting a mistake that would cost money matters more than
 * labelling it. A decoy costs more than a plain false flag because the document itself shows a
 * decoy is right — flagging it means overruling without checking.
 */
export const POINTS = {
  perSeverity: 10,
  correctType: 5,
  perWhyPoint: 3,
  maxWhy: 2,
  falseFlag: 5,
  decoyFlag: 8,
} as const;

export interface HitOutcome {
  targetId: string;
  keyType: ErrorType;
  flaggedType: ErrorType;
  typeCorrect: boolean;
  severity: Severity;
  why: WhyScore;
  points: number;
}

/** How one key item ended up: flagged with the right type, flagged with another type, or not flagged. */
export type KeyCell = "caught" | "wrong_type" | "missed";

export interface ScoreResult {
  /** Not clamped: penalties can take it below zero. */
  points: number;
  maxPoints: number;
  /** points / maxPoints clamped to [0, 1] — the result the rating update consumes. */
  p: number;
  /** Key items the user flagged, in key order. */
  hits: HitOutcome[];
  /** Key targetIds the user did not flag, in key order. */
  missed: string[];
  /** Flagged targetIds that are plain lines, in the order they were flagged. */
  falseFlags: string[];
  /** Flagged targetIds that are decoys, in the order they were flagged. */
  decoyFlags: string[];
  /** One per key item, in key order. */
  cells: KeyCell[];
}

function hitPoints(severity: Severity, typeCorrect: boolean, why: WhyScore): number {
  return POINTS.perSeverity * severity + (typeCorrect ? POINTS.correctType : 0) + POINTS.perWhyPoint * why;
}

/** The score of a flawless attempt: every key item caught, typed correctly and fully explained. */
export function maxPoints(key: Drill["key"]): number {
  return key.reduce((sum, item) => sum + hitPoints(item.severity, true, POINTS.maxWhy), 0);
}

/**
 * What actually counts from a submission. The first flag per target wins: the UI toggles flags,
 * so a repeat can only come from a hand-made request and must not be scored twice. Repeats are
 * dropped before the budget is applied, so they do not use it up. The budget itself is what
 * makes "flag every line" impossible rather than merely unprofitable.
 */
export function normalizeFlags(flags: ReadonlyArray<Flag>, maxFlags: number): Flag[] {
  const firstPerTarget = new Map<string, Flag>();
  for (const flag of flags) {
    if (!firstPerTarget.has(flag.targetId)) firstPerTarget.set(flag.targetId, flag);
  }
  return [...firstPerTarget.values()].slice(0, Math.max(0, maxFlags));
}

function toHit(item: KeyItem, flag: Flag, why: WhyScore): HitOutcome {
  const typeCorrect = flag.type === item.type;
  return {
    targetId: item.targetId,
    keyType: item.type,
    flaggedType: flag.type,
    typeCorrect,
    severity: item.severity,
    why,
    points: hitPoints(item.severity, typeCorrect, why),
  };
}

function gradeKey(
  key: Drill["key"],
  flagByTarget: ReadonlyMap<string, Flag>,
  whyByTarget: ReadonlyMap<string, WhyScore>,
): Pick<ScoreResult, "hits" | "missed" | "cells"> {
  const hits: HitOutcome[] = [];
  const missed: string[] = [];
  const cells: KeyCell[] = [];
  for (const item of key) {
    const flag = flagByTarget.get(item.targetId);
    if (!flag) {
      missed.push(item.targetId);
      cells.push("missed");
      continue;
    }
    const hit = toHit(item, flag, whyByTarget.get(item.targetId) ?? 0);
    hits.push(hit);
    cells.push(hit.typeCorrect ? "caught" : "wrong_type");
  }
  return { hits, missed, cells };
}

/** Flags that hit nothing in the key, split into decoys and plain lines. */
function gradeStrays(
  drill: Pick<Drill, "key" | "decoys">,
  flags: ReadonlyArray<Flag>,
): Pick<ScoreResult, "falseFlags" | "decoyFlags"> {
  const keyTargets = new Set(drill.key.map((item) => item.targetId));
  const decoyTargets = new Set(drill.decoys.map((decoy) => decoy.targetId));
  const falseFlags: string[] = [];
  const decoyFlags: string[] = [];
  for (const { targetId } of flags) {
    if (keyTargets.has(targetId)) continue;
    (decoyTargets.has(targetId) ? decoyFlags : falseFlags).push(targetId);
  }
  return { falseFlags, decoyFlags };
}

/** The schema forbids an empty key, but the type does not: 0 keeps a NaN out of the rating. */
function shareOfMax(points: number, max: number): number {
  if (max === 0) return 0;
  return Math.min(1, Math.max(0, points / max));
}

/**
 * Scores a submission against the answer key. `whyScores` is keyed by targetId and only counts on
 * hits; a hit without a graded note gets 0 for "why". Scoring once without `whyScores` is how the
 * caller finds out which notes are worth grading at all.
 */
export function scoreAttempt(
  drill: Pick<Drill, "key" | "decoys">,
  flags: ReadonlyArray<Flag>,
  whyScores: Readonly<Record<string, WhyScore>> = {},
): ScoreResult {
  const counted = normalizeFlags(flags, drill.key.length + EXTRA_FLAGS);
  const flagByTarget = new Map(counted.map((flag) => [flag.targetId, flag]));
  // Own entries only: a target id such as "constructor" must not read from Object.prototype.
  const whyByTarget = new Map(Object.entries(whyScores));

  const { hits, missed, cells } = gradeKey(drill.key, flagByTarget, whyByTarget);
  const { falseFlags, decoyFlags } = gradeStrays(drill, counted);

  const max = maxPoints(drill.key);
  const points =
    hits.reduce((sum, hit) => sum + hit.points, 0) -
    POINTS.falseFlag * falseFlags.length -
    POINTS.decoyFlag * decoyFlags.length;

  return { points, maxPoints: max, p: shareOfMax(points, max), hits, missed, falseFlags, decoyFlags, cells };
}
