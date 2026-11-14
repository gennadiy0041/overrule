/**
 * A calculator for exactly one job: re-doing the arithmetic behind a drill.
 *
 * Every number in a drill comes with an expression written by an LLM
 * (`numericChecks[].expression`), and the verifier recomputes it. That string is
 * untrusted input, so it is never handed to the JavaScript engine. It is tokenized
 * and parsed here against a grammar with no identifiers, calls or property access,
 * which leaves nothing to inject into:
 *
 *   expression := term (("+" | "-") term)*
 *   term       := unary (("*" | "/") unary)*
 *   unary      := "-"* primary
 *   primary    := number | "(" expression ")"
 *   number     := digits ("." digits)? | "." digits
 *
 * Left out on purpose: exponent notation, thousands separators, percent signs, unary
 * plus and implicit multiplication. Each is a way for "1,000", "15%" or "2(3)" to be
 * read as a different number than the model meant; an error and a retry are cheaper
 * than a wrong answer key.
 *
 * Results are ordinary IEEE-754 doubles (0.1 + 0.2 is 0.30000000000000004). Rounding
 * is the caller's business — see the tolerance in engine/verifyDrill.
 */

export class SafeMathError extends Error {
  override readonly name = "SafeMathError";
}

/** Same limit as the schema puts on `numericChecks[].expression`. */
export const MAX_EXPRESSION_LENGTH = 200;

/** Real checks nest two or three levels deep; this only stops runaway input. */
export const MAX_NESTING_DEPTH = 32;

type Punctuator = "+" | "-" | "*" | "/" | "(" | ")";

type Token =
  | { readonly kind: "number"; readonly value: number; readonly position: number }
  | { readonly kind: Punctuator; readonly position: number };

/**
 * LLMs like typographic operators, so the three unambiguous ones are folded into
 * ASCII. Dashes are not: "3–5" is a range as often as it is a subtraction.
 */
const PUNCTUATORS: ReadonlyMap<string, Punctuator> = new Map<string, Punctuator>([
  ["+", "+"],
  ["-", "-"],
  ["*", "*"],
  ["/", "/"],
  ["(", "("],
  [")", ")"],
  ["\u{2212}", "-"], // − minus sign
  ["\u{00D7}", "*"], // × multiplication sign
  ["\u{00F7}", "/"], // ÷ division sign
]);

const WHITESPACE = /\s/;

/** ASCII only: Unicode's other digit sets (full-width, Arabic-Indic) are not numbers to `Number()`. */
function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= "0" && char <= "9";
}

function skipDigits(chars: ReadonlyArray<string>, from: number): number {
  let index = from;
  while (isDigit(chars[index])) index++;
  return index;
}

/** Index just past the number literal that starts at `start`. */
function endOfNumber(chars: ReadonlyArray<string>, start: number): number {
  const integerEnd = skipDigits(chars, start);
  if (chars[integerEnd] !== ".") return integerEnd;
  const fractionEnd = skipDigits(chars, integerEnd + 1);
  if (fractionEnd === integerEnd + 1) {
    throw new SafeMathError(`Expected a digit after the decimal point at position ${integerEnd + 1}`);
  }
  return fractionEnd;
}

/**
 * Whitespace separates tokens rather than disappearing, so "1 000" stays two numbers
 * (an error) instead of quietly becoming 1000.
 */
function tokenize(expression: string): Token[] {
  const chars = Array.from(expression);
  const tokens: Token[] = [];
  let index = 0;
  while (index < chars.length) {
    const char = chars[index]!;
    const position = index + 1;
    if (WHITESPACE.test(char)) {
      index++;
    } else if (isDigit(char) || char === ".") {
      const end = endOfNumber(chars, index);
      tokens.push({ kind: "number", value: Number(chars.slice(index, end).join("")), position });
      index = end;
    } else {
      const kind = PUNCTUATORS.get(char);
      if (kind === undefined) {
        throw new SafeMathError(`Unexpected character ${JSON.stringify(char)} at position ${position}`);
      }
      tokens.push({ kind, position });
      index++;
    }
  }
  return tokens;
}

function unexpected(token: Token): SafeMathError {
  const what = token.kind === "number" ? "number" : `"${token.kind}"`;
  return new SafeMathError(`Unexpected ${what} at position ${token.position}`);
}

function divide(dividend: number, divisor: number): number {
  if (divisor === 0) throw new SafeMathError("Division by zero");
  return dividend / divisor;
}

/** Recursive descent over the grammar at the top of this file, one method per rule. */
class Parser {
  private readonly tokens: ReadonlyArray<Token>;
  private index = 0;
  private depth = 0;

  constructor(tokens: ReadonlyArray<Token>) {
    this.tokens = tokens;
  }

  /** The whole input must be one expression: leftovers ("1 2", "2(3)", a stray ")") are errors. */
  parse(): number {
    const value = this.expression();
    const leftover = this.tokens[this.index];
    if (leftover !== undefined) throw unexpected(leftover);
    return value;
  }

  /** A loop rather than right recursion, which is what makes "10-4-3" equal 3 and not 9. */
  private expression(): number {
    let value = this.term();
    for (;;) {
      if (this.take("+")) value += this.term();
      else if (this.take("-")) value -= this.term();
      else return value;
    }
  }

  private term(): number {
    let value = this.unary();
    for (;;) {
      if (this.take("*")) value *= this.unary();
      else if (this.take("/")) value = divide(value, this.unary());
      else return value;
    }
  }

  private unary(): number {
    let negative = false;
    while (this.take("-")) negative = !negative;
    const value = this.primary();
    return negative ? -value : value;
  }

  private primary(): number {
    const token = this.tokens[this.index++];
    if (token === undefined) throw new SafeMathError("Unexpected end of expression");
    if (token.kind === "number") return token.value;
    if (token.kind !== "(") throw unexpected(token);

    if (++this.depth > MAX_NESTING_DEPTH) {
      throw new SafeMathError(`Parentheses are nested more than ${MAX_NESTING_DEPTH} deep`);
    }
    const value = this.expression();
    if (!this.take(")")) throw new SafeMathError(`Expected ")" to close the "(" at position ${token.position}`);
    this.depth--;
    return value;
  }

  /** Consumes the next token if it is `kind`. */
  private take(kind: Punctuator): boolean {
    if (this.tokens[this.index]?.kind !== kind) return false;
    this.index++;
    return true;
  }
}

/** Evaluate plain arithmetic: decimal numbers, + - * /, parentheses, unary minus. Nothing else. */
export function evaluate(expression: string): number {
  if (expression.length > MAX_EXPRESSION_LENGTH) {
    throw new SafeMathError(`Expression is longer than ${MAX_EXPRESSION_LENGTH} characters`);
  }
  const tokens = tokenize(expression);
  if (tokens.length === 0) throw new SafeMathError("Expression is empty");

  const result = new Parser(tokens).parse();
  // A backstop: nothing that fits in 200 characters gets past about 1e200, but the promise
  // "a finite number or a SafeMathError" should not depend on the length limit.
  if (!Number.isFinite(result)) throw new SafeMathError("Result is not a finite number");
  return result;
}
