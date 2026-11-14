import { typeStats, type TypeStat } from "../../engine/adaptive";
import { addDays } from "../../engine/daily";
import { ERROR_TYPE_INFO, ERROR_TYPES, type ErrorType } from "../../engine/drillSchema";
import type { AttemptResult, WeeklyDebrief } from "../../shared/api";
import { typeOutcomes } from "./drillService";

const WINDOW_DAYS = 7;
const MIN_APPEARANCES = 2;

function rate(stat: TypeStat): number {
  return stat.caught / stat.appeared;
}

/** Best and worst mistake type by catch rate, among types seen at least twice. */
export function strongestAndWeakest(stats: Record<ErrorType, TypeStat>): {
  strongest: ErrorType | null;
  weakest: ErrorType | null;
} {
  const seen = ERROR_TYPES.filter((type) => stats[type].appeared >= MIN_APPEARANCES);
  if (seen.length === 0) return { strongest: null, weakest: null };
  const ranked = [...seen].sort((a, b) => rate(stats[b]) - rate(stats[a]) || stats[b].appeared - stats[a].appeared);
  const strongest = ranked[0]!;
  const weakest = ranked[ranked.length - 1]!;
  return { strongest, weakest: weakest === strongest || rate(stats[weakest]) === 1 ? null : weakest };
}

function signed(delta: number): string {
  return delta < 0 ? `−${Math.abs(delta)}` : `+${delta}`;
}

/**
 * The Weekly Debrief: a deterministic summary of the last seven ET days, written
 * from the attempt records by template — no model involved, nothing invented.
 * Free members get the headline; the detail lines are a Pro feature.
 */
export function buildWeeklyDebrief(
  attempts: ReadonlyArray<AttemptResult>,
  today: string,
  includeDetail: boolean,
): WeeklyDebrief | null {
  const from = addDays(today, -(WINDOW_DAYS - 1));
  const week = attempts.filter((a) => a.day >= from && a.day <= today);
  if (week.length === 0) return null;

  const caught = week.reduce((n, a) => n + a.caught, 0);
  const total = week.reduce((n, a) => n + a.total, 0);
  const falseFlags = week.reduce((n, a) => n + a.falseFlags + a.decoyFlags, 0);
  const ratingStart = week[0]!.rating.before;
  const ratingEnd = week[week.length - 1]!.rating.after;
  const stats = typeStats(week.map(typeOutcomes));
  const { strongest, weakest } = strongestAndWeakest(stats);

  const lines: string[] = [];
  if (includeDetail) {
    if (strongest) {
      const s = stats[strongest];
      lines.push(`Strongest: ${ERROR_TYPE_INFO[strongest].label} — ${s.caught} of ${s.appeared} caught.`);
    }
    if (weakest) {
      const w = stats[weakest];
      lines.push(
        `Watch: ${ERROR_TYPE_INFO[weakest].label} — ${w.caught} of ${w.appeared} caught. Your next practice drills will carry more of these.`,
      );
    }
    lines.push(
      falseFlags === 0
        ? "No false alarms: you only overruled what was actually wrong."
        : `${falseFlags} false ${falseFlags === 1 ? "alarm" : "alarms"}: lines you flagged that were fine. Over-flagging costs your team time.`,
    );
    lines.push(
      `Judgment Score ${signed(ratingEnd - ratingStart)} this week (${ratingStart.toLocaleString("en-US")} → ${ratingEnd.toLocaleString("en-US")}).`,
    );
  }

  return {
    from,
    to: today,
    drills: week.length,
    caught,
    total,
    falseFlags,
    ratingChange: ratingEnd - ratingStart,
    strongest,
    weakest,
    headline: `You caught ${caught} of ${total} planted mistakes in ${week.length} ${week.length === 1 ? "drill" : "drills"} this week.`,
    lines,
  };
}
