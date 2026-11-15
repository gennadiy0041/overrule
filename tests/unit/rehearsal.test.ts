/** The rule-based half of "Defend your work": grounding, the fallback question writer, the fallback scorer. */
import { describe, expect, test } from "bun:test";
import {
  groundQuestions,
  heuristicQuestions,
  heuristicVerdict,
  isGrounded,
  QUESTION_MAX,
  QUOTE_MAX,
  REHEARSAL_QUESTIONS,
  type QuestionDraft,
} from "../../src/engine/rehearsal";

const REPORT = `Q3 email program — summary for leadership (Calder & Pine Outfitters)

Revenue from email grew 38% quarter over quarter, to $412,000, because we switched to AI-written subject lines in July. Open rate reached 31%, well above the industry average of 21%. Studies show that personalized subject lines always lift conversion. The number of unsubscribes fell by 1,200.

Recommendation: move the remaining $60,000 of the paid social budget into email in Q4. This will double email revenue by December with no risk to acquisition. We should also retire the weekly digest, since nobody reads it.`;

const draft = (quote: string, kind: QuestionDraft["kind"] = "facts"): QuestionDraft => ({
  kind,
  quote,
  question: "Which source says this?",
  why: "The reader will check it.",
});

describe("isGrounded", () => {
  test("accepts a line of the document whatever the spacing, case or typographic quotes", () => {
    expect(isGrounded(REPORT, "Open rate reached 31%, well above the industry average of 21%.")).toBe(true);
    expect(isGrounded(REPORT, "open rate   reached 31%,\nwell above the industry average")).toBe(true);
    expect(isGrounded("She said “ship it” — twice.", 'She said "ship it" - twice.')).toBe(true);
  });

  test("rejects a line that is not in the document, and a fragment too short to mean anything", () => {
    expect(isGrounded(REPORT, "Open rate reached 45%, well above the industry average.")).toBe(false);
    expect(isGrounded(REPORT, "email")).toBe(false);
  });
});

describe("heuristicQuestions", () => {
  const questions = heuristicQuestions(REPORT);

  test("asks five questions, each about a different line that is really in the document", () => {
    expect(questions).toHaveLength(REHEARSAL_QUESTIONS);
    expect(questions.map((q) => q.id)).toEqual(["q1", "q2", "q3", "q4", "q5"]);
    expect(new Set(questions.map((q) => q.quote)).size).toBe(REHEARSAL_QUESTIONS);
    for (const question of questions) {
      expect(isGrounded(REPORT, question.quote)).toBe(true);
      expect(question.quote.length).toBeLessThanOrEqual(QUOTE_MAX);
      expect(question.question.length).toBeLessThanOrEqual(QUESTION_MAX);
    }
  });

  test("covers the places an author is exposed: a figure, an unnamed source, a cause, a promise, a recommendation", () => {
    expect(new Set(questions.map((q) => q.kind))).toEqual(new Set(["numbers", "facts", "logic", "risk", "audience"]));
    const figure = questions.find((q) => q.kind === "numbers")!;
    expect(figure.question).toContain("“38%”");
    expect(questions.find((q) => q.kind === "facts")!.quote).toContain("industry average");
    expect(questions.find((q) => q.kind === "risk")!.quote).toContain("always");
    expect(questions.find((q) => q.kind === "audience")!.quote).toStartWith("Recommendation");
  });

  test("keeps the questions in the order of the document", () => {
    const flat = REPORT.replace(/\s+/g, " ");
    const positions = questions.map((q) => flat.indexOf(q.quote));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  test("a figure is quoted without the punctuation that followed it", () => {
    const [question] = heuristicQuestions("The pilot cost $412,000, which the finance team has already approved for this year.", 1);
    expect(question!.question).toContain("“$412,000”");
  });

  test("a plain text with nothing to probe still gets questions about its own lines", () => {
    const plain =
      "The team met on Tuesday in the main office. Everyone agreed the project is in good shape and on track. " +
      "The next meeting is planned for the following Tuesday in the same room, and notes go out afterwards.";
    const plainQuestions = heuristicQuestions(plain);
    expect(plainQuestions.length).toBeGreaterThanOrEqual(2);
    for (const question of plainQuestions) expect(isGrounded(plain, question.quote)).toBe(true);
  });

  test("a text with no sentence breaks is quoted from its start", () => {
    const blob = "alpha beta gamma delta ".repeat(20);
    const [only] = heuristicQuestions(blob);
    expect(only).toBeDefined();
    expect(isGrounded(blob, only!.quote)).toBe(true);
  });
});

describe("groundQuestions", () => {
  const real = [
    draft("Open rate reached 31%, well above the industry average of 21%."),
    draft("Studies show that personalized subject lines always lift conversion."),
    draft("This will double email revenue by December with no risk to acquisition.", "risk"),
  ];

  test("drops a question whose quote is not in the document and tops the set up by rule", () => {
    const questions = groundQuestions(REPORT, [...real, draft("Email revenue tripled in the Nordic market last year.")]);
    expect(questions).toHaveLength(REHEARSAL_QUESTIONS);
    expect(questions!.map((q) => q.quote)).not.toContain("Email revenue tripled in the Nordic market last year.");
    expect(new Set(questions!.map((q) => q.quote)).size).toBe(REHEARSAL_QUESTIONS);
    for (const question of questions!) expect(isGrounded(REPORT, question.quote)).toBe(true);
    // The model's grounded questions come first, in its order.
    expect(questions!.slice(0, 3).map((q) => q.quote)).toEqual(real.map((q) => q.quote));
  });

  test("rejects the whole set when fewer than three questions quote the document", () => {
    expect(groundQuestions(REPORT, [real[0]!, real[1]!, draft("An invented line that the author never wrote.")])).toBeNull();
  });

  test("never questions the same line twice", () => {
    const questions = groundQuestions(REPORT, [...real, real[0]!, real[1]!]);
    expect(new Set(questions!.map((q) => q.quote)).size).toBe(questions!.length);
  });

  test("clips over-long fields to the limits the API accepts", () => {
    const long = { ...real[0]!, question: "Why? ".repeat(120), why: "Because. ".repeat(80) };
    const [first] = groundQuestions(REPORT, [long, real[1]!, real[2]!])!;
    expect(first!.question.length).toBeLessThanOrEqual(QUESTION_MAX);
    expect(first!.question.endsWith("…")).toBe(true);
    expect(first!.why.length).toBeLessThanOrEqual(QUESTION_MAX);
  });
});

describe("heuristicVerdict", () => {
  const question = { id: "q1", kind: "numbers" as const };

  test("no answer, or an admission, is open", () => {
    expect(heuristicVerdict(question, "   ").verdict).toBe("open");
    expect(heuristicVerdict(question, "I don't know, the AI wrote that part of the report").verdict).toBe("open");
    expect(heuristicVerdict(question, "not sure").verdict).toBe("open");
  });

  test("an answer that names something the reader can check holds", () => {
    const verdict = heuristicVerdict(
      question,
      "It is from the Q3 revenue dashboard, email channel, July to September, exported on October 2.",
    );
    expect(verdict).toMatchObject({ id: "q1", verdict: "holds" });
  });

  test("an answer on the point but with nothing to check is partial, with advice for that kind of question", () => {
    expect(heuristicVerdict(question, "That is what the marketing team told me last week.")).toMatchObject({
      verdict: "partial",
      note: expect.stringContaining("system or report"),
    });
    expect(heuristicVerdict({ id: "q2", kind: "risk" }, "We believe it is very unlikely to go wrong at all.").note).toContain(
      "condition under which this fails",
    );
  });
});
