import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { DrillSchema } from "../../src/engine/drillSchema";
import type { KeyItem } from "../../src/engine/drillSchema";
import { heuristicWhyScore } from "../../src/engine/whyHeuristic";

const FIXTURE = join(import.meta.dir, "..", "fixtures", "reference-drill.json");
const drill = DrillSchema.parse(await Bun.file(FIXTURE).json());

function keyItem(targetId: string): KeyItem {
  const item = drill.key.find((candidate) => candidate.targetId === targetId);
  if (!item) throw new Error(`The reference drill has no key item ${targetId}`);
  return item;
}

const percentChange = keyItem("s3"); // 40% should be ~15%
const inventedBenchmark = keyItem("s5");
const worstChannel = keyItem("s6"); // budget moved to Pinterest, the lowest ROAS
const absoluteClaim = keyItem("s7"); // "100% waterproof in any storm"

describe("notes that name the problem score 2", () => {
  test("two numbers from the key", () => {
    expect(heuristicWhyScore("should be 15% not 40%", percentChange)).toBe(2);
  });

  test("two content words from the key", () => {
    expect(heuristicWhyScore("pinterest has the lowest roas", worstChannel)).toBe(2);
  });

  test("one number plus one content word", () => {
    expect(heuristicWhyScore("the improvement is 15%", percentChange)).toBe(2);
  });

  test("case and punctuation do not matter", () => {
    expect(heuristicWhyScore("PINTEREST: lowest ROAS!!", worstChannel)).toBe(2);
  });
});

describe("partial notes score 1", () => {
  test("a single content word", () => {
    expect(heuristicWhyScore("why pinterest?", worstChannel)).toBe(1);
  });

  test("a single number", () => {
    expect(heuristicWhyScore("40%?", percentChange)).toBe(1);
  });

  test("repeating one word is still one piece of evidence", () => {
    expect(heuristicWhyScore("pinterest pinterest pinterest", worstChannel)).toBe(1);
  });
});

describe("notes that prove nothing score 0", () => {
  const vague = [
    "looks odd",
    "this is wrong",
    "not sure about this one",
    "check the numbers",
    "doesn't seem right",
    "mistake here",
    "???",
  ];

  test.each(vague)("%p on every key item", (note) => {
    for (const item of drill.key) expect(heuristicWhyScore(note, item)).toBe(0);
  });

  test("a specific note about a different problem", () => {
    expect(heuristicWhyScore("tone is too casual for leadership", percentChange)).toBe(0);
    expect(heuristicWhyScore("pinterest has the lowest roas", inventedBenchmark)).toBe(0);
  });

  test("missing, empty and under three characters", () => {
    expect(heuristicWhyScore(undefined, percentChange)).toBe(0);
    expect(heuristicWhyScore("", percentChange)).toBe(0);
    expect(heuristicWhyScore("   ", percentChange)).toBe(0);
    expect(heuristicWhyScore(" 40 ", percentChange)).toBe(0);
  });

  test("a shared \"n't\" is not evidence", () => {
    const item = {
      explanation: "The total doesn't match the rows above it.",
      correction: "Use $211,000.",
      cue: "Re-add every column.",
    };
    expect(heuristicWhyScore("this doesn't work", item)).toBe(0);
    expect(heuristicWhyScore("this doesn’t work", item)).toBe(0);
  });
});

describe("word forms", () => {
  test("-ed and -ing meet each other", () => {
    expect(heuristicWhyScore("you moved the budget", worstChannel)).toBe(2); // key: "moving … budget"
  });

  test("plurals meet singulars", () => {
    expect(heuristicWhyScore("benchmarks need sources", inventedBenchmark)).toBe(2); // key: "benchmark", "source"
  });

  test("third person meets the participle", () => {
    expect(heuristicWhyScore("it guarantees too much", absoluteClaim)).toBe(1); // key: "guaranteed"
  });
});

describe("number formats", () => {
  const item = {
    explanation: "TikTok revenue was $63,000, so ROAS is 3.5x, not 4.0x.",
    correction: "State 3.5x.",
    cue: "Recompute ratios from the table.",
  };

  test("currency signs, thousands separators and trailing zeros are ignored", () => {
    expect(heuristicWhyScore("63000", item)).toBe(1);
    expect(heuristicWhyScore("$63,000.00", item)).toBe(1);
    expect(heuristicWhyScore("4x?", item)).toBe(1);
    expect(heuristicWhyScore("63,000 / 18,000 = 3.50", item)).toBe(2);
  });

  test("a number matches whole, never as a prefix", () => {
    expect(heuristicWhyScore("6300", item)).toBe(0);
    expect(heuristicWhyScore("630,000", item)).toBe(0);
  });
});
