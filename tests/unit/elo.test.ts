import { describe, expect, test } from "bun:test";
import { LEVELS } from "../../src/engine/drillSchema";
import { LEVEL_DIFFICULTY, START_RATING, expectedScore, kFactor, updateRating } from "../../src/engine/elo";

describe("control example", () => {
  // The scoring control example: 56 of 144 points on the level-3 reference drill, first attempt.
  const p = 56 / 144;

  test("R = 1000, level 3 → E ≈ 0.360", () => {
    expect(expectedScore(START_RATING, 3)).toBeCloseTo(0.36, 3);
  });

  test("p ≈ 0.389 → 1001 (+1)", () => {
    expect(updateRating(START_RATING, 3, p, 0)).toBe(1001);
  });
});

describe("expectedScore", () => {
  test("is one half when the rating equals the level's difficulty", () => {
    for (const level of LEVELS) expect(expectedScore(LEVEL_DIFFICULTY[level], level)).toBe(0.5);
  });

  test("a 400-point edge means 10:1 odds", () => {
    expect(expectedScore(LEVEL_DIFFICULTY[3] + 400, 3)).toBeCloseTo(10 / 11, 12);
    expect(expectedScore(LEVEL_DIFFICULTY[3] - 400, 3)).toBeCloseTo(1 / 11, 12);
  });

  test("falls as the level rises", () => {
    const expectations = LEVELS.map((level) => expectedScore(START_RATING, level));
    expect(expectations).toEqual([...expectations].sort((a, b) => b - a));
    expect(new Set(expectations).size).toBe(LEVELS.length);
  });
});

describe("kFactor", () => {
  test("is 40 for the first ten attempts", () => {
    for (let attemptsSoFar = 0; attemptsSoFar < 10; attemptsSoFar++) expect(kFactor(attemptsSoFar)).toBe(40);
  });

  test("switches to 24 at the eleventh attempt", () => {
    expect(kFactor(10)).toBe(24);
    expect(kFactor(250)).toBe(24);
  });
});

describe("updateRating", () => {
  test("scoring exactly as expected leaves the rating unchanged", () => {
    for (const level of LEVELS) {
      expect(updateRating(1180, level, expectedScore(1180, level), 0)).toBe(1180);
      expect(updateRating(1180, level, expectedScore(1180, level), 30)).toBe(1180);
    }
  });

  test("a perfect drill gains K·(1 − E), a blank one loses K·E", () => {
    // On a level whose difficulty equals the rating, E = 0.5.
    expect(updateRating(1100, 3, 1, 0)).toBe(1120);
    expect(updateRating(1100, 3, 0, 0)).toBe(1080);
    expect(updateRating(1100, 3, 1, 10)).toBe(1112);
    expect(updateRating(1100, 3, 0, 10)).toBe(1088);
  });

  test("never falls when p rises", () => {
    for (const level of LEVELS) {
      let previous = -Infinity;
      for (let step = 0; step <= 100; step++) {
        const rating = updateRating(START_RATING, level, step / 100, 0);
        expect(rating).toBeGreaterThanOrEqual(previous);
        previous = rating;
      }
    }
  });

  test("beating a harder level pays more than beating an easier one", () => {
    expect(updateRating(START_RATING, 5, 1, 0)).toBeGreaterThan(updateRating(START_RATING, 1, 1, 0));
  });

  test("returns whole numbers", () => {
    expect(Number.isInteger(updateRating(1003, 4, 0.4321, 3))).toBe(true);
  });
});
