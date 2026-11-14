import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { LEVELS, LEVEL_SPECS, countWords, listTargets } from "../../src/engine/drillSchema";
import type { Decoy, Drill, Level, NumericCheck, Segment } from "../../src/engine/drillSchema";
import { formatIssues, verifyDrill } from "../../src/engine/verifyDrill";
import type { VerifyIssue, VerifyIssueCode } from "../../src/engine/verifyDrill";

/** The gold-standard drill from the product spec: level 3, four mistakes of four types, one decoy. */
const REFERENCE = (await Bun.file(join(import.meta.dir, "..", "fixtures", "reference-drill.json")).json()) as Drill;

/** A fresh copy per test, so one test's damage never reaches another. */
const reference = (): Drill => structuredClone(REFERENCE);

function issuesOf(input: unknown): VerifyIssue[] {
  const result = verifyDrill(input);
  return result.ok ? [] : result.issues;
}

function codesOf(input: unknown): VerifyIssueCode[] {
  return issuesOf(input).map((issue) => issue.code);
}

function segment(drill: Drill, id: string): Segment {
  const found = listTargets(drill.artifact).find((target) => target.id === id);
  if (!found) throw new Error(`The drill has no segment or cell "${id}"`);
  return found;
}

const FILLER_WORDS_PER_SEGMENT = 200;

/** Appends a paragraph of filler so the artifact has exactly `words` words (it must have fewer to begin with). */
function padToWords(drill: Drill, words: number): void {
  const segments: Segment[] = [];
  for (let missing = words - countWords(drill.artifact); missing > 0; missing -= FILLER_WORDS_PER_SEGMENT) {
    const size = Math.min(missing, FILLER_WORDS_PER_SEGMENT);
    segments.push({ id: `pad${segments.length}`, text: Array(size).fill("ok").join(" ") });
  }
  drill.artifact.blocks.push({ type: "text", style: "paragraph", segments });
}

/** A second line that only looks wrong, for the levels that need two decoys. */
const SECOND_DECOY: Decoy = {
  targetId: "s8",
  looksWrongBecause: "Offers a walkthrough that the brief never asked for.",
  fineBecause: "A closing courtesy: it makes no claim that could be wrong.",
};

/** The reference drill reshaped to another level's error and decoy counts. */
function atLevel(level: Level): Drill {
  const drill = reference();
  const spec = LEVEL_SPECS[level];
  drill.level = level;
  drill.key = drill.key.slice(0, spec.maxErrors);
  drill.decoys = [...drill.decoys, SECOND_DECOY].slice(0, spec.decoys);
  return drill;
}

describe("the reference drill", () => {
  test("passes, and comes back parsed", () => {
    expect(verifyDrill(reference())).toEqual({ ok: true, drill: REFERENCE });
  });

  test("is not modified by being verified", () => {
    const input = reference();
    verifyDrill(input);
    expect(input).toEqual(REFERENCE);
  });
});

type Mutation = (drill: Drill) => void;

/**
 * Ways to break the reference drill, grouped by the single issue each one must produce.
 * Typed as a Record so that adding a VerifyIssueCode without a mutation fails the type check.
 */
const MUTATIONS: Record<VerifyIssueCode, Record<string, Mutation>> = {
  schema: {
    "the brief is missing": (drill) => {
      delete (drill as Partial<Drill>).brief;
    },
  },
  duplicate_id: {
    "two segments share an id": (drill) => {
      segment(drill, "s8").id = "s1";
    },
    "a table cell reuses a segment's id": (drill) => {
      segment(drill, "r1c1").id = "s1";
    },
    "three lines share an id (reported once)": (drill) => {
      segment(drill, "s8").id = "s1";
      segment(drill, "r1c1").id = "s1";
    },
  },
  unknown_target: {
    "a key item points at a segment that does not exist": (drill) => {
      drill.key[1]!.targetId = "s99";
    },
    "a decoy points at a segment that does not exist": (drill) => {
      drill.decoys[0]!.targetId = "s99";
    },
    "a numeric check points at a cell that does not exist": (drill) => {
      drill.numericChecks[5]!.targetId = "r9c9";
    },
  },
  duplicate_key_target: {
    "two mistakes are planted in one segment": (drill) => {
      drill.key[3]!.targetId = "s6";
    },
  },
  duplicate_decoy_target: {
    "two decoys sit on one segment": (drill) => {
      drill.level = 4; // the first level that takes two decoys
      drill.decoys.push({ ...drill.decoys[0]! });
    },
  },
  decoy_in_key: {
    "a decoy sits on a planted mistake": (drill) => {
      drill.decoys[0]!.targetId = "s5";
    },
  },
  type_diversity: {
    "the key has only two distinct error types": (drill) => {
      drill.key[1]!.type = "risk";
      drill.key[2]!.type = "risk";
    },
  },
  error_count: {
    "a level-1 drill has four mistakes": (drill) => {
      drill.level = 1;
      drill.decoys = [];
    },
    "a level-4 drill has three mistakes": (drill) => {
      drill.level = 4;
      drill.key.pop();
      drill.decoys.push(SECOND_DECOY);
    },
  },
  decoy_count: {
    "a level-3 drill has no decoy": (drill) => {
      drill.decoys = [];
    },
    "a level-3 drill has two decoys": (drill) => {
      drill.decoys.push(SECOND_DECOY);
    },
  },
  too_long: {
    "the text is blown past the word limit": (drill) => {
      padToWords(drill, 2 * LEVEL_SPECS[drill.level].maxWords);
    },
  },
  bad_expression: {
    "an expression contains words": (drill) => {
      drill.numericChecks[1]!.expression = "63000/eighteen";
    },
    "an expression is code": (drill) => {
      drill.numericChecks[1]!.expression = "process.exit(1)";
    },
    "an expression divides by zero": (drill) => {
      drill.numericChecks[1]!.expression = "63000/0";
    },
  },
  numeric_error_is_correct: {
    'the "numbers" mistake is actually right (s3 says 15.4% instead of 40%)': (drill) => {
      drill.numericChecks[0]!.stated = 15.4;
    },
  },
  numeric_correct_is_wrong: {
    "a line marked correct is actually wrong (s4 says 4.1 instead of 3.5)": (drill) => {
      drill.numericChecks[1]!.stated = 4.1;
    },
  },
  numbers_error_unproven: {
    'the "numbers" mistake has lost its numeric check': (drill) => {
      drill.numericChecks.shift();
    },
  },
  numeric_error_not_in_key: {
    "an ordinary cell is numerically wrong": (drill) => {
      drill.numericChecks.push({
        targetId: "r3c4",
        expression: "22000/10000",
        stated: 5,
        tolerance: 0.05,
        isError: true,
      });
    },
    "a decoy is numerically wrong": (drill) => {
      Object.assign(drill.numericChecks[1]!, { stated: 4.1, isError: true });
    },
  },
};

const CODES = Object.keys(MUTATIONS) as VerifyIssueCode[];

describe("every way of breaking the reference drill is caught, with exactly its issue", () => {
  for (const code of CODES) {
    for (const [name, mutate] of Object.entries(MUTATIONS[code])) {
      test(`${code}: ${name}`, () => {
        const drill = reference();
        mutate(drill);
        expect(codesOf(drill)).toEqual([code]);
      });
    }
  }
});

describe("issues", () => {
  test("name the entry and the target they are about", () => {
    const drill = reference();
    drill.key[1]!.targetId = "s99";
    expect(issuesOf(drill)).toEqual([
      {
        code: "unknown_target",
        message: 'key[1] points at "s99", but no segment or cell has that id',
        targetId: "s99",
      },
    ]);
  });

  test("show the arithmetic behind a numeric verdict", () => {
    const drill = reference();
    drill.numericChecks[0]!.stated = 15.4;
    expect(issuesOf(drill)).toEqual([
      {
        code: "numeric_error_is_correct",
        message:
          'numericChecks[0] marks "s3" as a numeric mistake, but its number is right: ' +
          "(3.0/2.6-1)*100 = 15.38461538, the document says 15.4, tolerance 2",
        targetId: "s3",
      },
    ]);
  });

  test("quote the evaluator's reason for refusing an expression", () => {
    const drill = reference();
    drill.numericChecks[1]!.expression = "63000/eighteen";
    expect(issuesOf(drill)).toEqual([
      {
        code: "bad_expression",
        message:
          'numericChecks[1].expression "63000/eighteen" is not plain arithmetic: ' +
          'Unexpected character "e" at position 7',
        targetId: "s4",
      },
    ]);
  });

  test("tell the model the level's own limit, not the slack", () => {
    const drill = reference();
    padToWords(drill, 400);
    expect(issuesOf(drill)).toEqual([
      { code: "too_long", message: "The artifact has 400 words; level 3 allows at most 280" },
    ]);
  });

  test("are all reported at once, in check order", () => {
    const drill = reference();
    drill.key[1]!.targetId = "s99";
    drill.decoys = [];
    drill.numericChecks[1]!.stated = 4.1;
    expect(codesOf(drill)).toEqual(["unknown_target", "decoy_count", "numeric_correct_is_wrong"]);
  });
});

describe("schema failures", () => {
  test("are reported alone: nothing else is checked on a malformed drill", () => {
    const drill = reference();
    delete (drill as Partial<Drill>).brief;
    drill.decoys = [];
    drill.numericChecks[1]!.stated = 4.1;
    expect(codesOf(drill)).toEqual(["schema"]);
  });

  test("name the path of the offending field", () => {
    const drill = reference();
    segment(drill, "s1").text = "";
    Object.assign(drill.key[2]!, { severity: 4 });
    const messages = issuesOf(drill).map((issue) => issue.message);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toStartWith("artifact.blocks[0].segments[0].text: ");
    expect(messages[1]).toStartWith("key[2].severity: ");
  });

  const notDrills: Array<[what: string, input: unknown]> = [
    ["null", null],
    ["undefined", undefined],
    ["a string", "a drill"],
    ["a number", 42],
    ["an array", []],
    ["an empty object", {}],
  ];
  test.each(notDrills)("%s is not a drill", (_what, input) => {
    expect([...new Set(codesOf(input))]).toEqual(["schema"]);
  });
});

describe("level limits", () => {
  // floor(maxWords × 1.15), worked out by hand.
  const WORD_CEILINGS: Record<Level, number> = { 1: 172, 2: 230, 3: 322, 4: 437, 5: 552 };

  test.each(LEVELS)("level %d accepts the reference drill reshaped to its error and decoy counts", (level) => {
    expect(codesOf(atLevel(level))).toEqual([]);
  });

  // Levels 2 and 4 are the ones where maxWords × 1.15 lands just below a whole number in floating point.
  test.each(LEVELS)("level %d accepts a document at its slack ceiling and not one word more", (level) => {
    const atCeiling = atLevel(level);
    padToWords(atCeiling, WORD_CEILINGS[level]);
    expect(countWords(atCeiling.artifact)).toBe(WORD_CEILINGS[level]);
    expect(codesOf(atCeiling)).toEqual([]);

    const oneOver = atLevel(level);
    padToWords(oneOver, WORD_CEILINGS[level] + 1);
    expect(codesOf(oneOver)).toEqual(["too_long"]);
  });
});

describe("numeric tolerance", () => {
  /** A check on the Total row's spend, which the reference drill leaves unchecked. */
  const totalSpend = (stated: number, tolerance: number): NumericCheck => ({
    targetId: "r4c2",
    expression: "42000+18000+10000",
    stated,
    tolerance,
    isError: false,
  });

  test("is inclusive for a correct line: off by exactly the tolerance still agrees", () => {
    const withinTolerance = reference();
    withinTolerance.numericChecks.push(totalSpend(70002, 2));
    expect(codesOf(withinTolerance)).toEqual([]);

    const beyondTolerance = reference();
    beyondTolerance.numericChecks.push(totalSpend(70003, 2));
    expect(codesOf(beyondTolerance)).toEqual(["numeric_correct_is_wrong"]);
  });

  test("must be exceeded by a planted mistake: off by exactly the tolerance is not a mistake", () => {
    const offByTolerance = reference();
    Object.assign(offByTolerance.numericChecks[0]!, { expression: "300/20", stated: 17, tolerance: 2 });
    expect(codesOf(offByTolerance)).toEqual(["numeric_error_is_correct"]);

    const offByMore = reference();
    Object.assign(offByMore.numericChecks[0]!, { expression: "300/20", stated: 18, tolerance: 2 });
    expect(codesOf(offByMore)).toEqual([]);
  });

  test("does not mistake floating-point noise for a discrepancy", () => {
    const drill = reference();
    drill.numericChecks.push(
      // Evaluates to 434.99999999999994.
      { targetId: "s8", expression: "4.35*100", stated: 435, tolerance: 0, isError: false },
      // Evaluates to -2.7755575615628914e-17.
      { targetId: "s8", expression: "0.3-0.1-0.2", stated: 0, tolerance: 0, isError: false },
    );
    expect(codesOf(drill)).toEqual([]);
  });

  test("does not let floating-point noise pass for a planted mistake", () => {
    const drill = reference();
    Object.assign(drill.numericChecks[0]!, { expression: "4.35*100", stated: 435, tolerance: 0 });
    expect(codesOf(drill)).toEqual(["numeric_error_is_correct"]);
  });
});

describe("formatIssues", () => {
  test("renders one bullet per issue: its code, then its message", () => {
    const issues: VerifyIssue[] = [
      { code: "decoy_count", message: "Level 3 needs exactly 1 decoy, but the drill has 0" },
      { code: "unknown_target", message: 'key[1] points at "s99", but no segment or cell has that id', targetId: "s99" },
    ];
    expect(formatIssues(issues)).toBe(
      "- [decoy_count] Level 3 needs exactly 1 decoy, but the drill has 0\n" +
        '- [unknown_target] key[1] points at "s99", but no segment or cell has that id',
    );
  });

  test("mentions the code and message of every kind of issue", () => {
    for (const code of CODES) {
      for (const mutate of Object.values(MUTATIONS[code])) {
        const drill = reference();
        mutate(drill);
        const issues = issuesOf(drill);
        const lines = formatIssues(issues).split("\n");
        expect(lines).toEqual(issues.map((issue) => `- [${code}] ${issue.message}`));
      }
    }
  });

  test("of no issues is empty", () => {
    expect(formatIssues([])).toBe("");
  });
});
