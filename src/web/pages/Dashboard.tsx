import { useState } from "react";
import { Link } from "react-router-dom";
import { ERROR_TYPE_INFO } from "../../engine/drillSchema";
import type { HistoryEntry, MeResponse, ReportResponse } from "../../shared/api";
import { CatchRates } from "../dashboard/CatchRates";
import { DailyCard } from "../dashboard/DailyCard";
import { ScoreCard } from "../dashboard/ScoreCard";
import { api, track, useApi } from "../lib/api";
import { shortDay, signed, truncate } from "../lib/format";
import { Button, ButtonLink, Card, Eyebrow, PageError, PageLoading, Shell } from "../ui";

const HISTORY_PREVIEW = 8;
const MODE_TAG: Readonly<Record<HistoryEntry["mode"], string>> = { daily: "Daily", first: "First", practice: "Practice" };

function ProTag() {
  return <span className="rounded-full bg-ink px-2 py-0.5 text-xs font-semibold text-paper">Pro</span>;
}

function EmptyState() {
  return (
    <div className="flex min-h-[60dvh] flex-col items-start justify-center gap-4">
      <h1 className="text-4xl">Start with your job</h1>
      <p className="text-lg text-ink-2">
        Two minutes, no sign-up: see how much of your work AI can already draft, then catch your first AI mistake.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <ButtonLink to="/scan" size="lg">
          Scan my job — free
        </ButtonLink>
        <ButtonLink to="/demo" variant="outline" size="lg">
          See a 7-day demo profile
        </ButtonLink>
      </div>
    </div>
  );
}

function DebriefCard({ me }: { me: MeResponse }) {
  const { debrief } = me;
  return (
    <Card className="p-5 sm:p-6">
      <Eyebrow>Weekly Debrief</Eyebrow>
      {!debrief ? (
        <p className="mt-2 text-ink-2">Your first Weekly Debrief appears after your first drill.</p>
      ) : (
        <>
          <p className="mt-2 text-xl leading-snug">{debrief.headline}</p>
          <p className="mt-1 text-sm text-ink-3">
            {shortDay(debrief.from)}–{shortDay(debrief.to)}
          </p>
          {debrief.lines.length > 0 ? (
            <ul className="mt-3 space-y-2 border-t hairline pt-3 leading-relaxed text-ink-2">
              {debrief.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 flex flex-wrap items-center gap-2 border-t hairline pt-3 text-sm text-ink-2">
              <ProTag /> Full debrief: strongest and weakest mistake types, false alarms, score change.
              <Link to="/pro" className="font-medium underline underline-offset-4">
                Unlock with Pro
              </Link>
            </p>
          )}
        </>
      )}
    </Card>
  );
}

function PracticeCard({ me }: { me: MeResponse }) {
  const { usedToday, limit } = me.practice;
  const spent = usedToday >= limit;
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-center gap-2">
        <Eyebrow>Practice</Eyebrow>
        {!me.isPro && <ProTag />}
      </div>
      <p className="mt-2 text-xl leading-snug">Personal drills from your own tasks</p>
      {me.isPro ? (
        <>
          <p className="tabular mt-1 text-sm text-ink-2">
            {usedToday} of {limit} today
            {me.weakSpot && ` · next drill targets your weak spot: ${ERROR_TYPE_INFO[me.weakSpot].label}`}
          </p>
          {spent ? (
            <p className="mt-4 text-ink-2">That’s today’s ten. Back tomorrow.</p>
          ) : (
            <ButtonLink to="/start?mode=practice" variant="dark" size="lg" full className="mt-4">
              Start a practice drill
            </ButtonLink>
          )}
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-ink-2">Built from the tasks you picked, weighted towards what you miss.</p>
          <ButtonLink to="/pro" variant="outline" size="lg" full className="mt-4">
            See Pro
          </ButtonLink>
        </>
      )}
    </Card>
  );
}

function Tools({ me }: { me: MeResponse }) {
  const [state, setState] = useState<"idle" | "pending" | "failed">("idle");

  async function createReport() {
    setState("pending");
    try {
      const report = await api.post<ReportResponse>("/api/reports");
      window.location.assign(report.path);
    } catch {
      setState("failed");
    }
  }

  return (
    <Card className="divide-y divide-line px-5 sm:px-6">
      <div className="flex items-center justify-between gap-4 py-4">
        <div>
          <p className="font-medium">Review report</p>
          <p className="text-sm text-ink-2">
            {state === "failed" ? "Couldn’t create it — try again." : "A printable record for your self-review."}
          </p>
        </div>
        {me.isPro ? (
          <Button variant="outline" onClick={createReport} disabled={state === "pending" || me.attemptsCount === 0}>
            {state === "pending" ? "Creating…" : "Create my review report"}
          </Button>
        ) : (
          <ButtonLink to="/pro" variant="outline">
            Pro
          </ButtonLink>
        )}
      </div>
      <div className="flex items-center justify-between gap-4 py-4">
        <div>
          <p className="font-medium">Daily reminder</p>
          <p className="text-sm text-ink-2">Add a daily 5-min reminder to my calendar.</p>
        </div>
        <a
          href="/api/calendar.ics"
          download="overrule-daily-catch.ics"
          onClick={() => track("calendar_add")}
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full border border-line-strong bg-card px-5 text-[0.95rem] font-medium hover:border-ink"
        >
          Add to calendar
        </a>
      </div>
    </Card>
  );
}

function History({ me }: { me: MeResponse }) {
  const [all, setAll] = useState(false);
  const newestFirst = [...me.history].reverse();
  const more = newestFirst.length > HISTORY_PREVIEW;
  const shown = all && me.isPro ? newestFirst : newestFirst.slice(0, HISTORY_PREVIEW);
  if (shown.length === 0) return null;

  return (
    <section>
      <h2 className="text-2xl">History</h2>
      <ul className="mt-3 divide-y divide-line border-y hairline">
        {shown.map((entry) => (
          <li key={entry.attemptId}>
            <Link to={`/result/${entry.attemptId}`} className="flex min-h-14 items-center justify-between gap-3 py-2.5 hover:bg-paper-2">
              <span className="min-w-0">
                <span className="block truncate">{truncate(entry.title, 60)}</span>
                <span className="text-sm text-ink-3">
                  {MODE_TAG[entry.mode]} · {shortDay(entry.day)} · Level {entry.level}
                </span>
              </span>
              <span className="tabular shrink-0 text-right text-sm">
                <span className="block font-medium">
                  {entry.caught}/{entry.total}
                </span>
                <span className={entry.delta >= 0 ? "text-caught-deep" : "text-overrule-deep"}>{signed(entry.delta)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {more &&
        (me.isPro ? (
          !all && (
            <button type="button" onClick={() => setAll(true)} className="mt-3 min-h-11 font-medium underline underline-offset-4">
              Show all {newestFirst.length}
            </button>
          )
        ) : (
          <p className="mt-3 text-sm text-ink-2">
            Full history is a Pro feature.{" "}
            <Link to="/pro" className="font-medium underline underline-offset-4">
              See Pro
            </Link>
          </p>
        ))}
    </section>
  );
}

/** The dashboard: today's catch first, then the score, the pattern of what you catch, and the Pro tools. */
export default function Dashboard() {
  const { data: me, error, loading, reload } = useApi<MeResponse>("/api/me");

  if (error) return <Shell><PageError retry={reload} /></Shell>;
  if (loading || !me) return <Shell><PageLoading /></Shell>;
  if (!me.hasScan && me.attemptsCount === 0) return <Shell><EmptyState /></Shell>;

  return (
    <Shell width="wide">
      <div className="animate-rise pb-8">
        {me.isDemo && (
          <p className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl border border-partial/40 bg-partial-soft px-4 py-3 text-sm text-partial-deep" role="note">
            <span>
              <span className="font-semibold">Demo profile — simulated week.</span> Jess · Marketing Manager · Demo
            </span>
            <Link to="/scan" className="font-medium underline underline-offset-4">
              Start with my own job
            </Link>
          </p>
        )}
        <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start">
          <div className="grid gap-5 lg:sticky lg:top-5">
            <DailyCard me={me} />
            <ScoreCard me={me} />
          </div>
          <div className="grid gap-5">
            <CatchRates me={me} />
            <DebriefCard me={me} />
            <PracticeCard me={me} />
            <Tools me={me} />
            <History me={me} />
            <p className="text-sm text-ink-3">
              {me.occupation?.title ?? "No job selected"} ·{" "}
              <Link to="/scan" className="underline underline-offset-4">
                Change job or tasks
              </Link>{" "}
              · {me.isPro && me.trialEndsAt ? `Pro trial until ${shortDay(me.trialEndsAt.slice(0, 10))}` : "Free plan"}
            </p>
          </div>
        </div>
      </div>
    </Shell>
  );
}
