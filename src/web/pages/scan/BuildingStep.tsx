import { useEffect, useState } from "react";
import { Button, cx, Spinner } from "../../ui";

/** What the server is actually doing with the answers — shown as it would take a moment to read. */
const STAGES = [
  "Matching your tasks to 19,265 rated tasks",
  "Weighting by how often you do them",
  "Comparing with 923 occupations",
] as const;
const STAGE_MS = 730;

/**
 * Step 7: save the scan and build the map. The page moves on only when the save
 * has succeeded AND the three lines have been shown — never before the data is real.
 */
export function BuildingStep({ save, onDone }: { save: () => Promise<void>; onDone: () => void }) {
  const [shown, setShown] = useState(0);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    save()
      .then(() => {
        if (!cancelled) setSaved(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // `save` is stable for the lifetime of this step; `attempt` re-runs it on retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  useEffect(() => {
    if (shown >= STAGES.length) return;
    const timer = window.setTimeout(() => setShown((count) => count + 1), STAGE_MS);
    return () => window.clearTimeout(timer);
  }, [shown]);

  useEffect(() => {
    if (saved && shown >= STAGES.length) onDone();
  }, [saved, shown, onDone]);

  return (
    <div className="pt-6">
      <h1 className="text-[2rem] leading-tight sm:text-4xl">Building your map…</h1>
      <ul className="mt-8 space-y-4">
        {STAGES.map((stage, index) => {
          const done = index < shown;
          return (
            <li key={stage} className={cx("flex items-center gap-3 text-lg", done ? "text-ink" : "text-ink-3")}>
              <span className="flex size-6 items-center justify-center">
                {done ? (
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                    <path d="M4 9.5l3.5 3.5L14 6" stroke="var(--color-caught)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : index === shown ? (
                  <Spinner className="size-4" />
                ) : (
                  <span className="size-1.5 rounded-full bg-line-strong" />
                )}
              </span>
              {stage}
            </li>
          );
        })}
      </ul>
      {failed && (
        <div className="mt-8" role="alert">
          <p className="text-overrule-deep">We couldn’t save your answers. Check your connection and try again.</p>
          <Button variant="dark" className="mt-3" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}
