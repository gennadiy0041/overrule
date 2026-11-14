import { describe, expect, test } from "bun:test";
import {
  FIRST_LEVEL,
  TARGET_OFFSET,
  WEAK_SPOT_MIN_APPEARANCES,
  WEAK_SPOT_WINDOW,
  nextLevel,
  typeStats,
  weakSpot,
} from "../../src/engine/adaptive";
import type { TypeOutcome } from "../../src/engine/adaptive";
import { LEVELS, LEVEL_SPECS } from "../../src/engine/drillSchema";
import type { ErrorType } from "../../src/engine/drillSchema";
import { LEVEL_DIFFICULTY, START_RATING, expectedScore } from "../../src/engine/elo";

const caught = (type: ErrorType): TypeOutcome => ({ type, caught: true });
const missed = (type: ErrorType): TypeOutcome => ({ type, caught: false });

describe("nextLevel", () => {
  test("the first drill is always level 2, whatever the rating", () => {
    expect(FIRST_LEVEL).toBe(2);
    for (const rating of [400, START_RATING, 1600]) expect(nextLevel(rating, 0)).toBe(2);
  });

  test("the first level is the easiest one with a decoy", () => {
    expect(LEVEL_SPECS[1].decoys).toBe(0);
    expect(LEVEL_SPECS[FIRST_LEVEL].decoys).toBeGreaterThan(0);
  });

  test("picks the level whose difficulty is closest to rating − 70", () => {
    expect(nextLevel(1000, 1)).toBe(2); // 930: 20 from level 2, 130 from level 1
    expect(nextLevel(1096, 1)).toBe(3); // 1026: 74 from level 3, 76 from level 2
    expect(nextLevel(1400, 1)).toBe(5); // 1330: 70 from level 5, 80 from level 4
  });

  test("a tie goes to the easier level", () => {
    expect(nextLevel(945, 1)).toBe(1); // 875 is midway between 800 and 950
    expect(nextLevel(1095, 1)).toBe(2); // 1025 is midway between 950 and 1100
    expect(nextLevel(1245, 1)).toBe(3); // 1175 is midway between 1100 and 1250
    expect(nextLevel(1395, 1)).toBe(4); // 1325 is midway between 1250 and 1400
  });

  test("clamps to the easiest and the hardest level", () => {
    expect(nextLevel(300, 5)).toBe(1);
    expect(nextLevel(2400, 5)).toBe(5);
  });

  test("a rating TARGET_OFFSET above a level's difficulty gets that level", () => {
    for (const level of LEVELS) expect(nextLevel(LEVEL_DIFFICULTY[level] + TARGET_OFFSET, 1)).toBe(level);
  });

  test("never steps down as the rating climbs, and reaches every level", () => {
    const levels: number[] = [];
    for (let rating = 600; rating <= 1700; rating += 5) levels.push(nextLevel(rating, 1));
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
    expect(new Set(levels)).toEqual(new Set<number>(LEVELS));
  });

  test("the offset aims for an expected score of about 0.6", () => {
    expect(expectedScore(LEVEL_DIFFICULTY[3] + TARGET_OFFSET, 3)).toBeCloseTo(0.6, 2);
  });
});

describe("typeStats", () => {
  test("counts appearances and catches per type across attempts", () => {
    const stats = typeStats([
      [caught("numbers"), missed("logic"), caught("risk")],
      [missed("numbers"), missed("logic"), caught("facts")],
    ]);
    expect(stats).toEqual({
      numbers: { appeared: 2, caught: 1 },
      facts: { appeared: 1, caught: 1 },
      logic: { appeared: 2, caught: 0 },
      risk: { appeared: 1, caught: 1 },
      audience: { appeared: 0, caught: 0 },
    });
  });

  test("no attempts: every type at zero", () => {
    const stats = typeStats([]);
    expect(Object.values(stats)).toEqual(Array.from({ length: 5 }, () => ({ appeared: 0, caught: 0 })));
  });
});

describe("weakSpot", () => {
  test("is the type with the worst catch rate", () => {
    const attempts = [
      [caught("numbers"), missed("logic"), caught("risk")],
      [missed("numbers"), missed("logic"), caught("risk")],
    ];
    expect(weakSpot(attempts)).toBe("logic"); // logic 0/2, numbers 1/2, risk 2/2
  });

  test(`ignores a type that appeared fewer than ${WEAK_SPOT_MIN_APPEARANCES} times`, () => {
    const attempts = [
      [missed("audience"), caught("numbers"), caught("facts")],
      [missed("numbers"), caught("facts"), caught("logic")],
    ];
    expect(weakSpot(attempts)).toBe("numbers"); // audience is 0/1: a single miss proves nothing
  });

  test(`looks at the last ${WEAK_SPOT_WINDOW} attempts only`, () => {
    const oldMisses = [missed("risk"), missed("risk"), caught("facts")];
    const clean = [caught("risk"), caught("facts"), caught("logic")];
    const cleanRun = (length: number): TypeOutcome[][] => Array.from({ length }, () => clean);
    expect(weakSpot([oldMisses, ...cleanRun(WEAK_SPOT_WINDOW - 1)])).toBe("risk"); // still inside the window
    expect(weakSpot([oldMisses, ...cleanRun(WEAK_SPOT_WINDOW)])).toBeNull(); // aged out
  });

  test("at equal catch rates, the type that appeared more often wins", () => {
    const attempts = [
      [missed("numbers"), caught("numbers"), missed("risk")],
      [caught("risk"), missed("risk"), caught("risk")],
    ];
    expect(weakSpot(attempts)).toBe("risk"); // numbers 1/2, risk 2/4
  });

  test("a full tie falls back to ERROR_TYPES order", () => {
    const attempts = [
      [missed("audience"), missed("logic"), missed("facts")],
      [caught("audience"), caught("logic"), caught("facts")],
    ];
    expect(weakSpot(attempts)).toBe("facts"); // all 1/2; facts comes first in ERROR_TYPES
  });

  test("a perfect history has no weak spot", () => {
    const attempts = Array.from({ length: 4 }, () => [caught("numbers"), caught("logic"), caught("risk")]);
    expect(weakSpot(attempts)).toBeNull();
  });

  test("nothing qualifies: no history, or no type seen often enough", () => {
    expect(weakSpot([])).toBeNull();
    expect(weakSpot([[missed("numbers"), missed("facts"), missed("logic")]])).toBeNull();
  });
});
