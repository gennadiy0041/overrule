import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { NumericCheckSchema } from "../../src/engine/drillSchema";
import { MAX_EXPRESSION_LENGTH, MAX_NESTING_DEPTH, SafeMathError, evaluate } from "../../src/engine/safeMath";

type Case = [expression: string, value: number];

function failure(expression: string): unknown {
  try {
    evaluate(expression);
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("evaluate accepts plain arithmetic", () => {
  const precedence: Case[] = [
    ["1+2*3", 7],
    ["2*3+1", 7],
    ["10-6/2", 7],
    ["2+3*4-5", 9],
  ];
  test.each(precedence)("* and / bind tighter than + and -: %s = %d", (expression, value) => {
    expect(evaluate(expression)).toBe(value);
  });

  const associativity: Case[] = [
    ["10-4-3", 3],
    ["100/10/2", 5],
    ["2-3+4", 3],
    ["8/4*2", 4],
  ];
  test.each(associativity)("operators of equal rank run left to right: %s = %d", (expression, value) => {
    expect(evaluate(expression)).toBe(value);
  });

  const parentheses: Case[] = [
    ["(1+2)*3", 9],
    ["10-(4-3)", 9],
    ["100/(10/2)", 20],
    ["((7))", 7],
    ["2*(3+(4-1))", 12],
  ];
  test.each(parentheses)("parentheses override both: %s = %d", (expression, value) => {
    expect(evaluate(expression)).toBe(value);
  });

  const unaryMinus: Case[] = [
    ["-3", -3],
    ["-(1+2)", -3],
    ["2*-3", -6],
    ["2--3", 5],
    ["--3", 3],
    ["-2*-2", 4],
    ["(-4)/2", -2],
  ];
  test.each(unaryMinus)("unary minus: %s = %d", (expression, value) => {
    expect(evaluate(expression)).toBe(value);
  });

  const numbers: Case[] = [
    ["3", 3],
    ["3.0", 3],
    [".5", 0.5],
    ["0.25", 0.25],
    ["211000", 211000],
    ["007", 7],
    ["1.5*2", 3],
  ];
  test.each(numbers)("decimal literals: %s = %d", (expression, value) => {
    expect(evaluate(expression)).toBe(value);
  });

  test("results are IEEE-754 doubles with no hidden rounding", () => {
    expect(evaluate("0.1+0.2")).toBe(0.1 + 0.2);
    expect(evaluate("4.35*100")).toBe(434.99999999999994);
  });

  const typographic: Case[] = [
    ["5 \u{2212} 3", 2],
    ["4 \u{00D7} 2.5", 10],
    ["9 \u{00F7} 3", 3],
    ["\u{2212}3", -3],
    ["(126000 \u{2212} 63000) \u{00F7} (4 \u{00D7} 2.5)", 6300],
  ];
  test.each(typographic)("typographic −, × and ÷ (U+2212, U+00D7, U+00F7): %s = %d", (expression, value) => {
    expect(evaluate(expression)).toBe(value);
  });

  test("whitespace between tokens is ignored, no-break spaces included", () => {
    expect(evaluate("  ( 126000 +\t63000 )\n/ 70000 ")).toBe(2.7);
    expect(evaluate("1\u{00A0}+\u{00A0}1")).toBe(2);
  });

  const referenceDrill: Case[] = [
    ["(3.0/2.6-1)*100", 15.384615],
    ["63000/18000", 3.5],
    ["22000/10000", 2.2],
    ["126000+63000+22000", 211000],
    ["211000/70000", 3.014286],
  ];
  test.each(referenceDrill)("the reference drill's checks: %s ≈ %d", (expression, value) => {
    expect(evaluate(expression)).toBeCloseTo(value, 5);
  });
});

describe("evaluate refuses everything else", () => {
  const rejected: Array<[expression: string, reason: string]> = [
    // Nothing to evaluate.
    ["", "Expression is empty"],
    ["   ", "Expression is empty"],

    // Identifiers and code.
    ["process.exit(1)", 'Unexpected character "p" at position 1'],
    ["a+1", 'Unexpected character "a" at position 1'],
    ["1+x", 'Unexpected character "x" at position 3'],
    ["Math.max(1,2)", 'Unexpected character "M"'],
    ["Infinity", 'Unexpected character "I"'],
    ["NaN", 'Unexpected character "N"'],
    ["1;2", 'Unexpected character ";"'],
    ["`1`", 'Unexpected character "`"'],
    ["63000/eighteen", 'Unexpected character "e" at position 7'],

    // Numbers that are not plain decimals.
    ["1e3", 'Unexpected character "e" at position 2'],
    ["0x10", 'Unexpected character "x"'],
    ["1,000+1", 'Unexpected character "," at position 2'],
    ["1_000", 'Unexpected character "_"'],
    ["1 000", "Unexpected number at position 3"],
    ["50%", 'Unexpected character "%"'],
    ["$5", 'Unexpected character "$"'],
    ["3.", "Expected a digit after the decimal point at position 2"],
    [".", "Expected a digit after the decimal point at position 1"],
    ["1.2.3", "Unexpected number at position 4"],
    ["\u{FF11}\u{FF12}", "Unexpected character"], // full-width digits
    ["\u{0661}\u{0662}", "Unexpected character"], // Arabic-Indic digits

    // Operators outside the grammar.
    ["2**3", 'Unexpected "*" at position 3'],
    ["2^3", 'Unexpected character "^"'],
    ["+1", 'Unexpected "+" at position 1'],
    ["2(3)", 'Unexpected "(" at position 2'],
    ["(1)(2)", 'Unexpected "(" at position 4'],
    ["5\u{2013}3", "Unexpected character"], // en dash: a range as often as a minus

    // Unfinished expressions.
    ["1+", "Unexpected end of expression"],
    ["2*", "Unexpected end of expression"],
    ["-", "Unexpected end of expression"],
    ["*2", 'Unexpected "*" at position 1'],
    ["1+*2", 'Unexpected "*" at position 3'],
    ["1+1//2", 'Unexpected "/" at position 5'],

    // Unbalanced parentheses.
    ["(1+2", 'Expected ")" to close the "(" at position 1'],
    ["2*(3+(4-1)", 'Expected ")" to close the "(" at position 3'],
    ["1+2)", 'Unexpected ")" at position 4'],
    ["()", 'Unexpected ")" at position 2'],
    [")(", 'Unexpected ")" at position 1'],

    // Division by zero, however the zero is spelled.
    ["1/0", "Division by zero"],
    ["1/(2-2)", "Division by zero"],
    ["0/0", "Division by zero"],
    ["5/-0", "Division by zero"],
    ["5/.0", "Division by zero"],
  ];

  test.each(rejected)("%p → %s", (expression, reason) => {
    expect(() => evaluate(expression)).toThrow(SafeMathError);
    expect(() => evaluate(expression)).toThrow(reason);
  });

  test("failures are SafeMathError, so a caller can tell bad input from a bug", () => {
    const error = failure("1/0");
    expect(error).toBeInstanceOf(SafeMathError);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ name: "SafeMathError", message: "Division by zero" });
  });
});

describe("evaluate bounds its input", () => {
  test(`accepts ${MAX_EXPRESSION_LENGTH} characters and refuses one more`, () => {
    const atLimit = `${"1+".repeat(99)}11`;
    expect(atLimit).toHaveLength(MAX_EXPRESSION_LENGTH);
    expect(evaluate(atLimit)).toBe(110);
    expect(() => evaluate(`${atLimit}1`)).toThrow(SafeMathError);
    expect(() => evaluate(`${atLimit}1`)).toThrow("Expression is longer than");
  });

  const nested = (depth: number): string => "(".repeat(depth) + "1" + ")".repeat(depth);

  test(`accepts parentheses ${MAX_NESTING_DEPTH} deep and refuses one more`, () => {
    expect(evaluate(nested(MAX_NESTING_DEPTH))).toBe(1);
    expect(() => evaluate(nested(MAX_NESTING_DEPTH + 1))).toThrow(SafeMathError);
    expect(() => evaluate(nested(MAX_NESTING_DEPTH + 1))).toThrow("Parentheses are nested");
  });

  test("depth is how deep the parentheses go, not how many there are", () => {
    const groups = MAX_NESTING_DEPTH + 8;
    expect(evaluate(Array(groups).fill("(1)").join("+"))).toBe(groups);
  });

  test("a run of minus signs is only a sign", () => {
    expect(evaluate(`${"-".repeat(100)}7`)).toBe(7);
    expect(evaluate(`${"-".repeat(101)}7`)).toBe(-7);
  });

  test("the largest value that fits in the length limit is still finite", () => {
    expect(evaluate("9".repeat(MAX_EXPRESSION_LENGTH))).toBe(1e200);
  });
});

describe("evaluate treats input as data, never as code", () => {
  test("an expression with a side effect has none", () => {
    const probe = globalThis as { overruleSafeMathProbe?: boolean };
    expect(() => evaluate("globalThis.overruleSafeMathProbe=true")).toThrow(SafeMathError);
    expect(probe.overruleSafeMathProbe).toBeUndefined();
  });

  // A tripwire for refactors: the parser must stay hand-written.
  test("the module has no way to run a string", async () => {
    const source = await Bun.file(join(import.meta.dir, "..", "..", "src", "engine", "safeMath.ts")).text();
    expect(source).not.toMatch(/\beval\s*\(|\bFunction\s*\(|\bimport\s*\(|\brequire\s*\(/);
  });
});
