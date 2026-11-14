import { listTargets, type Drill } from "../../engine/drillSchema";
import type { Flag, ScoreResult } from "../../engine/scoring";
import type { Annotation } from "../../shared/api";

/**
 * Turn a scored attempt into per-line annotations for the result page, in reading
 * order. This is where the answer key is revealed — only ever called after a
 * submission has been scored.
 */
export function buildAnnotations(drill: Drill, flags: ReadonlyArray<Flag>, score: ScoreResult): Annotation[] {
  const flagByTarget = new Map(flags.map((flag) => [flag.targetId, flag]));
  const hitByTarget = new Map(score.hits.map((hit) => [hit.targetId, hit]));
  const keyByTarget = new Map(drill.key.map((item) => [item.targetId, item]));
  const decoyByTarget = new Map(drill.decoys.map((decoy) => [decoy.targetId, decoy]));

  const annotations: Annotation[] = [];
  for (const { id } of listTargets(drill.artifact)) {
    const flag = flagByTarget.get(id);
    const keyItem = keyByTarget.get(id);
    const decoy = decoyByTarget.get(id);

    if (keyItem) {
      const hit = hitByTarget.get(id);
      annotations.push({
        targetId: id,
        kind: hit ? (hit.typeCorrect ? "caught" : "wrong_type") : "missed",
        keyType: keyItem.type,
        severity: keyItem.severity,
        explanation: keyItem.explanation,
        correction: keyItem.correction,
        cue: keyItem.cue,
        ...(hit ? { flaggedType: hit.flaggedType, whyScore: hit.why, points: hit.points } : {}),
        ...(flag?.why ? { why: flag.why } : {}),
      });
    } else if (decoy) {
      annotations.push({
        targetId: id,
        kind: flag ? "decoy_flagged" : "decoy_avoided",
        looksWrongBecause: decoy.looksWrongBecause,
        fineBecause: decoy.fineBecause,
        ...(flag ? { flaggedType: flag.type } : {}),
        ...(flag?.why ? { why: flag.why } : {}),
      });
    } else if (flag) {
      annotations.push({
        targetId: id,
        kind: "false_flag",
        flaggedType: flag.type,
        ...(flag.why ? { why: flag.why } : {}),
      });
    }
  }
  return annotations;
}

/** "What to watch for": the habit behind each mistake — the ones that were missed come first. */
export function collectCues(drill: Drill, score: ScoreResult): string[] {
  const missed = new Set(score.missed);
  const ordered = [...drill.key].sort((a, b) => Number(missed.has(b.targetId)) - Number(missed.has(a.targetId)));
  return [...new Set(ordered.map((item) => item.cue))];
}
