import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { DrillSchema } from "../../src/engine/drillSchema";
import { POINTS, maxPoints, normalizeFlags, scoreAttempt } from "../../src/engine/scoring";
import type { Flag, WhyScore } from "../../src/engine/scoring";

const FIXTURE = join(import.meta.dir, "..", "fixtures", "reference-drill.json");
const drill = DrillSchema.parse(await Bun.file(FIXTURE).json());

/** Every planted mistake flagged with its true type: s3, s5, s6, s7. */
const allCaught: Flag[] = drill.key.map((item) => ({ targetId: item.targetId, type: item.type }));
const fullWhy: Record<string, WhyScore> = { s3: 2, s5: 2, s6: 2, s7: 2 };

describe("control example on the reference drill", () => {
  const result = scoreAttempt(
    drill,
    [
      { targetId: "s3", type: "numbers", why: "should be 15%, not 40%" },
      { targetId: "s6", type: "logic", why: "pinterest?" },
      { targetId: "s4", type: "numbers" }, // decoy
      { targetId: "s1", type: "audience" }, // plain line
    ],
    { s3: 2, s6: 1 },
  );

  test("31 + 38 − 8 − 5 = 56 of 144, p ≈ 0.389", () => {
    expect(result.points).toBe(56);
    expect(result.maxPoints).toBe(144);
    expect(result.p).toBeCloseTo(0.389, 3);
  });

  test("reports each hit with its own points", () => {
    expect(result.hits).toEqual([
      { targetId: "s3", keyType: "numbers", flaggedType: "numbers", typeCorrect: true, severity: 2, why: 2, points: 31 },
      { targetId: "s6", keyType: "logic", flaggedType: "logic", typeCorrect: true, severity: 3, why: 1, points: 38 },
    ]);
  });

  test("separates misses, decoy flags and false flags", () => {
    expect(result.missed).toEqual(["s5", "s7"]);
    expect(result.decoyFlags).toEqual(["s4"]);
    expect(result.falseFlags).toEqual(["s1"]);
  });

  test("has one cell per key item, in key order", () => {
    expect(result.cells).toEqual(["caught", "missed", "caught", "missed"]);
  });
});

describe("maxPoints", () => {
  test("is 10·severity + 5 + 6 per key item", () => {
    expect(maxPoints(drill.key)).toBe(31 + 31 + 41 + 41);
    expect(maxPoints(drill.key.slice(0, 1))).toBe(31);
  });

  test("leaves room for exactly the full why bonus", () => {
    const withoutWhy = scoreAttempt(drill, allCaught);
    expect(withoutWhy.maxPoints - withoutWhy.points).toBe(drill.key.length * POINTS.perWhyPoint * POINTS.maxWhy);
  });
});

describe("scoreAttempt", () => {
  test("a perfect run scores maxPoints and p = 1", () => {
    const result = scoreAttempt(drill, allCaught, fullWhy);
    expect(result.points).toBe(144);
    expect(result.points).toBe(result.maxPoints);
    expect(result.p).toBe(1);
    expect(result.cells).toEqual(["caught", "caught", "caught", "caught"]);
    expect(result.missed).toEqual([]);
  });

  test("a wrong type keeps the severity points but not the +5", () => {
    const result = scoreAttempt(drill, [{ targetId: "s3", type: "logic" }]);
    expect(result.points).toBe(20);
    expect(result.hits).toEqual([
      { targetId: "s3", keyType: "numbers", flaggedType: "logic", typeCorrect: false, severity: 2, why: 0, points: 20 },
    ]);
    expect(result.cells).toEqual(["wrong_type", "missed", "missed", "missed"]);
  });

  test("a why score still counts when the type is wrong", () => {
    expect(scoreAttempt(drill, [{ targetId: "s3", type: "logic" }], { s3: 2 }).points).toBe(26);
  });

  test("why scores only count on hits", () => {
    const flags: Flag[] = [
      { targetId: "s3", type: "numbers" },
      { targetId: "s4", type: "numbers" },
      { targetId: "s1", type: "audience" },
    ];
    // s4 is a decoy, s1 a plain line, s5 a key item that was never flagged.
    const result = scoreAttempt(drill, flags, { s4: 2, s1: 2, s5: 2 });
    expect(result.points).toBe(25 - 8 - 5);
  });

  test("a negative total clamps p to 0 while points stay negative", () => {
    const result = scoreAttempt(drill, [
      { targetId: "s4", type: "numbers" },
      { targetId: "s1", type: "audience" },
    ]);
    expect(result.points).toBe(-13);
    expect(result.p).toBe(0);
  });

  test("duplicate flags on one target count once, and the first one wins", () => {
    const result = scoreAttempt(drill, [
      { targetId: "s1", type: "audience" },
      { targetId: "s1", type: "risk" },
      { targetId: "s1", type: "facts" },
      { targetId: "s3", type: "numbers" },
      { targetId: "s3", type: "logic" },
    ]);
    expect(result.falseFlags).toEqual(["s1"]);
    expect(result.cells[0]).toBe("caught");
    expect(result.points).toBe(25 - 5);
  });

  test("flags beyond the budget of key + 2 are ignored, whether they would help or hurt", () => {
    const sixPlainLines: Flag[] = ["s1", "s8", "r1c1", "r1c2", "r1c3", "r1c4"].map((targetId) => ({
      targetId,
      type: "facts",
    }));
    const lateCatch = scoreAttempt(drill, [...sixPlainLines, { targetId: "s3", type: "numbers" }]);
    expect(lateCatch.hits).toEqual([]);
    expect(lateCatch.points).toBe(-30);

    const lateFalseFlags = scoreAttempt(drill, [...allCaught, ...sixPlainLines], fullWhy);
    expect(lateFalseFlags.falseFlags).toEqual(["s1", "s8"]);
    expect(lateFalseFlags.points).toBe(144 - 10);
  });

  test("hits follow key order, stray flags follow the order they were made", () => {
    const result = scoreAttempt(drill, [
      { targetId: "s8", type: "audience" },
      { targetId: "s7", type: "risk" },
      { targetId: "s1", type: "audience" },
      { targetId: "s3", type: "numbers" },
    ]);
    expect(result.hits.map((hit) => hit.targetId)).toEqual(["s3", "s7"]);
    expect(result.falseFlags).toEqual(["s8", "s1"]);
  });

  test("no flags: nothing caught, nothing lost", () => {
    const result = scoreAttempt(drill, []);
    expect(result.points).toBe(0);
    expect(result.p).toBe(0);
    expect(result.missed).toEqual(["s3", "s5", "s6", "s7"]);
    expect(result.cells).toEqual(["missed", "missed", "missed", "missed"]);
  });

  test("a target id that shadows Object.prototype is scored like any other", () => {
    const key = drill.key.slice(0, 1).map((item) => ({ ...item, targetId: "constructor" }));
    const result = scoreAttempt({ key, decoys: [] }, [{ targetId: "constructor", type: "numbers" }]);
    expect(result.points).toBe(25);
  });

  test("an empty key scores p = 0 instead of NaN", () => {
    const result = scoreAttempt({ key: [], decoys: [] }, [{ targetId: "s1", type: "facts" }]);
    expect(result.maxPoints).toBe(0);
    expect(result.p).toBe(0);
  });
});

describe("normalizeFlags", () => {
  const flags: Flag[] = [
    { targetId: "a", type: "numbers" },
    { targetId: "b", type: "facts" },
    { targetId: "a", type: "logic" },
    { targetId: "c", type: "risk" },
  ];

  test("keeps the first flag per target, in order", () => {
    expect(normalizeFlags(flags, 10)).toEqual([
      { targetId: "a", type: "numbers" },
      { targetId: "b", type: "facts" },
      { targetId: "c", type: "risk" },
    ]);
  });

  test("applies the budget after dropping duplicates", () => {
    expect(normalizeFlags(flags, 3).map((flag) => flag.targetId)).toEqual(["a", "b", "c"]);
    expect(normalizeFlags(flags, 2).map((flag) => flag.targetId)).toEqual(["a", "b"]);
  });

  test("a zero or negative budget keeps nothing", () => {
    expect(normalizeFlags(flags, 0)).toEqual([]);
    expect(normalizeFlags(flags, -1)).toEqual([]);
  });
});
