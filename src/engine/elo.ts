/**
 * Judgment Score — an Elo rating in which the opponent is the drill.
 *
 * Every level has a fixed difficulty D on the same scale as the player's rating R. A drill does
 * not end in a win or a loss but in a share of points p ∈ [0, 1] (see scoring.ts), which Elo
 * takes as it is, the way chess scores a draw as 0.5:
 *
 *   E  = 1 / (1 + 10^((D − R) / 400))      expected share of points
 *   R' = round(R + K·(p − E))
 *
 * Worked example: R = 1000, level 3 (D = 1100), p = 56/144 ≈ 0.389 → E ≈ 0.360 → R' = 1001.
 */
import type { Level } from "./drillSchema";

export const START_RATING = 1000;

/**
 * Levels sit 150 points apart: a player whose rating equals one level's difficulty expects half
 * the points there and about 30% one level up.
 */
export const LEVEL_DIFFICULTY: Readonly<Record<Level, number>> = { 1: 800, 2: 950, 3: 1100, 4: 1250, 5: 1400 };

/** The classic Elo scale: a 400-point gap means 10:1 odds. */
const SCALE = 400;

/**
 * A new player's rating moves fast, so it finds their level within the first ten drills; after
 * that it settles, and one bad day cannot undo a month of practice.
 */
const PROVISIONAL_ATTEMPTS = 10;
const K_PROVISIONAL = 40;
const K_SETTLED = 24;

/** The share of points a player rated `rating` should score on a drill of this level. */
export function expectedScore(rating: number, level: Level): number {
  return 1 / (1 + 10 ** ((LEVEL_DIFFICULTY[level] - rating) / SCALE));
}

/** `attemptsSoFar` counts finished attempts, so the 11th drill (attemptsSoFar = 10) is the first settled one. */
export function kFactor(attemptsSoFar: number): number {
  return attemptsSoFar < PROVISIONAL_ATTEMPTS ? K_PROVISIONAL : K_SETTLED;
}

/** Rounded because the rating is shown to people, and decimals would claim a precision it does not have. */
export function updateRating(rating: number, level: Level, p: number, attemptsSoFar: number): number {
  return Math.round(rating + kFactor(attemptsSoFar) * (p - expectedScore(rating, level)));
}
