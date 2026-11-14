/**
 * The deterministic gate between the model that writes a drill and the person who plays it.
 *
 * A drill only teaches if its answer key is true: each planted mistake really is a
 * mistake, and every decoy and ordinary line really is fine. A model cannot be trusted
 * to grade its own key, so everything that can be settled mechanically is settled here,
 * in plain code: structure, references, level limits and, through engine/safeMath, the
 * arithmetic behind every number.
 *
 * The checks never stop at the first problem. The whole list goes back to the model for
 * its one retry (`formatIssues`), and a retry that learns about one issue at a time is a
 * retry wasted.
 */
import type { ZodError } from "zod";
import { DrillSchema, LEVEL_SPECS, countWords, listTargets } from "./drillSchema";
import type { Drill, NumericCheck } from "./drillSchema";
import { SafeMathError, evaluate } from "./safeMath";

export type VerifyIssueCode =
  | "schema"
  | "duplicate_id"
  | "unknown_target"
  | "duplicate_key_target"
  | "duplicate_decoy_target"
  | "decoy_in_key"
  | "type_diversity"
  | "error_count"
  | "decoy_count"
  | "too_long"
  | "bad_expression"
  | "numeric_error_is_correct"
  | "numeric_correct_is_wrong"
  | "numbers_error_unproven"
  | "numeric_error_not_in_key";

export interface VerifyIssue {
  code: VerifyIssueCode;
  message: string;
  /** The segment or cell the issue is about, when it is about one. */
  targetId?: string;
}

export type VerifyResult = { ok: true; drill: Drill } | { ok: false; issues: VerifyIssue[] };

/** A drill should exercise several kinds of judgment, not the same catch three times. */
export const MIN_DISTINCT_ERROR_TYPES = 3;

/**
 * How far a document may overshoot its level's `maxWords`. Models count words loosely,
 * and the limit only exists to keep a drill near five minutes, so a good drill is not
 * thrown away over a dozen extra words.
 */
export const WORD_LIMIT_SLACK = 1.15;

/**
 * Binary floating point cannot hold most decimals: 4.35 * 100 evaluates to
 * 434.99999999999994 and 200 * 1.15 to 229.99999999999997. Comparisons leave this much
 * room, so that such noise never becomes a wrong number or a document one word too long.
 */
const FLOAT_NOISE = 1e-9;

type Check = (drill: Drill) => VerifyIssue[];

/** In reading order: structure, then what the level demands, then the arithmetic. */
const CHECKS: ReadonlyArray<Check> = [
  checkUniqueIds,
  checkTargetsExist,
  checkOneEntryPerTarget,
  checkDecoysAvoidKey,
  checkTypeDiversity,
  checkErrorCount,
  checkDecoyCount,
  checkLength,
  checkArithmetic,
  checkNumbersMistakesProven,
  checkNumericErrorsPlanted,
];

/** Deterministic gate every drill must pass before a user sees it. Pure code — no LLM. */
export function verifyDrill(input: unknown): VerifyResult {
  const parsed = DrillSchema.safeParse(input);
  // Nothing below means anything on a malformed drill, so a schema failure is reported alone.
  if (!parsed.success) return { ok: false, issues: schemaIssues(parsed.error) };

  const drill = parsed.data;
  const issues = CHECKS.flatMap((check) => check(drill));
  return issues.length === 0 ? { ok: true, drill } : { ok: false, issues };
}

/** Issues rendered as a bullet list — fed back to the model on the retry. */
export function formatIssues(issues: ReadonlyArray<VerifyIssue>): string {
  return issues.map(({ code, message }) => `- [${code}] ${message}`).join("\n");
}

function schemaIssues(error: ZodError): VerifyIssue[] {
  return error.issues.map(({ path, message }) => {
    const where = formatPath(path);
    return issue("schema", where === "" ? message : `${where}: ${message}`);
  });
}

/** ["key", 1, "targetId"] becomes "key[1].targetId", the way the other messages name entries. */
function formatPath(path: ReadonlyArray<PropertyKey>): string {
  let text = "";
  for (const part of path) {
    if (typeof part === "number") text += `[${part}]`;
    else text += text === "" ? String(part) : `.${String(part)}`;
  }
  return text;
}

/** Flags, key items and numeric checks all address a line by id, so an id must name one line. */
function checkUniqueIds(drill: Drill): VerifyIssue[] {
  return repeated(targetIds(drill)).map((id) =>
    issue("duplicate_id", `Id "${id}" is used by more than one segment or cell; ids must be unique`, id),
  );
}

function checkTargetsExist(drill: Drill): VerifyIssue[] {
  const known = new Set(targetIds(drill));
  return references(drill)
    .filter(({ targetId }) => !known.has(targetId))
    .map(({ where, targetId }) =>
      issue("unknown_target", `${where} points at "${targetId}", but no segment or cell has that id`, targetId),
    );
}

/** A flag marks a whole segment, so two mistakes planted in one segment could never both be caught. */
function checkOneEntryPerTarget(drill: Drill): VerifyIssue[] {
  const inKey = repeated(drill.key.map((item) => item.targetId)).map((id) =>
    issue("duplicate_key_target", `"${id}" is in the key more than once; plant one mistake per segment or cell`, id),
  );
  const inDecoys = repeated(drill.decoys.map((decoy) => decoy.targetId)).map((id) =>
    issue("duplicate_decoy_target", `"${id}" is listed as a decoy more than once`, id),
  );
  return [...inKey, ...inDecoys];
}

/** Flagging a mistake earns points and flagging a decoy costs them; one line cannot do both. */
function checkDecoysAvoidKey(drill: Drill): VerifyIssue[] {
  const planted = keyTargets(drill);
  return drill.decoys
    .filter(({ targetId }) => planted.has(targetId))
    .map(({ targetId }) => {
      const message = `"${targetId}" is both a planted mistake and a decoy; a decoy must be a line that is fine`;
      return issue("decoy_in_key", message, targetId);
    });
}

function checkTypeDiversity(drill: Drill): VerifyIssue[] {
  const types = new Set(drill.key.map((item) => item.type));
  if (types.size >= MIN_DISTINCT_ERROR_TYPES) return [];
  const found = `${plural(types.size, "error type")} (${[...types].join(", ")})`;
  const message = `The key covers ${found}; at least ${MIN_DISTINCT_ERROR_TYPES} different types are required`;
  return [issue("type_diversity", message)];
}

function checkErrorCount(drill: Drill): VerifyIssue[] {
  const { minErrors, maxErrors } = LEVEL_SPECS[drill.level];
  const planted = drill.key.length;
  if (planted >= minErrors && planted <= maxErrors) return [];
  const wanted = minErrors === maxErrors ? `exactly ${minErrors}` : `${minErrors} to ${maxErrors}`;
  return [issue("error_count", `Level ${drill.level} needs ${wanted} planted mistakes, but the key has ${planted}`)];
}

function checkDecoyCount(drill: Drill): VerifyIssue[] {
  const wanted = LEVEL_SPECS[drill.level].decoys;
  const found = drill.decoys.length;
  if (found === wanted) return [];
  const message = `Level ${drill.level} needs exactly ${plural(wanted, "decoy")}, but the drill has ${found}`;
  return [issue("decoy_count", message)];
}

function checkLength(drill: Drill): VerifyIssue[] {
  const { maxWords } = LEVEL_SPECS[drill.level];
  const words = countWords(drill.artifact);
  if (words <= wordCeiling(maxWords)) return [];
  return [issue("too_long", `The artifact has ${words} words; level ${drill.level} allows at most ${maxWords}`)];
}

/** The largest whole word count the slack allows; the nudge keeps 200 × 1.15 at 230, not 229. */
function wordCeiling(maxWords: number): number {
  return Math.floor(maxWords * WORD_LIMIT_SLACK + FLOAT_NOISE);
}

function checkArithmetic(drill: Drill): VerifyIssue[] {
  return drill.numericChecks.flatMap((check, index) => arithmeticIssues(check, `numericChecks[${index}]`));
}

function arithmeticIssues(check: NumericCheck, where: string): VerifyIssue[] {
  const { targetId, expression, stated, tolerance, isError } = check;
  const outcome = calculate(expression);
  if ("error" in outcome) {
    const message = `${where}.expression "${expression}" is not plain arithmetic: ${outcome.error}`;
    return [issue("bad_expression", message, targetId)];
  }

  const agrees = isWithinTolerance(outcome.value, stated, tolerance);
  const calculated = formatNumber(outcome.value);
  const sum = `${expression} = ${calculated}, the document says ${formatNumber(stated)}, tolerance ${tolerance}`;
  if (isError && agrees) {
    const message = `${where} marks "${targetId}" as a numeric mistake, but its number is right: ${sum}`;
    return [issue("numeric_error_is_correct", message, targetId)];
  }
  if (!isError && !agrees) {
    const message = `${where} marks "${targetId}" as correct, but its number is wrong: ${sum}`;
    return [issue("numeric_correct_is_wrong", message, targetId)];
  }
  return [];
}

/** `evaluate`, with the one failure expected of model-written input turned into a value. */
function calculate(expression: string): { value: number } | { error: string } {
  try {
    return { value: evaluate(expression) };
  } catch (error) {
    if (error instanceof SafeMathError) return { error: error.message };
    throw error;
  }
}

/**
 * Whether the number in the document agrees with the recomputed one. The tolerance is
 * inclusive, and widened by floating-point noise so that a tolerance of 0 still accepts
 * 4.35 * 100 = 435. The noise is relative for large values and absolute below 1, where
 * a subtraction such as 0.3 - 0.1 - 0.2 leaves a residue instead of zero.
 */
function isWithinTolerance(calculated: number, stated: number, tolerance: number): boolean {
  const noise = FLOAT_NOISE * Math.max(1, Math.abs(calculated), Math.abs(stated));
  return Math.abs(calculated - stated) <= tolerance + noise;
}

/** A "numbers" mistake is the one kind that code can prove, so each must come with its proof. */
function checkNumbersMistakesProven(drill: Drill): VerifyIssue[] {
  const proven = new Set(drill.numericChecks.filter((check) => check.isError).map((check) => check.targetId));
  return drill.key
    .filter(({ type, targetId }) => type === "numbers" && !proven.has(targetId))
    .map(({ targetId }) => {
      const message = `Key item "${targetId}" is a numbers mistake, but no numericCheck with isError=true proves it`;
      return issue("numbers_error_unproven", message, targetId);
    });
}

/**
 * A wrong number outside the key is a mistake the user would lose points for catching.
 * Tying every failing check to a key item keeps decoys and ordinary lines numerically right.
 */
function checkNumericErrorsPlanted(drill: Drill): VerifyIssue[] {
  const planted = keyTargets(drill);
  return drill.numericChecks.flatMap(({ targetId, isError }, index) => {
    if (!isError || planted.has(targetId)) return [];
    const message = `numericChecks[${index}] marks "${targetId}" as a numeric mistake, but it is not in the key`;
    return [issue("numeric_error_not_in_key", message, targetId)];
  });
}

const ANSWER_SECTIONS = ["key", "decoys", "numericChecks"] as const;

/** Every targetId the answer key mentions, labelled with where it sits (e.g. `decoys[0]`). */
function references(drill: Drill): Array<{ where: string; targetId: string }> {
  return ANSWER_SECTIONS.flatMap((section) => {
    const entries: ReadonlyArray<{ targetId: string }> = drill[section];
    return entries.map(({ targetId }, index) => ({ where: `${section}[${index}]`, targetId }));
  });
}

function targetIds(drill: Drill): string[] {
  return listTargets(drill.artifact).map((target) => target.id);
}

function keyTargets(drill: Drill): Set<string> {
  return new Set(drill.key.map((item) => item.targetId));
}

/** Values that occur more than once, each listed once. */
function repeated(values: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const again = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) again.add(value);
    else seen.add(value);
  }
  return [...again];
}

function issue(code: VerifyIssueCode, message: string, targetId?: string): VerifyIssue {
  return targetId === undefined ? { code, message } : { code, message, targetId };
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Ten significant digits: enough to show a discrepancy, without tails like 434.99999999999994. */
function formatNumber(value: number): string {
  return String(Number(value.toPrecision(10)));
}
