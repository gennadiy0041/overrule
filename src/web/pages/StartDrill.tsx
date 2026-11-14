import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ERROR_TYPE_INFO, ERROR_TYPES, type ErrorType } from "../../engine/drillSchema";
import type { GenerationStage, NextDrillRequest, ReadyEvent, StageEvent } from "../../shared/api";
import { postEvents } from "../lib/sse";
import { Button, ButtonLink, cx, Shell, Spinner } from "../ui";

type Mode = NextDrillRequest["mode"];

/** Honest descriptions of what the server is doing at each stage. */
const STAGE_COPY: Readonly<Record<GenerationStage, string>> = {
  queued: "Picking a task from your job",
  drafting: "Drafting a document the way an AI assistant would",
  verifying: "Verifying it: every number recomputed, every planted mistake provable",
  retrying: "First draft failed verification — redrafting with the checker’s notes",
  switching_provider: "Switching to a second model",
  pool: "Using a pre-verified drill from the pool",
};

const TYPE_EXAMPLE: Readonly<Record<ErrorType, string>> = {
  numbers: "“+40%” where the data says +15%",
  facts: "a benchmark with a source nobody can find",
  logic: "budget moved to the worst-performing channel",
  risk: "“100% waterproof in any storm”",
  audience: "asked for three options, got one",
};

const SLOW_AFTER_S = 25;
const TIP_ROTATE_MS = 4000;

function parseMode(value: string | null): Mode {
  return value === "practice" || value === "daily" ? value : "first";
}

/** Mistake types to keep in mind while the drill is prepared; one is highlighted at a time. */
function MistakeTypes() {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setActive((i) => (i + 1) % ERROR_TYPES.length), TIP_ROTATE_MS);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <section className="mt-12">
      <p className="eyebrow">What AI typically gets wrong</p>
      <ul className="mt-3 divide-y divide-line border-y hairline">
        {ERROR_TYPES.map((type, index) => (
          <li
            key={type}
            className={cx("py-3 transition-colors duration-500", index === active ? "text-ink" : "text-ink-3")}
          >
            <span className="font-medium">{ERROR_TYPE_INFO[type].label}</span>
            <span className="text-sm"> — {TYPE_EXAMPLE[type]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The wait between "start" and the drill: 2–40 seconds while a document is
 * drafted and verified. Progress is streamed from the server — the stages shown
 * are the stages that actually happened.
 */
export default function StartDrill() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const mode = parseMode(params.get("mode"));
  const [stages, setStages] = useState<GenerationStage[]>([]);
  const [failure, setFailure] = useState<string>();
  const [elapsed, setElapsed] = useState(0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setStages([]);
    setFailure(undefined);
    setElapsed(0);
    postEvents(
      "/api/drills/next",
      { mode },
      ({ event, data }) => {
        if (event === "stage") {
          const { stage } = data as StageEvent;
          setStages((seen) => (seen[seen.length - 1] === stage ? seen : [...seen, stage]));
        } else if (event === "ready") {
          navigate(`/drill/${(data as ReadyEvent).drillId}`, { replace: true });
        } else if (event === "failed") {
          const { error } = data as { error: string };
          if (error === "pro_required") navigate("/pro", { replace: true });
          else if (error === "scan_required") navigate("/scan", { replace: true });
          else setFailure(error);
        }
      },
      controller.signal,
    ).catch(() => {
      if (!controller.signal.aborted) setFailure("network_error");
    });
    return () => controller.abort();
  }, [mode, navigate, attempt]);

  useEffect(() => {
    if (failure) return;
    const timer = window.setInterval(() => setElapsed((seconds) => seconds + 1), 1000);
    return () => window.clearInterval(timer);
  }, [failure, attempt]);

  if (failure === "practice_limit") {
    return (
      <Shell footer={false}>
        <div className="flex min-h-[60dvh] flex-col items-start justify-center gap-4">
          <h1 className="text-3xl">That’s your 10 practice drills for today.</h1>
          <p className="text-ink-2">Come back tomorrow — or look back at what you caught today.</p>
          <ButtonLink to="/dashboard" variant="dark">
            Go to my dashboard
          </ButtonLink>
        </div>
      </Shell>
    );
  }

  if (failure) {
    return (
      <Shell footer={false}>
        <div className="flex min-h-[60dvh] flex-col items-start justify-center gap-4" role="alert">
          <h1 className="text-3xl">We couldn’t prepare a drill.</h1>
          <p className="text-ink-2">Nothing was lost. Try again in a moment.</p>
          <div className="flex gap-3">
            <Button variant="dark" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
            <ButtonLink to="/dashboard" variant="outline">
              Dashboard
            </ButtonLink>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell footer={false} headerRight={<span className="tabular">{elapsed}s</span>}>
      <div className="animate-rise pt-6 pb-16">
        <h1 className="text-[2rem] leading-tight sm:text-4xl">
          {mode === "daily" ? "Opening today’s Daily Catch" : "Building your drill"}
        </h1>
        <ol className="mt-8 space-y-4" aria-live="polite">
          {(stages.length === 0 ? (["queued"] as GenerationStage[]) : stages).map((stage, index, all) => {
            const current = index === all.length - 1;
            return (
              <li key={`${stage}-${index}`} className={cx("flex items-start gap-3 text-lg", !current && "text-ink-2")}>
                <span className="mt-1 flex size-5 shrink-0 items-center justify-center">
                  {current ? (
                    <Spinner className="size-4" />
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                      <path d="M4 9.5l3.5 3.5L14 6" stroke="var(--color-caught)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                {STAGE_COPY[stage]}
              </li>
            );
          })}
        </ol>
        {elapsed >= SLOW_AFTER_S && (
          <p className="mt-6 animate-fade text-sm text-ink-3">
            Taking longer than usual — if the live draft isn’t ready soon you’ll get a pre-verified drill instead.
          </p>
        )}
        <MistakeTypes />
      </div>
    </Shell>
  );
}
