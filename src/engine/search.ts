/**
 * Occupation search: lands a job title as people actually type it ("growth marketer",
 * "hr generalist", "PM") on one of the 923 O*NET occupations.
 *
 * Each occupation is reachable through three vocabularies, in descending order of trust:
 *   official   — the O*NET-SOC title, "Marketing Managers"
 *   modern     — a short hand-written dictionary of current titles, "growth marketer"
 *   alternate  — ~48k O*NET alternate titles, "Brand Manager"
 *
 * Ranking is a ladder of tiers rather than one blended relevance number, so every
 * position in the list can be explained in a sentence:
 *
 *   exact official > exact modern > exact alternate
 *     > official starts with the query > every query word starts a word of the official title
 *     > modern (either of the two) > alternate (either of the two)
 *     > closest guess
 *
 * The last tier forgives typos and unknown words. It only runs when the literal tiers
 * found fewer than three occupations, and only against official and modern titles: the
 * alternates are numerous enough that something is always one typo away from them.
 */

export interface SearchSource {
  occupations: ReadonlyArray<{ soc: string; title: string }>;
  altTitles: Readonly<Record<string, ReadonlyArray<string>>>;
  modernTitles: ReadonlyArray<{ title: string; soc: string }>;
}

export interface SearchHit {
  soc: string;
  /** The alternate/modern title that matched, when the match was not on the official title. */
  matchedTitle?: string;
  /** True when nothing matched literally and this is a fuzzy best guess — the UI labels it "closest match". */
  closest: boolean;
  /** Tier plus closeness within the tier. Higher is better; only comparable within one result list. */
  score: number;
}

type TitleKind = "official" | "modern" | "alternate";
type LiteralMatch = "exact" | "prefix" | "words";

interface IndexedOccupation {
  readonly soc: string;
  /** Normalised official title, padded like every indexed title. */
  readonly official: string;
}

interface IndexedTitle {
  readonly occupation: IndexedOccupation;
  readonly kind: TitleKind;
  /** The title as the source spells it. */
  readonly display: string;
  /** Normalised words, each preceded by a space, so `" " + word` finds a word-prefix with one `includes`. */
  readonly padded: string;
}

interface WordPostings {
  readonly word: string;
  readonly titles: ReadonlyArray<IndexedTitle>;
}

/** Built once at startup. Opaque to callers: hand it to `searchOccupations` and nothing else. */
export interface SearchIndex {
  /** Every distinct word of every title, in alphabetical order, with the titles that contain it. */
  readonly words: ReadonlyArray<WordPostings>;
  /** The same for official and modern titles only — all the closest-guess tier compares against. */
  readonly trustedWords: ReadonlyArray<WordPostings>;
}

interface Query {
  readonly words: ReadonlyArray<string>;
  /** The whole query, padded like an indexed title. */
  readonly padded: string;
  /** One padded needle per word. */
  readonly needles: ReadonlyArray<string>;
}

interface Candidate {
  readonly title: IndexedTitle;
  readonly closest: boolean;
  readonly score: number;
}

const DEFAULT_LIMIT = 8;
const MAX_QUERY_LENGTH = 80;
/** One letter matches a third of the index and says nothing about the job. */
const MIN_QUERY_LENGTH = 2;
/** Below this many literal hits the list looks empty, so closest guesses fill it up. */
const ENOUGH_LITERAL_HITS = 3;
/** A closest guess has to account for at least this share of the letters typed. */
const MIN_GUESS_SIMILARITY = 0.4;

/** The ranking ladder. Within a tier the title the query covers most of (the shortest) wins. */
const LITERAL_TIER: Readonly<Record<TitleKind, Readonly<Record<LiteralMatch, number>>>> = {
  official: { exact: 7, prefix: 4, words: 3 },
  modern: { exact: 6, prefix: 2, words: 2 },
  alternate: { exact: 5, prefix: 1, words: 1 },
};
const KIND_ORDER: Readonly<Record<TitleKind, number>> = { official: 0, modern: 1, alternate: 2 };

/**
 * Spelled out in queries only. In a title the same letters can mean something else
 * ("PM Coordinator" is preventive maintenance, "CSR" a certified shorthand reporter),
 * and O*NET already lists the long form next to every short one.
 */
const ABBREVIATIONS: ReadonlyMap<string, string> = new Map([
  ["hr", "human resources"],
  ["pm", "project manager"],
  ["csr", "customer service representative"],
  ["cpa", "accountant"],
  ["qa", "quality assurance"],
  ["swe", "software engineer"],
  ["ux", "user experience"],
]);

/** O*NET writes "Long Form (Short Form)": two spellings of one title, each searchable on its own. */
const TRAILING_PARENTHESES = /^(.+?)\s*\((.+)\)$/;

/** Lower-case words with diacritics, apostrophes and punctuation removed. */
function splitWords(text: string): string[] {
  const plain = text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\p{M}/gu, "")
    .replace(/['’]/g, "")
    .replace(/&/g, " and ");
  return plain.match(/[a-z0-9]+/g) ?? [];
}

/**
 * Light singularisation, so "managers" meets "manager" and "secretaries" meets "secretary".
 * Deliberately not a stemmer: it only has to be applied identically to titles and queries,
 * and a real stemmer would merge titles that differ ("analyst" / "analysis").
 */
function singularise(word: string): string {
  if (word.length < 4) return word; // "gas", "bus", "ops"
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  return /[^siu]s$/.test(word) ? word.slice(0, -1) : word; // not "business", "analysis", "campus"
}

function normalise(text: string): string[] {
  return splitWords(text).map(singularise);
}

function pad(words: ReadonlyArray<string>): string {
  return words.map((word) => ` ${word}`).join("");
}

function spellings(title: string): string[] {
  const match = TRAILING_PARENTHESES.exec(title);
  return match ? [match[1]!, match[2]!] : [title];
}

function postings(titles: ReadonlyArray<IndexedTitle>): WordPostings[] {
  const byWord = new Map<string, IndexedTitle[]>();
  for (const title of titles) {
    for (const word of new Set(title.padded.trim().split(" "))) {
      const list = byWord.get(word);
      if (list) list.push(title);
      else byWord.set(word, [title]);
    }
  }
  return [...byWord]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([word, list]) => ({ word, titles: list }));
}

export function buildSearchIndex(source: SearchSource): SearchIndex {
  const titles: IndexedTitle[] = [];
  const occupations = new Map<string, IndexedOccupation>();
  const seen = new Set<string>();

  /** Skips spellings an occupation already has: the earlier, more trusted copy always outranks them. */
  const add = (occupation: IndexedOccupation, kind: TitleKind, display: string): void => {
    for (const spelling of spellings(display)) {
      const padded = pad(normalise(spelling));
      const key = `${occupation.soc}${padded}`;
      if (padded === "" || seen.has(key)) continue;
      seen.add(key);
      titles.push({ occupation, kind, display, padded });
    }
  };

  for (const { soc, title } of source.occupations) {
    const occupation = { soc, official: pad(normalise(title)) };
    occupations.set(soc, occupation);
    add(occupation, "official", title);
  }
  // A title that points at an occupation we do not have would produce a hit nobody can open.
  for (const { soc, title } of source.modernTitles) {
    const occupation = occupations.get(soc);
    if (occupation) add(occupation, "modern", title);
  }
  for (const [soc, alternates] of Object.entries(source.altTitles)) {
    const occupation = occupations.get(soc);
    if (occupation) for (const title of alternates) add(occupation, "alternate", title);
  }

  return {
    words: postings(titles),
    trustedWords: postings(titles.filter((title) => title.kind !== "alternate")),
  };
}

function parseQuery(raw: string): Query | null {
  const words = splitWords(raw.slice(0, MAX_QUERY_LENGTH))
    .flatMap((word) => ABBREVIATIONS.get(word)?.split(" ") ?? [word])
    .map(singularise);
  const padded = pad(words);
  if (padded.length <= MIN_QUERY_LENGTH) return null;
  return { words, padded, needles: words.map((word) => ` ${word}`) };
}

/** Titles containing a word that starts with `prefix`: binary search for the first such word, then walk. */
function* titlesWithWord(words: ReadonlyArray<WordPostings>, prefix: string): Generator<IndexedTitle> {
  let low = 0;
  let high = words.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (words[middle]!.word < prefix) low = middle + 1;
    else high = middle;
  }
  for (let i = low; i < words.length && words[i]!.word.startsWith(prefix); i++) yield* words[i]!.titles;
}

function literalMatch(padded: string, query: Query): LiteralMatch | null {
  for (const needle of query.needles) if (!padded.includes(needle)) return null;
  if (!padded.startsWith(query.padded)) return "words";
  return padded.length === query.padded.length ? "exact" : "prefix";
}

/** How many edits a typed word is forgiven: none below 4 letters, one up to 7, two beyond. */
function editBudget(typed: string): number {
  if (typed.length < 4) return 0;
  return typed.length <= 7 ? 1 : 2;
}

/**
 * Fewest edits (insert, delete, substitute, swap two neighbours) that turn `typed` into
 * some prefix of `word`. Prefixes rather than the whole word because the user may still be
 * typing: "acount" is one edit away from the start of "accountant". Returns Infinity as
 * soon as no prefix can stay within `budget`.
 */
function prefixEditDistance(typed: string, word: string, budget: number): number {
  // A prefix longer than this is over budget on length alone.
  const width = Math.min(word.length, typed.length + budget);
  let twoRowsUp: number[] = [];
  let rowUp: number[] = [];
  for (let column = 0; column <= width; column++) rowUp.push(column);
  let best = 0;
  for (let row = 1; row <= typed.length; row++) {
    const current = [row];
    const letter = typed.charCodeAt(row - 1);
    best = row;
    for (let column = 1; column <= width; column++) {
      const other = word.charCodeAt(column - 1);
      let edits = Math.min(rowUp[column - 1]! + (letter === other ? 0 : 1), rowUp[column]! + 1, current[column - 1]! + 1);
      const swapped = row > 1 && column > 1 && letter === word.charCodeAt(column - 2) && typed.charCodeAt(row - 2) === other;
      if (swapped) edits = Math.min(edits, twoRowsUp[column - 2]! + 1);
      current.push(edits);
      best = Math.min(best, edits);
    }
    if (best > budget) return Infinity;
    twoRowsUp = rowUp;
    rowUp = current;
  }
  return best;
}

/** 1 when `word` starts with what was typed, less when it only does so after a typo, 0 when it does not. */
function wordCloseness(typed: string, word: string): number {
  if (word.startsWith(typed)) return 1;
  const budget = editBudget(typed);
  if (budget === 0 || word.charCodeAt(0) !== typed.charCodeAt(0)) return 0;
  const edits = prefixEditDistance(typed, word, budget);
  return edits > budget ? 0 : 1 - edits / typed.length;
}

/** For one typed word: every title holding a word close to it, with the closeness of the closest. */
function titlesNear(words: ReadonlyArray<WordPostings>, typed: string): Map<IndexedTitle, number> {
  const near = new Map<IndexedTitle, number>();
  for (const { word, titles } of words) {
    const closeness = wordCloseness(typed, word);
    if (closeness === 0) continue;
    for (const title of titles) near.set(title, Math.max(near.get(title) ?? 0, closeness));
  }
  return near;
}

/** Share of the typed letters each title accounts for, every typed word judged by its closest word in the title. */
function guessSimilarities(words: ReadonlyArray<WordPostings>, query: Query): Map<IndexedTitle, number> {
  const typedLetters = query.words.reduce((sum, word) => sum + word.length, 0);
  const similarities = new Map<IndexedTitle, number>();
  for (const typed of query.words) {
    for (const [title, closeness] of titlesNear(words, typed)) {
      similarities.set(title, (similarities.get(title) ?? 0) + (closeness * typed.length) / typedLetters);
    }
  }
  return similarities;
}

/** Share of the official title the query's words spell out — which of two tied occupations is more on topic. */
function officialOverlap(occupation: IndexedOccupation, query: Query): number {
  let letters = 0;
  for (const needle of query.needles) if (occupation.official.includes(needle)) letters += needle.length;
  return letters / occupation.official.length;
}

function compareCandidates(a: Candidate, b: Candidate, query: Query): number {
  return (
    b.score - a.score ||
    a.title.padded.length - b.title.padded.length ||
    KIND_ORDER[a.title.kind] - KIND_ORDER[b.title.kind] ||
    officialOverlap(b.title.occupation, query) - officialOverlap(a.title.occupation, query) ||
    (a.title.occupation.soc < b.title.occupation.soc ? -1 : 1)
  );
}

function toHit({ title, closest, score }: Candidate): SearchHit {
  const hit: SearchHit = { soc: title.occupation.soc, closest, score };
  if (title.kind !== "official") hit.matchedTitle = title.display;
  return hit;
}

export function searchOccupations(index: SearchIndex, query: string, limit = DEFAULT_LIMIT): SearchHit[] {
  const parsed = parseQuery(query);
  if (parsed === null) return [];
  const best = new Map<IndexedOccupation, Candidate>();
  const offer = (candidate: Candidate): void => {
    const current = best.get(candidate.title.occupation);
    if (!current || compareCandidates(candidate, current, parsed) < 0) best.set(candidate.title.occupation, candidate);
  };

  // Only titles holding the query's longest word can match, and its posting lists are the shortest to walk.
  const anchor = parsed.words.reduce((longest, word) => (word.length > longest.length ? word : longest));
  for (const title of titlesWithWord(index.words, anchor)) {
    const match = literalMatch(title.padded, parsed);
    if (match === null) continue;
    const coverage = parsed.padded.length / title.padded.length;
    offer({ title, closest: false, score: LITERAL_TIER[title.kind][match] + coverage });
  }

  if (best.size < ENOUGH_LITERAL_HITS) {
    for (const [title, similarity] of guessSimilarities(index.trustedWords, parsed)) {
      if (similarity >= MIN_GUESS_SIMILARITY) offer({ title, closest: true, score: similarity });
    }
  }

  return [...best.values()]
    .sort((a, b) => compareCandidates(a, b, parsed))
    .slice(0, Math.max(0, limit))
    .map(toHit);
}
