import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { listTargets } from "../../engine/drillSchema";
import type { Annotation, AttemptResult } from "../../shared/api";
import { ArtifactView } from "../drill/ArtifactView";
import { modeLabel } from "../drill/labels";
import { MicroSurvey } from "../drill/MicroSurvey";
import { KIND_STYLE, ReviewNotes } from "../drill/ReviewNotes";
import { track, useApi } from "../lib/api";
import { score, shortDay, signed } from "../lib/format";
import { useCountUp } from "../lib/useCountUp";
import { Button, ButtonLink, cx, Eyebrow, PageError, PageLoading, Shell } from "../ui";

/** One square per planted mistake (green caught, amber wrong type, red missed), then one dark square per wrong flag. */
function shareSquares(annotations: ReadonlyArray<Annotation>): string[] {
  const key = annotations
    .filter((a) => a.keyType !== undefined)
    .map((a) => (a.kind === "caught" ? "bg-caught" : a.kind === "wrong_type" ? "bg-partial" : "bg-overrule"));
  const wrong = annotations.filter((a) => a.kind === "false_flag" || a.kind === "decoy_flagged").map(() => "bg-ink");
  return [...key, ...wrong];
}

function ScoreBlock({ result }: { result: AttemptResult }) {
  const shown = useCountUp(result.rating.after, result.rating.before);
  const up = result.rating.delta >= 0;
  return (
    <div className="mt-6 flex items-end justify-between gap-4 border-y hairline py-5">
      <div>
        <p className="eyebrow">Judgment Score</p>
        <p className="tabular mt-1 font-serif text-6xl leading-none">{score(shown)}</p>
      </div>
      <div className="text-right">
        <span
          className={cx(
            "tabular inline-block rounded-full px-3 py-1 text-sm font-semibold",
            up ? "bg-caught-soft text-caught-deep" : "bg-overrule-soft text-overrule-deep",
          )}
        >
          {signed(result.rating.delta)}
        </span>
        {result.streak >= 1 && <p className="mt-2 text-sm text-ink-2">{result.streak}-day streak</p>}
      </div>
    </div>
  );
}

function ShareStrip({ result }: { result: AttemptResult }) {
  const [copied, setCopied] = useState(false);
  const squares = shareSquares(result.annotations);

  async function share() {
    track("share_click", { mode: result.mode });
    try {
      if (navigator.share) await navigator.share({ text: result.share.text });
      else {
        await navigator.clipboard.writeText(result.share.text);
        setCopied(true);
      }
    } catch {
      // The person dismissed the share sheet, or the clipboard is blocked: nothing to do.
    }
  }

  return (
    <section className="mt-6 rounded-card border hairline bg-card p-4" aria-label="Share your result">
      <div className="flex items-center justify-between gap-4">
        <div className="flex gap-1.5" role="img" aria-label={`Result grid: ${result.caught} of ${result.total} caught`}>
          {squares.map((color, index) => (
            <span key={index} className={cx("size-7 rounded-md", color)} />
          ))}
        </div>
        <Button variant="dark" onClick={share}>
          {copied ? "Copied" : "Share result"}
        </Button>
      </div>
      <pre className="mt-3 overflow-x-auto font-mono text-xs leading-relaxed whitespace-pre-wrap text-ink-3">
        {result.share.text}
      </pre>
    </section>
  );
}

function headline(result: AttemptResult): string {
  const clean = result.caught === result.total && result.falseFlags + result.decoyFlags === 0;
  return clean ? `Clean catch: ${result.total} of ${result.total}` : `You caught ${result.caught} of ${result.total}`;
}

function ResultView({ result }: { result: AttemptResult }) {
  useEffect(() => {
    track("result_view", { mode: result.mode });
  }, [result.mode]);

  const byTarget = useMemo(() => new Map(result.annotations.map((a) => [a.targetId, a])), [result]);
  const quotes = useMemo(
    () => new Map(listTargets(result.drill.artifact).map((target) => [target.id, target.text])),
    [result],
  );

  return (
    <div className="animate-rise pb-28">
      <Eyebrow>
        {modeLabel(result.mode, result.dailyNumber)} · {shortDay(result.day)}
      </Eyebrow>
      <h1 className="mt-2 text-4xl leading-tight sm:text-5xl">{headline(result)}</h1>
      <ScoreBlock result={result} />
      <ShareStrip result={result} />

      <h2 className="mt-10 text-2xl">The review, line by line</h2>
      <div className="mt-4">
        <ArtifactView
          drill={result.drill}
          target={(segment, place) => {
            const annotation = byTarget.get(segment.id);
            return (
              <span
                className={cx(
                  "rounded-[5px]",
                  place === "cell" ? "block px-1.5 py-1.5" : "box-decoration-clone px-0.5 py-0.5",
                  annotation && KIND_STYLE[annotation.kind].mark,
                )}
              >
                {segment.text}
              </span>
            );
          }}
          after={(ids) => (
            <ReviewNotes annotations={ids.flatMap((id) => byTarget.get(id) ?? [])} quotes={quotes} />
          )}
        />
      </div>

      {result.cues.length > 0 && (
        <section className="mt-10">
          <h2 className="text-2xl">What to watch for</h2>
          <ol className="mt-3 divide-y divide-line border-y hairline">
            {result.cues.map((cue, index) => (
              <li key={cue} className="flex gap-4 py-3">
                <span className="tabular font-serif text-xl text-ink-3">{String(index + 1).padStart(2, "0")}</span>
                <span className="leading-relaxed">{cue}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <p className="mt-6 text-sm leading-relaxed text-ink-3">
        <span className="tabular">
          {result.points} of {result.maxPoints} points.
        </span>{" "}
        10 × severity per catch, +5 for the right type, up to +6 for your reasoning, −5 per false alarm, −8 per
        flagged look-alike.
        {result.whyGradedBy !== "none" &&
          ` Notes graded by: ${result.whyGradedBy === "llm" ? "AI" : "keyword match"}.`}
      </p>

      {result.isFirstAttempt && <MicroSurvey />}

      <div className="fixed inset-x-0 bottom-0 border-t hairline bg-paper/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-4 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <p className="text-sm text-ink-3">
            {result.mode === "daily" ? "Next Daily Catch unlocks at midnight ET." : "Your score moves with every drill."}
          </p>
          <ButtonLink to={result.isFirstAttempt ? "/pro" : "/dashboard"} size="lg" className="shrink-0">
            Continue
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}

/** The result of one attempt: what was caught, what was missed and why, and where the score went. */
export default function Result() {
  const { attemptId = "" } = useParams();
  const passed = (useLocation().state as { result?: AttemptResult } | null)?.result;
  const fresh = passed?.attemptId === attemptId ? passed : undefined;
  const { data, error, loading, reload } = useApi<AttemptResult>(fresh ? null : `/api/attempts/${attemptId}`);
  const result = fresh ?? data;

  return (
    <Shell footer={false}>
      {error ? (
        error.status === 404 ? (
          <div className="flex min-h-[50dvh] flex-col items-center justify-center gap-4 text-center">
            <h1 className="text-3xl">We couldn’t find that result.</h1>
            <ButtonLink to="/dashboard" variant="dark">
              Go to my dashboard
            </ButtonLink>
          </div>
        ) : (
          <PageError retry={reload} />
        )
      ) : loading || !result ? (
        <PageLoading label="Scoring…" />
      ) : (
        <ResultView key={result.attemptId} result={result} />
      )}
    </Shell>
  );
}
