import { typeStats, type TypeStat } from "../../engine/adaptive";
import { ERROR_TYPE_INFO, type ErrorType, type Severity } from "../../engine/drillSchema";
import type { AttemptResult } from "../../shared/api";
import { strongestAndWeakest } from "./debrief";
import { typeOutcomes } from "./drillService";

/**
 * A Review Report is a frozen snapshot of someone's practice record, shared by a
 * public link. It is computed from the attempt records by template — no model
 * writes any of it, so every number can be traced back to a scored drill.
 */
export interface ReportSnapshot {
  occupation: string;
  /** First and last ET day covered. */
  from: string;
  to: string;
  drills: number;
  caught: number;
  total: number;
  /** All flags raised, and how many of them hit lines that were fine. */
  flags: number;
  falseFlags: number;
  byType: Record<ErrorType, TypeStat>;
  ratingStart: number;
  ratingEnd: number;
  ratingSeries: Array<{ day: string; rating: number }>;
  bestCatches: Array<{ document: string; type: ErrorType; severity: Severity; what: string }>;
  /** Three sentences for a self-review, ready to paste. */
  summary: string;
  createdAt: string;
}

const BEST_CATCHES = 3;

function formatDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, date!)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function pct(part: number, whole: number): string {
  return whole === 0 ? "0%" : `${Math.round((part / whole) * 100)}%`;
}

function writeSummary(s: Omit<ReportSnapshot, "summary" | "createdAt">): string {
  const { strongest, weakest } = strongestAndWeakest(s.byType);
  const period = s.from === s.to ? `On ${formatDay(s.from)}` : `Between ${formatDay(s.from)} and ${formatDay(s.to)}`;
  const first =
    `${period}, I completed ${s.drills} AI-review ${s.drills === 1 ? "drill" : "drills"} on Overrule: ` +
    `AI-drafted ${s.occupation} documents with planted errors and lines that only look wrong.`;
  const strongestNote = strongest
    ? `, strongest on ${ERROR_TYPE_INFO[strongest].label.toLowerCase()} errors (${s.byType[strongest].caught}/${s.byType[strongest].appeared})`
    : "";
  const second =
    `I caught ${s.caught} of ${s.total} planted mistakes (${pct(s.caught, s.total)})${strongestNote}, ` +
    `and ${pct(s.falseFlags, s.flags)} of my flags were false alarms.`;
  const direction = s.ratingEnd >= s.ratingStart ? "rose" : "moved";
  const focus = weakest
    ? ` I am now focusing on ${ERROR_TYPE_INFO[weakest].label.toLowerCase()} errors, where I catch ${s.byType[weakest].caught} of ${s.byType[weakest].appeared}.`
    : "";
  const third =
    `My Judgment Score ${direction} from ${s.ratingStart.toLocaleString("en-US")} to ${s.ratingEnd.toLocaleString("en-US")}.` +
    focus;
  return `${first} ${second} ${third}`;
}

/** Null when there is nothing to report yet. */
export function buildReportSnapshot(
  occupation: string,
  attempts: ReadonlyArray<AttemptResult>,
  now: Date,
): ReportSnapshot | null {
  const first = attempts[0];
  const last = attempts[attempts.length - 1];
  if (!first || !last) return null;

  const caught = attempts.reduce((n, a) => n + a.caught, 0);
  const falseFlags = attempts.reduce((n, a) => n + a.falseFlags + a.decoyFlags, 0);

  // One point per day (the day's closing score), preceded by the starting score.
  const closing = new Map<string, number>();
  for (const attempt of attempts) closing.set(attempt.day, attempt.rating.after);

  const bestCatches = attempts
    .flatMap((attempt) =>
      attempt.annotations
        .filter((a) => a.kind === "caught" && a.keyType && a.severity && a.explanation)
        .map((a) => ({
          document: attempt.drill.artifact.title,
          type: a.keyType!,
          severity: a.severity!,
          what: a.explanation!,
          at: attempt.createdAt,
        })),
    )
    .sort((a, b) => b.severity - a.severity || b.at.localeCompare(a.at))
    .slice(0, BEST_CATCHES)
    .map(({ at: _at, ...rest }) => rest);

  const core = {
    occupation,
    from: first.day,
    to: last.day,
    drills: attempts.length,
    caught,
    total: attempts.reduce((n, a) => n + a.total, 0),
    flags: caught + falseFlags,
    falseFlags,
    byType: typeStats(attempts.map(typeOutcomes)),
    ratingStart: first.rating.before,
    ratingEnd: last.rating.after,
    ratingSeries: [...closing].map(([day, rating]) => ({ day, rating })),
    bestCatches,
  };
  return { ...core, summary: writeSummary(core), createdAt: now.toISOString() };
}

const ID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

/** A short, unguessable id for the public link (no look-alike characters). */
export function newPublicId(length = 12): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => ID_ALPHABET[byte % ID_ALPHABET.length]).join("");
}
