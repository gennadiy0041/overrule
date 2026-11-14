import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ERROR_TYPE_INFO, listTargets, type Segment } from "../../engine/drillSchema";
import type { AttemptResult, DrillResponse, SubmitRequest } from "../../shared/api";
import { ArtifactView, type TargetPlace } from "../drill/ArtifactView";
import { FlagSheet, type FlagDraft } from "../drill/FlagSheet";
import { clock, modeLabel } from "../drill/labels";
import { api, track, useApi } from "../lib/api";
import { truncate } from "../lib/format";
import { Button, ButtonLink, cx, PageError, PageLoading, Shell } from "../ui";

type Flags = Record<string, FlagDraft>;

interface Saved {
  flags: Flags;
  startedAt: number;
}

/** After five minutes the timer turns amber — a nudge, never a limit. */
const SOFT_LIMIT_S = 5 * 60;

function storageKey(drillId: string): string {
  return `overrule.drill.${drillId}`;
}

function loadSaved(drillId: string): Saved {
  try {
    const stored = window.sessionStorage.getItem(storageKey(drillId));
    if (stored) return JSON.parse(stored) as Saved;
  } catch {
    // Unreadable entry: start fresh.
  }
  return { flags: {}, startedAt: Date.now() };
}

/** One flaggable sentence or cell. Keyboard: Tab to it, Enter or Space to flag. */
function Target({
  segment,
  place,
  flag,
  onOpen,
}: {
  segment: Segment;
  place: TargetPlace;
  flag: FlagDraft | undefined;
  onOpen: (segment: Segment, element: HTMLElement) => void;
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      data-target-id={segment.id}
      aria-pressed={flag !== undefined}
      aria-label={`${flag ? `Flagged as ${ERROR_TYPE_INFO[flag.type].label}: ` : ""}${segment.text}`}
      onClick={(event) => onOpen(segment, event.currentTarget)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(segment, event.currentTarget);
        }
      }}
      className={cx(
        "cursor-pointer rounded-[5px] transition-colors",
        place === "cell" ? "block min-h-9 px-1.5 py-1.5" : "box-decoration-clone px-0.5 py-0.5",
        flag
          ? "bg-overrule-soft underline decoration-overrule decoration-2 underline-offset-4"
          : "hover:bg-paper-2 focus-visible:bg-paper-2",
      )}
    >
      {segment.text}
      {flag && (
        <span className="ml-1.5 inline-block rounded-full bg-overrule px-2 py-px align-[0.1em] text-[0.68rem] font-semibold whitespace-nowrap text-white">
          {ERROR_TYPE_INFO[flag.type].label}
        </span>
      )}
    </span>
  );
}

/** Route entry. Keyed by drill id so that flags and the timer never leak from one drill into the next. */
export default function Drill() {
  const { drillId = "" } = useParams();
  return <DrillView key={drillId} drillId={drillId} />;
}

/** The drill: read the AI's draft, flag what is actually wrong, submit. */
function DrillView({ drillId }: { drillId: string }) {
  const navigate = useNavigate();
  const { data, error, loading, reload } = useApi<DrillResponse>(`/api/drills/${drillId}`);

  const [saved, setSaved] = useState<Saved>(() => loadSaved(drillId));
  const [open, setOpen] = useState<Segment>();
  const [notice, setNotice] = useState<string>();
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const [seconds, setSeconds] = useState(() => Math.floor((Date.now() - saved.startedAt) / 1000));
  const opener = useRef<HTMLElement | null>(null);

  const flags = saved.flags;
  const flagCount = Object.keys(flags).length;

  useEffect(() => {
    if (data?.attemptId) navigate(`/result/${data.attemptId}`, { replace: true });
  }, [data, navigate]);
  useEffect(() => {
    if (error?.code === "pro_required") navigate("/pro", { replace: true });
  }, [error, navigate]);
  useEffect(() => {
    if (data && !data.attemptId) track("drill_start", { mode: data.mode, level: data.drill.level, origin: data.origin });
  }, [data]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(storageKey(drillId), JSON.stringify(saved));
    } catch {
      // Storage unavailable: flags simply won't survive a refresh.
    }
  }, [drillId, saved]);

  useEffect(() => {
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - saved.startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [saved.startedAt]);

  const maxFlags = data?.drill.maxFlags ?? 0;
  const validIds = useMemo(() => new Set(data ? listTargets(data.drill.artifact).map((t) => t.id) : []), [data]);

  const openSheet = useCallback(
    (segment: Segment, element: HTMLElement) => {
      setConfirmEmpty(false);
      if (!flags[segment.id] && flagCount >= maxFlags) {
        setNotice("You’re out of flags — remove one to add another.");
        return;
      }
      setNotice(undefined);
      opener.current = element;
      setOpen(segment);
    },
    [flags, flagCount, maxFlags],
  );

  const closeSheet = useCallback(() => {
    setOpen(undefined);
    opener.current?.focus();
  }, []);

  function setFlag(targetId: string, flag: FlagDraft | undefined) {
    setSaved((current) => {
      const next = { ...current.flags };
      if (flag) next[targetId] = flag;
      else delete next[targetId];
      return { ...current, flags: next };
    });
    closeSheet();
  }

  async function submit() {
    if (!data || submitting) return;
    if (flagCount === 0 && !confirmEmpty) {
      setConfirmEmpty(true);
      return;
    }
    setSubmitting(true);
    setSubmitError(false);
    const body: SubmitRequest = {
      flags: Object.entries(flags)
        .filter(([targetId]) => validIds.has(targetId))
        .map(([targetId, flag]) => ({ targetId, type: flag.type, ...(flag.why ? { why: flag.why } : {}) })),
      elapsedMs: Date.now() - saved.startedAt,
    };
    try {
      const result = await api.post<AttemptResult>(`/api/drills/${drillId}/submit`, body);
      window.sessionStorage.removeItem(storageKey(drillId));
      navigate(`/result/${result.attemptId}`, { state: { result } });
    } catch {
      setSubmitError(true);
      setSubmitting(false);
    }
  }

  if (error && error.code !== "pro_required") {
    return (
      <Shell footer={false}>
        {error.status === 404 ? (
          <div className="flex min-h-[50dvh] flex-col items-center justify-center gap-4 text-center">
            <h1 className="text-3xl">This drill isn’t available.</h1>
            <ButtonLink to="/dashboard" variant="dark">
              Go to my dashboard
            </ButtonLink>
          </div>
        ) : (
          <PageError retry={reload} />
        )}
      </Shell>
    );
  }
  if (loading || !data || data.attemptId) return <Shell footer={false}><PageLoading label="Opening the draft…" /></Shell>;

  const { drill } = data;
  const over = seconds >= SOFT_LIMIT_S;

  return (
    <Shell
      footer={false}
      headerRight={
        <span>
          {modeLabel(data.mode, data.dailyNumber)} · Level {drill.level}
        </span>
      }
    >
      <div className="animate-rise pb-36">
        <section className="rounded-card bg-paper-2 px-4 py-4 sm:px-5">
          <p className="text-sm text-ink-2">
            <span className="font-medium text-ink">{drill.brief.from}</span>, {drill.brief.role}, asked your AI
            assistant:
          </p>
          <blockquote className="mt-2 border-l-2 border-ink pl-3 leading-relaxed">{drill.brief.ask}</blockquote>
          <p className="mt-3 text-xs text-ink-3" title={drill.task}>
            Trains: {truncate(drill.task, 100)}
            {data.origin === "pool" && ` · pre-verified drill (${drill.occupation})`}
          </p>
        </section>

        <p className="mt-5 font-medium leading-snug">
          This draft has 3–4 mistakes — and lines that only look wrong. Overrule only what’s actually wrong.
        </p>
        <p className="mt-1 text-sm text-ink-3">Tap a sentence or a cell to flag it.</p>

        <div className="mt-4">
          <ArtifactView
            drill={drill}
            target={(segment, place) => (
              <Target segment={segment} place={place} flag={flags[segment.id]} onOpen={openSheet} />
            )}
          />
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t hairline bg-paper/95 backdrop-blur">
        <div className="mx-auto w-full max-w-2xl px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {(notice || confirmEmpty || submitError) && (
            <p role="status" className="mb-2 text-sm text-overrule-deep">
              {submitError
                ? "Couldn’t submit — check your connection and try again. Your flags are safe."
                : confirmEmpty
                  ? "Submit with no flags? You’re saying this draft is clean."
                  : notice}
            </p>
          )}
          <div className="flex items-center justify-between gap-4">
            <div className="text-sm leading-tight">
              <p className="tabular font-medium">
                {flagCount} of {maxFlags} flags
              </p>
              <p className={cx("tabular", over ? "text-partial-deep" : "text-ink-3")}>
                {clock(seconds)}
                {over && " · take your time"}
              </p>
            </div>
            <Button size="lg" onClick={submit} disabled={submitting}>
              {submitting ? "Scoring…" : confirmEmpty ? "Yes, submit" : "Submit review"}
            </Button>
          </div>
        </div>
      </div>

      {open && (
        <FlagSheet
          text={open.text}
          existing={flags[open.id]}
          onSave={(flag) => setFlag(open.id, flag)}
          onRemove={() => setFlag(open.id, undefined)}
          onClose={closeSheet}
        />
      )}
    </Shell>
  );
}
