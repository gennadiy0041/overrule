import { typeStats, weakSpot } from "../../engine/adaptive";
import { currentStreak, etDay } from "../../engine/daily";
import { percentileBelow } from "../../engine/exposure";
import type { AttemptResult, HistoryEntry, MeResponse, PercentileStatus } from "../../shared/api";
import { PRACTICE_DAILY_LIMIT } from "../../shared/pricing";
import type { AppContext } from "../context";
import { summarize } from "../occupationStore";
import { isPro, type Session } from "../repos/sessions";
import { buildWeeklyDebrief } from "./debrief";
import { typeOutcomes } from "./drillService";

/** A percentile is only shown against at least this many real players… */
export const PERCENTILE_MIN_PLAYERS = 20;
/** …each with at least this many scored drills. */
export const PERCENTILE_MIN_ATTEMPTS = 3;

function toHistoryEntry(attempt: AttemptResult): HistoryEntry {
  return {
    attemptId: attempt.attemptId,
    drillId: attempt.drillId,
    title: attempt.drill.artifact.title,
    mode: attempt.mode,
    level: attempt.drill.level,
    day: attempt.day,
    createdAt: attempt.createdAt,
    caught: attempt.caught,
    total: attempt.total,
    falseFlags: attempt.falseFlags + attempt.decoyFlags,
    ratingAfter: attempt.rating.after,
    delta: attempt.rating.delta,
  };
}

/**
 * Where a Judgment Score stands among real players (demo profiles and internal
 * traffic excluded): within the same occupation once it has enough players,
 * otherwise across everyone. Locked until there are enough players to be honest.
 */
export function percentileFor(session: Session, ctx: Pick<AppContext, "attempts">): PercentileStatus {
  const inOccupation = session.soc ? ctx.attempts.realPlayerRatings(PERCENTILE_MIN_ATTEMPTS, session.soc) : [];
  if (inOccupation.length >= PERCENTILE_MIN_PLAYERS) {
    return {
      locked: false,
      scope: "occupation",
      players: inOccupation.length,
      value: percentileBelow(session.rating, inOccupation),
    };
  }
  const everyone = ctx.attempts.realPlayerRatings(PERCENTILE_MIN_ATTEMPTS);
  if (everyone.length >= PERCENTILE_MIN_PLAYERS) {
    return { locked: false, scope: "all", players: everyone.length, value: percentileBelow(session.rating, everyone) };
  }
  return { locked: true, players: everyone.length, needed: PERCENTILE_MIN_PLAYERS };
}

/** Everything the dashboard shows, computed from the attempt records. */
export function buildMe(session: Session, ctx: AppContext): MeResponse {
  const now = ctx.now();
  const today = etDay(now);
  const attempts = ctx.attempts.list(session.id);
  const outcomes = attempts.map(typeOutcomes);
  const occupation = session.soc ? ctx.occupations.get(session.soc) : undefined;
  const hasScan = occupation !== undefined && ctx.sessions.tasks(session.id).length > 0;
  const pro = isPro(session, now);

  const flagsTotal = attempts.reduce((n, a) => n + a.caught + a.falseFlags + a.decoyFlags, 0);
  const flagsWrong = attempts.reduce((n, a) => n + a.falseFlags + a.decoyFlags, 0);

  return {
    hasScan,
    ...(occupation ? { occupation: { ...summarize(occupation), short: ctx.occupations.shortName(occupation.soc) } } : {}),
    plan: pro ? "trial" : "free",
    ...(session.planChoice ? { planChoice: session.planChoice } : {}),
    ...(pro && session.trialEndsAt ? { trialEndsAt: session.trialEndsAt } : {}),
    isPro: pro,
    isDemo: session.isDemo,
    rating: session.rating,
    attemptsCount: session.attemptsCount,
    streak: currentStreak(
      attempts.map((a) => a.day),
      today,
    ),
    history: attempts.map(toHistoryEntry),
    byType: typeStats(outcomes),
    falseFlagRate: flagsTotal === 0 ? null : flagsWrong / flagsTotal,
    weakSpot: weakSpot(outcomes),
    daily: ctx.drillService.dailyStatus(session),
    practice: { usedToday: ctx.attempts.countOnDay(session.id, today, "practice"), limit: PRACTICE_DAILY_LIMIT },
    percentile: percentileFor(session, ctx),
    debrief: buildWeeklyDebrief(attempts, today, pro),
  };
}
