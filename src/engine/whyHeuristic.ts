/**
 * Fallback grader for the optional "why" note.
 *
 * Normally an LLM grades the note against a rubric (2 = named the core problem, 1 = partly,
 * 0 = missed it). When that call fails or times out the attempt still has to be scored, so the
 * rubric is estimated from the vocabulary the note shares with the answer key.
 *
 * The estimate is deliberately conservative. It can only see shared words and numbers, so a
 * correct paraphrase may get 0 — but "looks wrong" can never score, and that matters more for a
 * rating people are meant to trust. Either way little is at stake: the note is worth at most 6
 * of the 21–41 points a key item carries.
 */
import type { KeyItem } from "./drillSchema";
import type { WhyScore } from "./scoring";

const MIN_NOTE_LENGTH = 3;
const MIN_WORD_LENGTH = 3;

/**
 * Function words, plus review filler ("looks wrong", "check the numbers") that could be said of
 * any mistake and therefore proves nothing about this one. Words under three letters never get
 * this far, which is why "is", "to" and "of" are not listed.
 */
const STOP_WORDS = new Set(
  `the and but for nor not with without from into about over under between against than then
   this that these those there here what which when where while who why how
   you your they them their its our his her she him
   are was were been being has have had does did can could will would should may might must
   all any some each every such very just also too only one out off
   wrong incorrect error errors mistake mistakes check number numbers look looks seem seems
   sure right correct make makes sense need needs use line sentence`.split(/\s+/),
);

const WORD = /[a-z]+/g;
/** Digits with optional thousands separators and decimals: "63,000", "3.50", "15". */
const NUMBER = /\d+(?:,\d{3})*(?:\.\d+)?/g;
const NEGATED_CONTRACTION = /n['’]t\b/g;

/**
 * Crude suffix stripping, so that "moved", "moving" and "moves" all meet "move". The note and the
 * key go through the same function, which makes over-stemming harmless ("pricing" → "pric"): all
 * that matters is that the forms of one word collapse to one token.
 */
function stem(word: string): string {
  return word
    .replace(/s$/, "") // claims → claim
    .replace(/^(.{3,})(?:ing|ed)$/, "$1") // tested, testing → test, but not need → ne
    .replace(/e+$/, "") // move, moved → mov; taxes → tax; guarantee, guaranteed → guarant
    .replace(/(.)\1$/, "$1") // planned → plan; miss, missing → mis
    .replace(/y$/, "i"); // policy, policies → polici
}

function contentWords(text: string): string[] {
  return (text.match(WORD) ?? [])
    .filter((word) => word.length >= MIN_WORD_LENGTH && !STOP_WORDS.has(word))
    .map(stem);
}

/** "$63,000", "63000" and "63,000.00" are one number; so are "15%" and "15". */
function numberTokens(text: string): string[] {
  return (text.match(NUMBER) ?? []).map((raw) => String(Number(raw.replaceAll(",", ""))));
}

/**
 * Every distinct piece of evidence a text can offer. "n't" is spelled out first so that
 * "doesn't" lands on two stop words instead of surviving as the content word "doesn".
 */
function tokens(text: string): Set<string> {
  const lower = text.toLowerCase().replace(NEGATED_CONTRACTION, " not");
  return new Set([...contentWords(lower), ...numberTokens(lower)]);
}

/**
 * Keyword-overlap estimate of whether the user's note names the actual problem. Deliberately
 * conservative: two distinct tokens shared with the key (content words or numbers, in any mix)
 * score 2, a single one scores 1, and repeating one word does not add up to two.
 */
export function heuristicWhyScore(
  why: string | undefined,
  item: Pick<KeyItem, "explanation" | "correction" | "cue">,
): WhyScore {
  const note = why?.trim() ?? "";
  if (note.length < MIN_NOTE_LENGTH) return 0;

  const keyTokens = tokens(`${item.explanation} ${item.correction} ${item.cue}`);
  let shared = 0;
  for (const token of tokens(note)) {
    if (keyTokens.has(token)) shared++;
  }
  if (shared >= 2) return 2;
  return shared === 1 ? 1 : 0;
}
