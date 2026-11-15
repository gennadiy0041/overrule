import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ERROR_TYPE_INFO } from "../../engine/drillSchema";
import {
  ANSWER_MAX,
  REHEARSAL_TEXT_MAX,
  REHEARSAL_TEXT_MIN,
  type AnswerVerdict,
  type RehearsalQuestion,
  type Verdict,
} from "../../engine/rehearsal";
import type {
  DefendStatus,
  RehearsalGradeResponse,
  RehearsalReader,
  RehearsalResponse,
} from "../../shared/api";
import { api, ApiClientError, track, useApi } from "../lib/api";
import { Button, ButtonLink, Card, Chip, cx, Eyebrow, PageError, PageLoading, Shell, Spinner } from "../ui";

const READERS: ReadonlyArray<{ id: RehearsalReader; label: string; noun: string }> = [
  { id: "manager", label: "My manager", noun: "your manager" },
  { id: "client", label: "A client", noun: "your client" },
  { id: "leadership", label: "Leadership", noun: "leadership" },
];

/** A made-up report to try the rehearsal with; the company and every figure are fictional. */
const SAMPLE = `Q3 email program — summary for leadership (Calder & Pine Outfitters)

Revenue from email grew 38% quarter over quarter, to $412,000, because we switched to AI-written subject lines in July. Open rate reached 31%, well above the industry average of 21%. Studies show that personalized subject lines always lift conversion. The number of unsubscribes fell by 1,200.

Recommendation: move the remaining $60,000 of the paid social budget into email in Q4. This will double email revenue by December with no risk to acquisition. We should also retire the weekly digest, since nobody reads it.`;

const VERDICT: Readonly<Record<Verdict, { label: string; className: string }>> = {
  holds: { label: "Holds", className: "bg-caught-soft text-caught-deep" },
  partial: { label: "Needs more", className: "bg-partial-soft text-partial-deep" },
  open: { label: "Open", className: "bg-overrule-soft text-overrule-deep" },
};

const FIELD =
  "w-full rounded-xl border border-line-strong bg-card px-4 py-3 text-base leading-relaxed placeholder:text-ink-3 focus:border-ink focus:outline-none";

type Stage =
  | { name: "compose" }
  | { name: "writing" }
  | { name: "answering"; rehearsal: RehearsalResponse }
  | { name: "scoring"; rehearsal: RehearsalResponse }
  | { name: "result"; rehearsal: RehearsalResponse; grade: RehearsalGradeResponse };

function price(status: DefendStatus): string {
  return `$${status.pack.price.toFixed(2)}`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The pack, sold apart from the subscription. Demo checkout: no payment is collected. */
function PackCard({ status, onBought }: { status: DefendStatus; onBought: (next: DefendStatus) => void }) {
  const [state, setState] = useState<"idle" | "pending" | "failed">("idle");

  async function buy() {
    setState("pending");
    try {
      onBought(await api.post<DefendStatus>("/api/defend/pack"));
      setState("idle");
    } catch {
      setState("failed");
    }
  }

  return (
    <Card className="mt-6 px-5 py-5 sm:px-6">
      <Eyebrow>Rehearsal pack</Eyebrow>
      <p className="mt-2 font-serif text-3xl">
        {status.pack.size} rehearsals · {price(status)}
      </p>
      <p className="mt-2 text-ink-2">
        About a dollar a rehearsal. No subscription needed, and the rehearsals don’t expire.
      </p>
      {state === "failed" && (
        <p className="mt-3 text-overrule-deep" role="alert">
          That didn’t go through. Check your connection and try again.
        </p>
      )}
      <Button size="lg" full className="mt-5" onClick={buy} disabled={state === "pending"}>
        {state === "pending" ? "Adding…" : `Get ${status.pack.size} rehearsals — ${price(status)}`}
      </Button>
      <p className="mt-3 text-sm text-ink-3">Demo checkout — no payment is collected in this hackathon build.</p>
    </Card>
  );
}

function Compose({
  status,
  text,
  reader,
  error,
  onText,
  onReader,
  onSubmit,
  onStatus,
}: {
  status: DefendStatus;
  text: string;
  reader: RehearsalReader;
  error: string | null;
  onText: (value: string) => void;
  onReader: (value: RehearsalReader) => void;
  onSubmit: () => void;
  onStatus: (next: DefendStatus) => void;
}) {
  const length = text.trim().length;
  const ready = length >= REHEARSAL_TEXT_MIN && length <= REHEARSAL_TEXT_MAX;

  return (
    <div className="animate-rise pt-4 pb-10">
      <Eyebrow>Defend your work</Eyebrow>
      <h1 className="mt-3 text-4xl sm:text-5xl">Rehearse the hard questions before you hit send.</h1>
      <p className="mt-4 text-lg leading-relaxed text-ink-2">
        Paste the report, email or slide text you are about to send. You get the five questions a skeptical reader will
        ask — each one pointing at a line in your own text — and a verdict on every answer.
      </p>

      <label htmlFor="defend-text" className="mt-8 block font-medium">
        Your text
      </label>
      <textarea
        id="defend-text"
        className={cx(FIELD, "mt-2 min-h-56")}
        value={text}
        maxLength={REHEARSAL_TEXT_MAX}
        onChange={(event) => onText(event.target.value)}
        placeholder="Paste the text here. A paragraph or two is enough."
      />
      <div className="mt-1.5 flex items-center justify-between gap-4 text-sm text-ink-3">
        <button type="button" onClick={() => onText(SAMPLE)} className="min-h-11 underline underline-offset-4 hover:text-ink">
          Use a sample report
        </button>
        <span className="tabular">
          {length < REHEARSAL_TEXT_MIN
            ? `${length} of at least ${REHEARSAL_TEXT_MIN} characters`
            : `${length.toLocaleString("en-US")} / ${REHEARSAL_TEXT_MAX.toLocaleString("en-US")}`}
        </span>
      </div>

      <p className="mt-5 font-medium">Who will read it?</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {READERS.map((option) => (
          <Chip key={option.id} selected={reader === option.id} onClick={() => onReader(option.id)}>
            {option.label}
          </Chip>
        ))}
      </div>

      {error && (
        <p className="mt-5 text-overrule-deep" role="alert">
          {error}
        </p>
      )}

      {status.remaining > 0 ? (
        <>
          <Button size="lg" full className="mt-7" onClick={onSubmit} disabled={!ready}>
            Find the hard questions
          </Button>
          <p className="mt-3 text-sm text-ink-3">
            {status.freeAvailable ? "Your first rehearsal is free." : `${plural(status.remaining, "rehearsal")} left.`}{" "}
            After that: {status.pack.size} rehearsals for {price(status)}.
          </p>
        </>
      ) : (
        <PackCard status={status} onBought={onStatus} />
      )}

      <p className="mt-6 text-sm leading-relaxed text-ink-3">
        Overrule does not store your text, the questions or your answers. The text is used once to write the questions;
        when a model writes them, it is sent to the Claude API for that call.
      </p>
    </div>
  );
}

function QuestionCard({
  index,
  question,
  children,
}: {
  index: number;
  question: RehearsalQuestion;
  children: React.ReactNode;
}) {
  return (
    <Card className="px-5 py-5 sm:px-6">
      <p className="eyebrow">
        Question {index + 1} · {ERROR_TYPE_INFO[question.kind].label}
      </p>
      <blockquote className="mt-3 border-l-2 border-line-strong pl-3 text-ink-2">“{question.quote}”</blockquote>
      <p className="mt-3 text-lg font-medium leading-snug">{question.question}</p>
      {children}
    </Card>
  );
}

function Answering({
  rehearsal,
  reader,
  answers,
  busy,
  error,
  onAnswer,
  onSubmit,
}: {
  rehearsal: RehearsalResponse;
  reader: RehearsalReader;
  answers: Readonly<Record<string, string>>;
  busy: boolean;
  error: string | null;
  onAnswer: (id: string, value: string) => void;
  onSubmit: () => void;
}) {
  const noun = READERS.find((option) => option.id === reader)?.noun ?? "your reader";
  return (
    <div className="animate-rise pt-4 pb-10">
      <Eyebrow>Rehearsal</Eyebrow>
      <h1 className="mt-3 text-4xl">
        {plural(rehearsal.questions.length, "question")} {noun} will ask.
      </h1>
      <p className="mt-3 text-ink-2">
        Answer the way you would in the meeting. Leave a question blank if you can’t answer it yet — finding that out
        now is the point.
      </p>

      <div className="mt-6 grid gap-4">
        {rehearsal.questions.map((question, index) => (
          <QuestionCard key={question.id} index={index} question={question}>
            <p className="mt-1.5 text-sm text-ink-3">Why they ask: {question.why}</p>
            <label htmlFor={`answer-${question.id}`} className="sr-only">
              Your answer to question {index + 1}
            </label>
            <textarea
              id={`answer-${question.id}`}
              className={cx(FIELD, "mt-4 min-h-24")}
              value={answers[question.id] ?? ""}
              maxLength={ANSWER_MAX}
              onChange={(event) => onAnswer(question.id, event.target.value)}
              placeholder="Your answer"
            />
          </QuestionCard>
        ))}
      </div>

      {error && (
        <p className="mt-5 text-overrule-deep" role="alert">
          {error}
        </p>
      )}
      <Button size="lg" full className="mt-6" onClick={onSubmit} disabled={busy}>
        {busy ? "Scoring…" : "Score my answers"}
      </Button>
      <p className="mt-3 text-sm text-ink-3">
        {rehearsal.writtenBy === "llm"
          ? "A model wrote these questions; each one was checked to quote a line of your text."
          : "These questions were written by Overrule’s rule-based reader; no model was used this time."}
      </p>
    </div>
  );
}

function Result({
  rehearsal,
  grade,
  answers,
  status,
  onAgain,
}: {
  rehearsal: RehearsalResponse;
  grade: RehearsalGradeResponse;
  answers: Readonly<Record<string, string>>;
  status: DefendStatus;
  onAgain: () => void;
}) {
  const verdicts = new Map<string, AnswerVerdict>(grade.results.map((result) => [result.id, result]));
  const ready = grade.held === grade.total;
  return (
    <div className="animate-rise pt-4 pb-10">
      <Eyebrow>Result</Eyebrow>
      <h1 className="mt-3 text-4xl sm:text-5xl">
        {grade.held} of {plural(grade.total, "answer")} {grade.held === 1 ? "holds" : "hold"}.
      </h1>
      <p className="mt-3 text-lg text-ink-2">
        {ready
          ? "You are ready to send. Keep your sources at hand."
          : "Close the open ones — or take those lines out — before you send."}
      </p>

      <div className="mt-6 grid gap-4">
        {rehearsal.questions.map((question, index) => {
          const verdict = verdicts.get(question.id);
          const answer = answers[question.id]?.trim();
          return (
            <QuestionCard key={question.id} index={index} question={question}>
              <p className="mt-3 text-ink-2">{answer ? `You: ${answer}` : "You left this one blank."}</p>
              {verdict && (
                <p className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className={cx("rounded-full px-2.5 py-0.5 text-sm font-medium", VERDICT[verdict.verdict].className)}>
                    {VERDICT[verdict.verdict].label}
                  </span>
                  <span>{verdict.note}</span>
                </p>
              )}
            </QuestionCard>
          );
        })}
      </div>

      <p className="mt-5 text-sm text-ink-3">
        {grade.gradedBy === "llm"
          ? "A model judged how specific and checkable each answer is. It cannot verify that an answer is true."
          : "Scored by rules: whether there is an answer, and whether it gives the reader something to check."}
      </p>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Button size="lg" onClick={onAgain} className="w-full sm:w-auto">
          Rehearse another document
        </Button>
        <ButtonLink to="/dashboard" variant="outline" size="lg" className="w-full sm:w-auto">
          Back to my dashboard
        </ButtonLink>
      </div>
      <p className="mt-3 text-sm text-ink-3">
        {status.remaining > 0
          ? `${plural(status.remaining, "rehearsal")} left.`
          : `No rehearsals left. The next ${status.pack.size} are ${price(status)}.`}
      </p>
    </div>
  );
}

/**
 * "Defend your work": paste a document you are about to send, get the questions a
 * skeptical reader will ask about your own lines, answer them, and see which answers hold.
 */
export default function Defend() {
  const { data: loaded, error: loadError, loading, reload } = useApi<DefendStatus>("/api/defend");
  const [status, setStatus] = useState<DefendStatus | undefined>(undefined);
  const [stage, setStage] = useState<Stage>({ name: "compose" });
  const [text, setText] = useState("");
  const [reader, setReader] = useState<RehearsalReader>("manager");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    track("defend_view");
  }, []);
  useEffect(() => {
    if (loaded) setStatus(loaded);
  }, [loaded]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [stage.name]);

  async function start() {
    setError(null);
    setStage({ name: "writing" });
    try {
      const rehearsal = await api.post<RehearsalResponse>("/api/defend/rehearsals", { text, reader });
      setStatus(rehearsal.status);
      setAnswers({});
      setStage({ name: "answering", rehearsal });
    } catch (cause) {
      const code = cause instanceof ApiClientError ? cause.code : "network_error";
      if (code === "pack_required") reload();
      setError(
        code === "pack_required"
          ? "You have used your rehearsals. Get a pack to continue."
          : code === "invalid_request"
            ? `The text needs to be between ${REHEARSAL_TEXT_MIN} and ${REHEARSAL_TEXT_MAX.toLocaleString("en-US")} characters.`
            : "That didn’t go through. Check your connection and try again.",
      );
      setStage({ name: "compose" });
    }
  }

  async function score(rehearsal: RehearsalResponse) {
    setError(null);
    setStage({ name: "scoring", rehearsal });
    try {
      const grade = await api.post<RehearsalGradeResponse>(`/api/defend/rehearsals/${rehearsal.id}/grade`, {
        items: rehearsal.questions.map((question) => ({
          id: question.id,
          kind: question.kind,
          quote: question.quote,
          question: question.question,
          answer: answers[question.id] ?? "",
        })),
      });
      setStage({ name: "result", rehearsal, grade });
    } catch {
      setError("That didn’t go through. Check your connection and try again.");
      setStage({ name: "answering", rehearsal });
    }
  }

  function again() {
    setText("");
    setAnswers({});
    setError(null);
    setStage({ name: "compose" });
  }

  const headerRight = (
    <Link to="/dashboard" className="underline-offset-4 hover:underline">
      Dashboard
    </Link>
  );

  if (loadError) return <Shell headerRight={headerRight}><PageError retry={reload} /></Shell>;
  if (loading || !status) return <Shell headerRight={headerRight}><PageLoading /></Shell>;

  return (
    <Shell headerRight={headerRight}>
      {stage.name === "compose" && (
        <Compose
          status={status}
          text={text}
          reader={reader}
          error={error}
          onText={setText}
          onReader={setReader}
          onSubmit={start}
          onStatus={(next) => {
            setStatus(next);
            setError(null);
          }}
        />
      )}
      {stage.name === "writing" && (
        <div className="flex min-h-[50dvh] flex-col items-center justify-center gap-4 text-center" aria-live="polite">
          <Spinner />
          <p className="text-lg">Reading your text and writing the questions…</p>
          <p className="text-sm text-ink-3">Usually under twenty seconds.</p>
        </div>
      )}
      {(stage.name === "answering" || stage.name === "scoring") && (
        <Answering
          rehearsal={stage.rehearsal}
          reader={reader}
          answers={answers}
          busy={stage.name === "scoring"}
          error={error}
          onAnswer={(id, value) => setAnswers((previous) => ({ ...previous, [id]: value }))}
          onSubmit={() => score(stage.rehearsal)}
        />
      )}
      {stage.name === "result" && (
        <Result rehearsal={stage.rehearsal} grade={stage.grade} answers={answers} status={status} onAgain={again} />
      )}
    </Shell>
  );
}
