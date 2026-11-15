import type { Database } from "../db";
import type { EventName } from "../repos/events";
import { modelSpend, type ModelSpend } from "./budget";

/**
 * Product metrics for /metrics, computed straight from the event log.
 * Demo profiles are always excluded; internal traffic (our own browsers, the e2e
 * suite) is excluded unless explicitly asked for.
 */
export interface FunnelStep {
  event: EventName;
  label: string;
  sessions: number;
  /** Conversion from the previous step and from the first step, 0–1 (null when undefined). */
  fromPrevious: number | null;
  fromFirst: number | null;
}

export interface LlmGroup {
  purpose: string;
  provider: string;
  model: string;
  calls: number;
  ok: number;
  p50Ms: number;
  inputTokens: number;
  outputTokens: number;
}

export type Tally = Record<string, number>;

export interface MetricsSnapshot {
  generatedAt: string;
  includeInternal: boolean;
  sessions: { total: number; withScan: number; withAttempt: number; trials: number };
  funnel: FunnelStep[];
  /** Sessions at least a day old, and how many of them came back on a later ET day. */
  retention: { eligible: number; returned: number };
  daily: { completions: number; players: number; shares: number };
  counters: Tally;
  microSurvey: { n: number; shippedAiError: Tally; wouldPay: Tally };
  fullSurvey: { n: number; answers: Record<string, Tally> };
  llm: { groups: LlmGroup[]; draftsAccepted: number; draftsRejected: number; spend: ModelSpend };
}

const FUNNEL: ReadonlyArray<[EventName, string]> = [
  ["landing_view", "Landing viewed"],
  ["scan_start", "Scan started"],
  ["task_select", "Tasks picked"],
  ["scan_complete", "Scan completed"],
  ["map_view", "Exposure map viewed"],
  ["drill_start", "Drill started"],
  ["drill_submit", "Drill submitted"],
  ["result_view", "Result viewed"],
  ["paywall_view", "Paywall viewed"],
  ["checkout_start", "Checkout started"],
  ["trial_start", "Trial started"],
];

const COUNTERS: ReadonlyArray<EventName> = [
  "share_click",
  "calendar_add",
  "report_create",
  "seo_page_view",
  "seo_cta_click",
  "survey_submit",
];

const DAY_MS = 86_400_000;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}

function tally(values: ReadonlyArray<string | undefined>): Tally {
  const out: Tally = {};
  for (const value of values) if (value !== undefined) out[value] = (out[value] ?? 0) + 1;
  return out;
}

export function collectMetrics(db: Database, now: Date, includeInternal: boolean, budgetUsd: number): MetricsSnapshot {
  // `real` filters a joined `sessions s`.
  const real = includeInternal ? "s.is_demo = 0" : "s.is_demo = 0 AND s.is_internal = 0";
  const count = (sql: string, ...params: Array<string | number>): number =>
    (db.query(sql).get(...params) as { n: number }).n;

  const uniqueSessions = (event: EventName): number =>
    count(
      `SELECT COUNT(DISTINCT e.session_id) AS n FROM events e JOIN sessions s ON s.id = e.session_id
       WHERE e.name = ? AND ${real}`,
      event,
    );

  const reached = FUNNEL.map(([event]) => uniqueSessions(event));
  const funnel: FunnelStep[] = FUNNEL.map(([event, label], i) => {
    const sessions = reached[i]!;
    const previous = i === 0 ? undefined : reached[i - 1];
    const first = reached[0]!;
    return {
      event,
      label,
      sessions,
      fromPrevious: previous ? sessions / previous : null,
      fromFirst: i > 0 && first ? sessions / first : null,
    };
  });

  const dayAgo = new Date(now.getTime() - DAY_MS).toISOString();
  const counters: Tally = {};
  for (const event of COUNTERS) {
    // SEO page views are logged without a session (crawlers never get one), so they are counted raw.
    counters[event] =
      event === "seo_page_view"
        ? count("SELECT COUNT(*) AS n FROM events WHERE name = ?", event)
        : count(
            `SELECT COUNT(*) AS n FROM events e JOIN sessions s ON s.id = e.session_id WHERE e.name = ? AND ${real}`,
            event,
          );
  }

  const surveyRows = db
    .query(`SELECT v.kind, v.answers FROM surveys v JOIN sessions s ON s.id = v.session_id WHERE ${real}`)
    .all() as Array<{ kind: string; answers: string }>;
  const micro = surveyRows.filter((r) => r.kind === "micro").map((r) => JSON.parse(r.answers) as Record<string, string>);
  const full = surveyRows.filter((r) => r.kind === "full").map((r) => JSON.parse(r.answers) as Record<string, string>);
  const fullAnswers: Record<string, Tally> = {};
  for (const question of ["inUs", "age", "aiWeekly", "hadAiError", "wouldPay"]) {
    fullAnswers[question] = tally(full.map((answers) => answers[question]));
  }

  const llmRows = db
    .query("SELECT purpose, provider, model, ms, ok, input_tokens, output_tokens FROM llm_calls")
    .all() as Array<{
    purpose: string;
    provider: string;
    model: string;
    ms: number;
    ok: number;
    input_tokens: number | null;
    output_tokens: number | null;
  }>;
  const groups = new Map<string, LlmGroup & { latencies: number[] }>();
  for (const row of llmRows) {
    const key = `${row.purpose}|${row.provider}|${row.model}`;
    const group = groups.get(key) ?? {
      purpose: row.purpose,
      provider: row.provider,
      model: row.model,
      calls: 0,
      ok: 0,
      p50Ms: 0,
      inputTokens: 0,
      outputTokens: 0,
      latencies: [],
    };
    group.calls++;
    group.ok += row.ok;
    group.inputTokens += row.input_tokens ?? 0;
    group.outputTokens += row.output_tokens ?? 0;
    group.latencies.push(row.ms);
    groups.set(key, group);
  }
  const drafts = llmRows.filter((row) => row.purpose === "generate");

  return {
    generatedAt: now.toISOString(),
    includeInternal,
    sessions: {
      total: count(`SELECT COUNT(*) AS n FROM sessions s WHERE ${real}`),
      withScan: count(`SELECT COUNT(*) AS n FROM sessions s WHERE ${real} AND s.soc IS NOT NULL`),
      withAttempt: count(`SELECT COUNT(*) AS n FROM sessions s WHERE ${real} AND s.attempts_count > 0`),
      trials: count(`SELECT COUNT(*) AS n FROM sessions s WHERE ${real} AND s.plan = 'trial'`),
    },
    funnel,
    retention: {
      eligible: count(`SELECT COUNT(*) AS n FROM sessions s WHERE ${real} AND s.created_at <= ?`, dayAgo),
      returned: count(
        `SELECT COUNT(DISTINCT e.session_id) AS n FROM events e JOIN sessions s ON s.id = e.session_id
         WHERE e.name = 'daily_return' AND ${real} AND s.created_at <= ?`,
        dayAgo,
      ),
    },
    daily: {
      completions: count(
        `SELECT COUNT(*) AS n FROM attempts a JOIN sessions s ON s.id = a.session_id WHERE a.mode = 'daily' AND ${real}`,
      ),
      players: count(
        `SELECT COUNT(DISTINCT a.session_id) AS n FROM attempts a JOIN sessions s ON s.id = a.session_id
         WHERE a.mode = 'daily' AND ${real}`,
      ),
      shares: counters["share_click"] ?? 0,
    },
    counters,
    microSurvey: {
      n: micro.length,
      shippedAiError: tally(micro.map((answers) => answers["shippedAiError"])),
      wouldPay: tally(micro.map((answers) => answers["wouldPay"])),
    },
    fullSurvey: { n: full.length, answers: fullAnswers },
    llm: {
      groups: [...groups.values()]
        .map(({ latencies, ...group }) => ({ ...group, p50Ms: median(latencies) }))
        .sort((a, b) => a.purpose.localeCompare(b.purpose) || b.calls - a.calls),
      draftsAccepted: drafts.filter((row) => row.ok === 1).length,
      draftsRejected: drafts.filter((row) => row.ok === 0).length,
      spend: modelSpend(db, budgetUsd),
    },
  };
}
