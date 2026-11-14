/**
 * Adaptivity: how hard the next drill is, and which kind of mistake it must contain.
 *
 * Difficulty follows the rating; content follows the weak spot — the error type the player has
 * been missing most often lately. The generator is told to plant that type again, so practice
 * goes where the misses are instead of where the player is already good.
 */
import { ERROR_TYPES, LEVELS, type ErrorType, type Level } from "./drillSchema";
import { LEVEL_DIFFICULTY } from "./elo";

/**
 * Level 2 is the easiest level that has a decoy, so the very first drill already shows the whole
 * game: real mistakes, and a line that only looks wrong.
 */
export const FIRST_LEVEL: Level = 2;

/** Aim slightly below the rating so E ≈ 0.6: hard but winnable. */
export const TARGET_OFFSET = 70;

/**
 * The level whose difficulty is closest to `rating − TARGET_OFFSET`. A tie goes to the easier
 * level: an easy day costs a few rating points, a discouraging one costs the habit.
 */
export function nextLevel(rating: number, attemptsSoFar: number): Level {
  if (attemptsSoFar <= 0) return FIRST_LEVEL;
  const target = rating - TARGET_OFFSET;
  const distance = (level: Level): number => Math.abs(LEVEL_DIFFICULTY[level] - target);
  // LEVELS ascends, so replacing only on a strictly smaller distance keeps the easier level on a tie.
  return LEVELS.reduce<Level>((best, level) => (distance(level) < distance(best) ? level : best), LEVELS[0]);
}

/** One per key item of a past attempt: was this type of mistake flagged or not. */
export interface TypeOutcome {
  type: ErrorType;
  caught: boolean;
}

export interface TypeStat {
  appeared: number;
  caught: number;
}

export function typeStats(attempts: ReadonlyArray<ReadonlyArray<TypeOutcome>>): Record<ErrorType, TypeStat> {
  const stats: Record<ErrorType, TypeStat> = {
    numbers: { appeared: 0, caught: 0 },
    facts: { appeared: 0, caught: 0 },
    logic: { appeared: 0, caught: 0 },
    risk: { appeared: 0, caught: 0 },
    audience: { appeared: 0, caught: 0 },
  };
  for (const attempt of attempts) {
    for (const { type, caught } of attempt) {
      stats[type].appeared++;
      if (caught) stats[type].caught++;
    }
  }
  return stats;
}

/** Recent form only: a type the player has since learned to catch should stop being drilled. */
export const WEAK_SPOT_WINDOW = 10;

/** One miss is an accident; a weak spot needs the type to have come up at least twice. */
export const WEAK_SPOT_MIN_APPEARANCES = 2;

function catchRate(stat: TypeStat): number {
  return stat.caught / stat.appeared;
}

/** At equal catch rates, the type seen more often is the better-established weakness. */
function isWeaker(stat: TypeStat, than: TypeStat): boolean {
  const rate = catchRate(stat);
  const otherRate = catchRate(than);
  return rate < otherRate || (rate === otherRate && stat.appeared > than.appeared);
}

/**
 * `attempts` are oldest → newest; only the last WEAK_SPOT_WINDOW count. Returns the type with the
 * worst catch rate among those that appeared at least WEAK_SPOT_MIN_APPEARANCES times. Ties go to
 * the type that appeared more, then to ERROR_TYPES order. Null when no type qualifies or nothing
 * was missed: a player with a clean record has no weak spot to drill.
 */
export function weakSpot(attempts: ReadonlyArray<ReadonlyArray<TypeOutcome>>): ErrorType | null {
  const stats = typeStats(attempts.slice(-WEAK_SPOT_WINDOW));
  let weakest: ErrorType | null = null;
  for (const type of ERROR_TYPES) {
    const stat = stats[type];
    if (stat.appeared < WEAK_SPOT_MIN_APPEARANCES || stat.caught === stat.appeared) continue;
    if (weakest === null || isWeaker(stat, stats[weakest])) weakest = type;
  }
  return weakest;
}
