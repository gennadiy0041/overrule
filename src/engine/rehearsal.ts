/**
 * "Defend your work": the questions a reader will ask about a document before it is sent.
 *
 * A model writes the questions and judges the answers. This module is the part that
 * does not depend on it: it checks that every question points at a line that is really
 * in the document, writes the questions itself when no model is available, and scores
 * answers by plain, explainable rules when the model cannot.
 */
import type { ErrorType } from "./drillSchema";

export const REHEARSAL_TEXT_MIN = 200;
export const REHEARSAL_TEXT_MAX = 8_000;
export const REHEARSAL_QUESTIONS = 5;
export const QUOTE_MAX = 240;
export const QUESTION_MAX = 240;
export const ANSWER_MAX = 600;

/** Fewer grounded questions than this and the model's set is discarded as a whole. */
export const MIN_GROUNDED_QUESTIONS = 3;

const QUOTE_MIN = 12;
const SENTENCE_MIN = 25;

export type Verdict = "holds" | "partial" | "open";

export interface QuestionDraft {
  /** The same five kinds of mistakes the drills train. */
  kind: ErrorType;
  /** The line of the document the question is about, copied from it. */
  quote: string;
  question: string;
  /** What the reader is really checking. */
  why: string;
}

export interface RehearsalQuestion extends QuestionDraft {
  id: string;
}

export interface AnswerVerdict {
  id: string;
  verdict: Verdict;
  /** What to add, find or change before sending. */
  note: string;
}

/** Compare text the way a reader would: spacing, typographic quotes, dashes and case do not matter. */
function normalize(text: string): string {
  return text
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** True when the quote is a line of the document, not something the model made up. */
export function isGrounded(text: string, quote: string): boolean {
  const needle = normalize(quote).replace(/^\.\.\.|\.\.\.$/g, "").trim();
  return needle.length >= QUOTE_MIN && normalize(text).includes(needle);
}

/** Cut a string to `max` characters on a word boundary; `mark` shows that something was cut. */
function clip(text: string, max: number, mark: string): string {
  if (text.length <= max) return text;
  return text.slice(0, max - mark.length).replace(/\s+\S*$/, "") + mark;
}

function withIds(drafts: ReadonlyArray<QuestionDraft>): RehearsalQuestion[] {
  return drafts.map((draft, index) => ({ id: `q${index + 1}`, ...draft }));
}

/** Split a document into quotable lines: paragraphs first, then sentences. */
function sentences(text: string): string[] {
  return text
    .split(/\n+/)
    // No lookbehind: this module is also bundled for browsers that lack it.
    .flatMap((line) => line.replace(/\s+/g, " ").trim().replace(/([.!?])\s+(?=[A-Z0-9"“(])/g, "$1\n").split("\n"))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= SENTENCE_MIN)
    .map((sentence) => clip(sentence, QUOTE_MAX, ""));
}

interface Probe {
  kind: ErrorType;
  pattern: RegExp;
  question: (match: string) => string;
  why: string;
}

/**
 * Where an author is most exposed, in the order a careful reader looks.
 * Each probe finds one kind of weak spot and asks the question that follows from it.
 */
const PROBES: ReadonlyArray<Probe> = [
  {
    kind: "numbers",
    pattern:
      /[$€£]\s?\d[\d,.]*\s?(?:k|m|bn|million|billion|thousand)?\b|\b\d[\d,.]*\s?(?:%|percent\b|percentage points?\b)|\b\d{1,3}(?:,\d{3})+\b|\b\d+(?:\.\d+)?\s?(?:million|billion|thousand|hours|days|weeks|months|users|customers|clients|subscribers|leads|orders|units)\b/i,
    question: (match) =>
      `Where does “${match.trim().replace(/[.,;:]+$/, "")}” come from — which system or report, and for what period?`,
    why: "A figure the author cannot trace is the first thing a careful reader checks.",
  },
  {
    kind: "facts",
    pattern:
      /\b(?:studies|research|surveys?|reports?|analysts|experts|benchmarks?)\b[^.]{0,40}\b(?:shows?|showed|suggests?|found|finds|confirms?|says?|indicates?)\b|\baccording to\b|\bindustry (?:average|standard|benchmark)s?\b|\bit is (?:well )?known\b/i,
    question: () => "Which source says this — who published it, and when?",
    why: "A study or benchmark with no name is the classic mark of a draft nobody checked.",
  },
  {
    kind: "logic",
    pattern:
      /\b(?:because|due to|as a result|led to|leads to|resulted in|results in|thanks to|driven by|caused|which means|therefore|proves?|since)\b/i,
    question: () => "What is the evidence for this reason — and what else could explain it?",
    why: "A stated cause is a claim of its own, and the reader will test it.",
  },
  {
    kind: "risk",
    pattern:
      /\b(?:always|never|guarantee[sd]?|certainly|definitely|no risk|risk-free|without (?:any )?risk|nobody|everyone|will (?:increase|reduce|grow|save|deliver|double|triple|cut|eliminate)|ensures?|eliminates?)\b|\b100\s?%/i,
    question: () => "What would have to go wrong for this not to hold — and what happens then?",
    why: "An absolute claim becomes your promise the moment you send it.",
  },
  {
    kind: "audience",
    pattern: /\b(?:recommend(?:ation|s|ed)?|propose[sd]?|should|need to|asking for|approve|next steps?|we plan to)\b/i,
    question: () => "Why this option and not the alternatives — what did you rule out, and why?",
    why: "The reader has to decide, and a decision needs the options that were rejected.",
  },
  {
    kind: "numbers",
    pattern: /\b(?:more|less|higher|lower|faster|slower|better|worse|above|below|grew|growth|improved?|increase[sd]?|decrease[sd]?|fell|rose)\b/i,
    question: () => "Compared with what — which baseline, and over which period?",
    why: "A comparison means nothing until the reader knows what it is compared with.",
  },
];

const FALLBACK: Pick<QuestionDraft, "kind" | "question" | "why"> = {
  kind: "facts",
  question: "What is the evidence for this line — where could your reader check it?",
  why: "Anything you state as fact, you may be asked to show.",
};

/**
 * Write the questions without a model: find the lines that carry a figure, an unnamed
 * source, a claimed cause, an absolute promise or a recommendation, and ask what a
 * careful reader would ask about each. One line gets one question; kinds are spread
 * before any kind repeats.
 */
export function heuristicQuestions(text: string, limit = REHEARSAL_QUESTIONS): RehearsalQuestion[] {
  const lines = sentences(text);
  const used = new Set<number>();
  const drafts: QuestionDraft[] = [];

  // Round by round: each probe takes its next unused line, so the kinds stay mixed.
  for (let round = 0; round < limit && drafts.length < limit; round++) {
    const before = drafts.length;
    for (const probe of PROBES) {
      if (drafts.length >= limit) break;
      const index = lines.findIndex((line, i) => !used.has(i) && probe.pattern.test(line));
      if (index === -1) continue;
      used.add(index);
      const line = lines[index]!;
      drafts.push({ kind: probe.kind, quote: line, question: probe.question(probe.pattern.exec(line)![0]), why: probe.why });
    }
    if (drafts.length === before) break;
  }

  // A plain document still gets questions: the longest lines carry the most claims.
  const rest = lines
    .map((line, index) => ({ line, index }))
    .filter(({ index }) => !used.has(index))
    .sort((a, b) => b.line.length - a.line.length);
  for (const { line } of rest) {
    if (drafts.length >= limit) break;
    drafts.push({ ...FALLBACK, quote: line });
  }
  if (drafts.length === 0) {
    drafts.push({ ...FALLBACK, quote: text.replace(/\s+/g, " ").trim().slice(0, QUOTE_MAX) });
  }

  // In the order the lines appear, so the rehearsal reads top to bottom.
  const position = (draft: QuestionDraft) => normalize(text).indexOf(normalize(draft.quote));
  return withIds([...drafts].sort((a, b) => position(a) - position(b)));
}

/**
 * The check a model's questions must pass: each one has to quote a line that is in
 * the document, and no line is questioned twice. Returns the questions that pass,
 * topped up to `limit` by the rule-based writer, or `null` when too few passed for
 * the set to be trusted.
 */
export function groundQuestions(
  text: string,
  drafts: ReadonlyArray<QuestionDraft>,
  limit = REHEARSAL_QUESTIONS,
): RehearsalQuestion[] | null {
  const seen = new Set<string>();
  const grounded = drafts.filter((draft) => {
    const key = normalize(draft.quote);
    if (seen.has(key) || !isGrounded(text, draft.quote)) return false;
    seen.add(key);
    return true;
  });
  if (grounded.length < Math.min(MIN_GROUNDED_QUESTIONS, limit)) return null;

  const kept: QuestionDraft[] = grounded.slice(0, limit).map((draft) => ({
    kind: draft.kind,
    quote: clip(draft.quote.trim(), QUOTE_MAX, ""),
    question: clip(draft.question.trim(), QUESTION_MAX, "…"),
    why: clip(draft.why.trim(), QUESTION_MAX, "…"),
  }));
  for (const extra of heuristicQuestions(text, limit)) {
    if (kept.length >= limit) break;
    if (!seen.has(normalize(extra.quote))) kept.push(extra);
  }
  return withIds(kept);
}

const NO_ANSWER = /^(?:i\s+)?(?:do not|don'?t|dont)\s+know\b|^not sure\b|^no idea\b|^n\/?a\b|^idk\b|^\?+$/i;
const EVIDENCE =
  /\d|\b(?:report|dashboard|source|export|invoice|contract|survey|study|dataset|crm|analytics|spreadsheet|sheet|appendix|link|https?|published|calculated|measured|formula|baseline|sample|period|quarter|assum\w+|compared|control group|a\/b test)\b/i;

const ANSWER_SHORT = 20;
const ANSWER_SPECIFIC = 60;

const PARTIAL_NOTE: Readonly<Record<ErrorType, string>> = {
  numbers: "Name the system or report the figure comes from, and the period it covers.",
  facts: "Name the source — who published it and when — or take the claim out.",
  logic: "Say what else could explain it, and why you ruled that out.",
  risk: "State the condition under which this fails, and what you would do then.",
  audience: "Say which alternatives you considered and why you rejected them.",
};

/**
 * Score one answer without a model. It can only judge the form of an answer — whether
 * there is one, and whether it gives the reader something to check — never its truth.
 */
export function heuristicVerdict(question: Pick<RehearsalQuestion, "id" | "kind">, answer: string): AnswerVerdict {
  const text = answer.replace(/\s+/g, " ").trim();
  if (text.length < ANSWER_SHORT || NO_ANSWER.test(text)) {
    return { id: question.id, verdict: "open", note: "No answer yet. Find this out — or take the line out — before you send." };
  }
  if (text.length >= ANSWER_SPECIFIC && EVIDENCE.test(text)) {
    return { id: question.id, verdict: "holds", note: "Specific enough to check. Keep the source at hand when you send." };
  }
  return { id: question.id, verdict: "partial", note: PARTIAL_NOTE[question.kind] };
}
