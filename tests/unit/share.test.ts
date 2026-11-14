import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { DrillSchema } from "../../src/engine/drillSchema";
import { scoreAttempt } from "../../src/engine/scoring";
import { shareGrid, shareText } from "../../src/engine/share";
import type { ShareInput } from "../../src/engine/share";

const FIXTURE = join(import.meta.dir, "..", "fixtures", "reference-drill.json");
const drill = DrillSchema.parse(await Bun.file(FIXTURE).json());

const LINK = "https://example.com/r/abc123";

const threeOfFour: ShareInput = {
  dailyNumber: 12,
  occupationShort: "Marketing",
  result: { cells: ["caught", "wrong_type", "missed", "caught"], falseFlags: ["s1"], decoyFlags: [] },
  rating: 1084,
  delta: 21,
  url: LINK,
};

describe("shareGrid", () => {
  test("one square per key item, in key order", () => {
    expect(shareGrid({ cells: ["caught", "wrong_type", "missed"], falseFlags: [], decoyFlags: [] })).toBe("🟩🟨🟥");
  });

  test("then one black square per false or decoy flag", () => {
    expect(shareGrid({ cells: ["caught", "caught", "caught"], falseFlags: ["s1"], decoyFlags: ["s4"] })).toBe(
      "🟩🟩🟩⬛⬛",
    );
  });

  test("squares are single code points, with no variation selectors", () => {
    const grid = shareGrid({ cells: ["caught", "wrong_type", "missed"], falseFlags: ["s1"], decoyFlags: [] });
    expect([...grid].map((square) => square.codePointAt(0))).toEqual([0x1f7e9, 0x1f7e8, 0x1f7e5, 0x2b1b]);
  });

  test("the control attempt on the reference drill reads 🟩🟥🟩🟥⬛⬛", () => {
    const result = scoreAttempt(drill, [
      { targetId: "s3", type: "numbers" },
      { targetId: "s6", type: "logic" },
      { targetId: "s4", type: "numbers" }, // decoy
      { targetId: "s1", type: "audience" }, // plain line
    ]);
    expect(shareGrid(result)).toBe("🟩🟥🟩🟥⬛⬛");
  });
});

describe("shareText", () => {
  test("is four lines: title, grid, score, link", () => {
    expect(shareText(threeOfFour)).toBe(
      ["Overrule · Daily Catch #12 · Marketing", "🟩🟨🟥🟩⬛", "Caught 3/4 · Judgment 1,084 (+21)", LINK].join("\n"),
    );
  });

  test("a drill without a daily number is Practice", () => {
    const [title] = shareText({ ...threeOfFour, dailyNumber: undefined }).split("\n");
    expect(title).toBe("Overrule · Practice · Marketing");
  });

  test("a mistake flagged under the wrong type still counts as caught", () => {
    const result: ShareInput["result"] = {
      cells: ["wrong_type", "wrong_type", "missed"],
      falseFlags: [],
      decoyFlags: [],
    };
    expect(shareText({ ...threeOfFour, result })).toContain("Caught 2/3");
  });

  test("the rating uses en-US thousands separators", () => {
    expect(shareText({ ...threeOfFour, rating: 987 })).toContain("Judgment 987 (");
    expect(shareText({ ...threeOfFour, rating: 12345 })).toContain("Judgment 12,345 (");
  });

  test("the delta is always signed", () => {
    expect(shareText({ ...threeOfFour, delta: 21 })).toContain("(+21)");
    expect(shareText({ ...threeOfFour, delta: 0 })).toContain("(+0)");
    expect(shareText({ ...threeOfFour, delta: -0 })).toContain("(+0)");
    expect(shareText({ ...threeOfFour, delta: -4 })).toContain("(−4)");
  });

  test("separators are middle dots and a loss uses a real minus sign", () => {
    const text = shareText({ ...threeOfFour, delta: -4 });
    expect(text).toContain("Overrule · Daily Catch #12 · Marketing");
    expect(text).toContain("Caught 3/4 · Judgment");
    expect(text).toContain("(−4)");
  });
});
