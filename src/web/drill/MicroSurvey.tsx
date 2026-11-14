import { useEffect, useState } from "react";
import type { SurveyRequest } from "../../shared/api";
import { api } from "../lib/api";
import { Chip } from "../ui";

const STORAGE_KEY = "overrule.microSurvey";

type Micro = Extract<SurveyRequest, { kind: "micro" }>;

function alreadyAnswered(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return true;
  }
}

/**
 * Two one-tap questions after the first result — the cheapest honest signal of
 * whether the problem and the price are real. It never blocks the next step.
 */
export function MicroSurvey() {
  const [hidden] = useState(alreadyAnswered);
  const [shipped, setShipped] = useState<Micro["shippedAiError"]>();
  const [pay, setPay] = useState<Micro["wouldPay"]>();
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!shipped || !pay || sent) return;
    setSent(true);
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // Without storage the survey may show again; the answer still counts once per attempt.
    }
    const body: Micro = { kind: "micro", shippedAiError: shipped, wouldPay: pay };
    api.post("/api/survey", body).catch(() => undefined);
  }, [shipped, pay, sent]);

  if (hidden) return null;
  if (sent) return <p className="mt-10 rounded-card border hairline bg-card p-5 text-ink-2">Thanks — noted.</p>;

  return (
    <section className="mt-10 rounded-card border hairline bg-card p-5" aria-label="Two quick questions">
      <p className="eyebrow">Two quick questions</p>
      <p className="mt-3 font-medium">Have you ever sent work with an AI mistake in it?</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {(["yes", "not_sure", "no"] as const).map((value) => (
          <Chip key={value} selected={shipped === value} onClick={() => setShipped(value)}>
            {value === "yes" ? "Yes" : value === "no" ? "No" : "Not sure"}
          </Chip>
        ))}
      </div>
      <p className="mt-4 font-medium">Would you pay $8/month to train this?</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {(["yes", "maybe", "no"] as const).map((value) => (
          <Chip key={value} selected={pay === value} onClick={() => setPay(value)}>
            {value === "yes" ? "Yes" : value === "no" ? "No" : "Maybe"}
          </Chip>
        ))}
      </div>
    </section>
  );
}
