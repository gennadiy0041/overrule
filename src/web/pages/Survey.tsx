import { useState, type FormEvent } from "react";
import type { SurveyRequest } from "../../shared/api";
import { api } from "../lib/api";
import { Button, ButtonLink, cx, Eyebrow, Shell } from "../ui";

type Full = Extract<SurveyRequest, { kind: "full" }>;
type ChoiceKey = "inUs" | "age" | "aiWeekly" | "hadAiError" | "wouldPay";
type Answers = Partial<Pick<Full, ChoiceKey>>;

const QUESTIONS: ReadonlyArray<{ key: ChoiceKey; title: string; options: ReadonlyArray<[value: string, label: string]> }> = [
  { key: "inUs", title: "Do you live in the US?", options: [["yes", "Yes"], ["no", "No"]] },
  { key: "age", title: "Your age", options: [["25-34", "25–34"], ["35-45", "35–45"], ["other", "Other"]] },
  { key: "aiWeekly", title: "Do you use AI at work at least once a week?", options: [["yes", "Yes"], ["no", "No"]] },
  {
    key: "hadAiError",
    title: "Has an AI mistake ever ended up in your work?",
    options: [["yes", "Yes"], ["not_sure", "Not sure"], ["no", "No"]],
  },
  {
    key: "wouldPay",
    title: "Would you pay $8/month to train the skill of catching AI’s mistakes?",
    options: [["yes", "Yes"], ["maybe", "Maybe"], ["no", "No"]],
  },
];

function isComplete(answers: Answers): answers is Pick<Full, ChoiceKey> {
  return QUESTIONS.every((question) => answers[question.key] !== undefined);
}

/** A standalone one-minute survey for people arriving cold from a social post. */
export default function Survey() {
  const [answers, setAnswers] = useState<Answers>({});
  const [jobTitle, setJobTitle] = useState("");
  const [state, setState] = useState<"idle" | "pending" | "done" | "failed">("idle");
  const [showMissing, setShowMissing] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (state === "pending") return;
    if (!isComplete(answers)) {
      setShowMissing(true);
      return;
    }
    setState("pending");
    const title = jobTitle.trim();
    const body: Full = { kind: "full", ...answers, ...(title ? { jobTitle: title } : {}) };
    try {
      await api.post("/api/survey", body);
      setState("done");
    } catch {
      setState("failed");
    }
  }

  if (state === "done") {
    return (
      <Shell>
        <div className="flex min-h-[60dvh] animate-rise flex-col items-start justify-center gap-4">
          <h1 className="text-4xl">Thank you — that genuinely helps.</h1>
          <p className="text-lg text-ink-2">Curious how much of your own job AI can already draft?</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <ButtonLink to="/scan" size="lg">
              Scan my job — free
            </ButtonLink>
            <ButtonLink to="/demo" variant="outline" size="lg">
              Try today’s Daily Catch as a demo
            </ButtonLink>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <form onSubmit={submit} className="animate-rise pt-4 pb-10" noValidate>
        <Eyebrow>2-minute research survey</Eyebrow>
        <h1 className="mt-2 text-[2.25rem] leading-[1.08] sm:text-5xl">How do you handle AI’s mistakes at work?</h1>
        <p className="mt-3 text-lg text-ink-2">
          Six quick questions. Anonymous — no email, no name. We publish only totals.
        </p>

        <div className="mt-8 space-y-7">
          {QUESTIONS.map((question, index) => {
            const missing = showMissing && answers[question.key] === undefined;
            return (
              <fieldset key={question.key}>
                <legend className={cx("font-medium", missing && "text-overrule-deep")}>
                  <span className="tabular text-ink-3">{index + 1}. </span>
                  {question.title}
                  {missing && <span className="font-normal"> — please pick one</span>}
                </legend>
                <div role="radiogroup" aria-label={question.title} className="mt-2.5 flex flex-wrap gap-2">
                  {question.options.map(([value, label]) => {
                    const selected = answers[question.key] === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => setAnswers((current) => ({ ...current, [question.key]: value }))}
                        className={cx(
                          "min-h-12 min-w-24 rounded-full border px-5 text-base transition-colors",
                          selected ? "border-ink bg-ink text-paper" : "border-line-strong bg-card hover:border-ink",
                        )}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}

          <label className="block">
            <span className="font-medium">
              <span className="tabular text-ink-3">6. </span>Your job title <span className="font-normal text-ink-3">(optional)</span>
            </span>
            <input
              type="text"
              value={jobTitle}
              maxLength={80}
              onChange={(event) => setJobTitle(event.target.value)}
              autoComplete="organization-title"
              className="mt-2.5 min-h-12 w-full rounded-xl border border-line-strong bg-card px-4 text-base focus:border-ink focus:outline-none"
            />
          </label>
        </div>

        {state === "failed" && (
          <p className="mt-6 text-overrule-deep" role="alert">
            That didn’t send. Your answers are still here — try again.
          </p>
        )}
        <Button type="submit" size="lg" full className="mt-8" disabled={state === "pending"}>
          {state === "pending" ? "Sending…" : "Send my answers"}
        </Button>
      </form>
    </Shell>
  );
}
