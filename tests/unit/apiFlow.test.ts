/**
 * End-to-end test of the HTTP API against an in-memory database, with a fake model
 * provider. It walks the whole product path — scan → map → drill → submit → dashboard
 * → checkout → practice gate → report — through the real routes, services and engine.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { join } from "node:path";
import { DrillContentSchema, type DrillContent } from "../../src/engine/drillSchema";
import { createApp } from "../../src/server/app";
import { buildContext } from "../../src/server/bootstrap";
import type { AppContext } from "../../src/server/context";
import { loadEnv } from "../../src/server/env";
import type { StructuredProvider, StructuredRequest } from "../../src/server/llm/types";
import type {
  AttemptResult,
  CheckoutResponse,
  DailyStatus,
  DrillResponse,
  MapResponse,
  MeResponse,
  OccupationDetail,
  OccupationHit,
  ReadyEvent,
  ReportResponse,
} from "../../src/shared/api";

const MARKETING = "11-2021.00";
const METRICS_TOKEN = "test-metrics-token";

/** The reference drill, reduced to a valid level-2 draft: three mistakes (numbers, facts, logic) and one decoy. */
async function levelTwoDraft(): Promise<DrillContent> {
  const fixture = await Bun.file(join(import.meta.dir, "..", "fixtures", "reference-drill.json")).json();
  const draft = DrillContentSchema.parse(fixture);
  draft.key = draft.key.filter((item) => item.targetId !== "s7");
  for (const block of draft.artifact.blocks) {
    if (block.type !== "text") continue;
    for (const segment of block.segments) {
      if (segment.id === "s7") segment.text = "The new creative tested best in October, so let's keep it in rotation.";
    }
  }
  return draft;
}

/** A model that always writes the same valid draft and grades notes the way the control example expects. */
function fakeProvider(draft: DrillContent, calls: StructuredRequest[]): StructuredProvider {
  return {
    name: "claude",
    model: "fake-model",
    async generate(request) {
      calls.push(request);
      if (request.purpose === "generate") return { data: structuredClone(draft), inputTokens: 100, outputTokens: 900 };
      if (request.purpose === "grade_why") {
        return { data: { scores: [{ targetId: "s3", score: 2 }, { targetId: "s6", score: 1 }] } };
      }
      throw new Error(`unexpected purpose ${request.purpose}`);
    },
  };
}

/** A minimal browser: keeps cookies between requests. */
class Client {
  private readonly cookies = new Map<string, string>();
  constructor(private readonly app: Hono) {}

  async request(path: string, init: { method?: string; body?: unknown } = {}): Promise<Response> {
    const headers: Record<string, string> = { "user-agent": "Mozilla/5.0 (test browser)" };
    if (this.cookies.size > 0) headers["cookie"] = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    if (init.body !== undefined) headers["content-type"] = "application/json";
    const response = await this.app.request(path, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const [name, value] = pair!.split("=");
      this.cookies.set(name!, value ?? "");
    }
    return response;
  }

  async json<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    const response = await this.request(path, init);
    expect(response.status, `${path} → ${response.status}`).toBe(200);
    return (await response.json()) as T;
  }

  /** POST and read a server-sent-event stream to the end; returns the events in order. */
  async sse(path: string, body: unknown): Promise<Array<{ event: string; data: unknown }>> {
    const response = await this.request(path, { body });
    expect(response.status).toBe(200);
    const text = await response.text();
    return text
      .split("\n\n")
      .filter((frame) => frame.trim() !== "")
      .map((frame) => {
        const event = /^event: (.+)$/m.exec(frame)?.[1] ?? "message";
        const data = /^data: (.+)$/m.exec(frame)?.[1] ?? "null";
        return { event, data: JSON.parse(data) as unknown };
      });
  }
}

let ctx: AppContext;
let app: Hono;
let client: Client;
const modelCalls: StructuredRequest[] = [];

beforeAll(async () => {
  const draft = await levelTwoDraft();
  const provider = fakeProvider(draft, modelCalls);
  const env = loadEnv({ NODE_ENV: "test", DB_PATH: ":memory:", METRICS_TOKEN, APP_URL: "https://overrule.test" });
  ctx = await buildContext(env, { providers: { claude: provider, claudeFast: provider } });
  app = createApp(ctx);
  client = new Client(app);
});

describe("occupations", () => {
  test("search suggests the launch occupations and finds a job title", async () => {
    const suggested = await client.json<{ results: OccupationHit[] }>("/api/occupations?q=");
    expect(suggested.results.map((r) => r.soc)).toContain(MARKETING);

    const found = await client.json<{ results: OccupationHit[] }>("/api/occupations?q=marketing%20manager");
    expect(found.results[0]?.soc).toBe(MARKETING);
  });

  test("an occupation lists its tasks, Core first, with no session needed", async () => {
    const detail = await client.json<OccupationDetail>(`/api/occupations/${MARKETING}`);
    expect(detail.tasks.length).toBeGreaterThan(10);
    expect(detail.tasks[0]?.type).toBe("Core");
    expect((await client.request("/api/occupations/99-9999.99")).status).toBe(404);
  });
});

describe("the product path", () => {
  let drillId = "";
  let result: AttemptResult;

  test("the map needs a scan first", async () => {
    expect((await client.request("/api/map")).status).toBe(409);
    const daily = await client.json<DailyStatus>("/api/daily");
    expect(daily.state).toBe("needs_scan");
  });

  test("scan → personal exposure map", async () => {
    const detail = await client.json<OccupationDetail>(`/api/occupations/${MARKETING}`);
    const tasks = detail.tasks.slice(0, 6).map((task, i) => ({
      taskId: task.id,
      frequency: (["often", "sometimes", "rarely"] as const)[i % 3]!,
    }));
    expect((await client.request("/api/scan", { body: { soc: MARKETING, tasks: tasks.slice(0, 2) } })).status).toBe(400);
    await client.json("/api/scan", { body: { soc: MARKETING, tasks } });
    await client.json("/api/scan", {
      body: { soc: MARKETING, tasks, answers: { aiUse: "daily", shippedAiError: "yes" }, complete: true },
    });

    const map = await client.json<MapResponse>("/api/map");
    expect(map.occupation.title).toBe("Marketing Managers");
    expect(map.personal.taskCount).toBe(6);
    expect(map.personal.beta).toBeGreaterThanOrEqual(0);
    expect(map.personal.beta).toBeLessThanOrEqual(1);
    expect(map.personal.shares.E0 + map.personal.shares.E1 + map.personal.shares.E2).toBeCloseTo(1, 9);
    expect(map.answers.shippedAiError).toBe("yes");
    expect(map.occupationCount).toBe(923);
  });

  test("the first drill was generated and verified in the background during the scan", async () => {
    const events = await client.sse("/api/drills/next", { mode: "first" });
    const ready = events.find((e) => e.event === "ready")?.data as ReadyEvent | undefined;
    expect(ready, JSON.stringify(events)).toBeDefined();
    expect(ready!.origin).toBe("live");
    drillId = ready!.drillId;
    // The scan already started the generation: exactly one draft was requested.
    expect(modelCalls.filter((call) => call.purpose === "generate").length).toBe(1);
  });

  test("the answer key never reaches the client before submission", async () => {
    const response = await client.request(`/api/drills/${drillId}`);
    const body = await response.text();
    for (const secret of ["explanation", "correction", "numericChecks", "decoys", "looksWrongBecause", '"key"', "severity"]) {
      expect(body).not.toContain(secret);
    }
    const drill = JSON.parse(body) as DrillResponse;
    expect(drill.mode).toBe("first");
    expect(drill.drill.maxFlags).toBe(5);
    expect(drill.drill.level).toBe(2);
  });

  test("another session cannot read a personal drill", async () => {
    const stranger = new Client(app);
    expect((await stranger.request(`/api/drills/${drillId}`)).status).toBe(404);
  });

  test("submission is scored by code against the key, and moves the Judgment Score", async () => {
    result = await client.json<AttemptResult>(`/api/drills/${drillId}/submit`, {
      body: {
        flags: [
          { targetId: "s3", type: "numbers", why: "3.0/2.6 is about 15%, not 40%" },
          { targetId: "s6", type: "logic", why: "pinterest is the weakest channel" },
          { targetId: "s4", type: "numbers" },
          { targetId: "s1", type: "facts" },
          { targetId: "does-not-exist", type: "risk" },
        ],
        elapsedMs: 187_000,
      },
    });
    // 31 (s3) + 38 (s6) − 8 (decoy) − 5 (false flag) = 56 of 31 + 31 + 41.
    expect(result.points).toBe(56);
    expect(result.maxPoints).toBe(103);
    expect(result.caught).toBe(2);
    expect(result.total).toBe(3);
    expect(result.falseFlags).toBe(1);
    expect(result.decoyFlags).toBe(1);
    expect(result.whyGradedBy).toBe("llm");
    expect(result.isFirstAttempt).toBe(true);
    expect(result.rating.before).toBe(1000);
    expect(result.rating.after).toBe(result.rating.before + result.rating.delta);
    expect(result.streak).toBe(1);
    const kinds: string[] = result.annotations.map((a) => a.kind).sort();
    expect(kinds).toEqual(["caught", "caught", "decoy_flagged", "false_flag", "missed"]);
    expect(result.cues.length).toBe(3);
    expect(result.share.text).toContain("Overrule · Practice · Marketing");
  });

  test("submitting twice returns the same attempt", async () => {
    const again = await client.json<AttemptResult>(`/api/drills/${drillId}/submit`, { body: { flags: [] } });
    expect(again.attemptId).toBe(result.attemptId);
    const stored = await client.json<AttemptResult>(`/api/attempts/${result.attemptId}`);
    expect(stored.points).toBe(56);
  });

  test("the dashboard reflects the attempt", async () => {
    const me = await client.json<MeResponse>("/api/me");
    expect(me.hasScan).toBe(true);
    expect(me.attemptsCount).toBe(1);
    expect(me.rating).toBe(result.rating.after);
    expect(me.history.length).toBe(1);
    expect(me.byType.numbers).toEqual({ appeared: 1, caught: 1 });
    expect(me.byType.facts).toEqual({ appeared: 1, caught: 0 });
    expect(me.falseFlagRate).toBeCloseTo(0.5, 9);
    expect(me.isPro).toBe(false);
    expect(me.percentile).toEqual({ locked: true, players: 0, needed: 20 });
    expect(me.debrief?.lines).toEqual([]);
  });

  test("practice and reports are Pro features; the demo checkout starts a trial", async () => {
    const gated = await client.sse("/api/drills/next", { mode: "practice" });
    expect(gated.at(-1)).toEqual({ event: "failed", data: { error: "pro_required" } });
    expect((await client.request("/api/reports", { method: "POST", body: {} })).status).toBe(402);

    const checkout = await client.json<CheckoutResponse>("/api/checkout", { body: { plan: "annual" } });
    expect(checkout.plan).toBe("trial");

    const me = await client.json<MeResponse>("/api/me");
    expect(me.isPro).toBe(true);
    expect(me.debrief?.lines.length).toBeGreaterThan(0);

    // A practice drill is generated on request: the stream reports the real stages, then the drill.
    const practice = await client.sse("/api/drills/next", { mode: "practice" });
    const stages = practice.filter((e) => e.event === "stage").map((e) => (e.data as { stage: string }).stage);
    expect(stages).toEqual(["drafting", "verifying"]);
    const ready = practice.find((e) => e.event === "ready")?.data as ReadyEvent | undefined;
    expect(ready?.drillId).toBeDefined();
    expect(ready!.drillId).not.toBe(drillId);
  });

  test("a review report is frozen and served as a public page", async () => {
    const report = await client.json<ReportResponse>("/api/reports", { method: "POST", body: {} });
    const page = await new Client(app).request(report.path);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Practice record generated by Overrule. Not an employer certification.");
    expect(html).toContain("Marketing Managers");
    expect(html).toContain('content="noindex, nofollow"');
    expect((await client.request("/r/unknown-report")).status).toBe(404);
  });

  test("the calendar reminder is a daily recurring event", async () => {
    const response = await client.request("/api/calendar.ics");
    expect(response.headers.get("content-type")).toContain("text/calendar");
    const ics = await response.text();
    expect(ics).toContain("RRULE:FREQ=DAILY");
    expect(ics).toContain("https://overrule.test/daily");
  });
});

describe("events, surveys and metrics", () => {
  test("client events and surveys are validated", async () => {
    await client.json("/api/events", { body: { name: "landing_view" } });
    expect((await client.request("/api/events", { body: { name: "made_up_event" } })).status).toBe(400);
    await client.json("/api/survey", { body: { kind: "micro", shippedAiError: "yes", wouldPay: "maybe" } });
    expect((await client.request("/api/survey", { body: { kind: "micro", wouldPay: "always" } })).status).toBe(400);
  });

  test("/metrics is closed without the token and counts the funnel with it", async () => {
    expect((await client.request("/metrics")).status).toBe(401);
    expect((await client.request("/metrics?token=wrong")).status).toBe(401);

    const metrics = await client.json<{
      sessions: { total: number; trials: number };
      funnel: Array<{ event: string; sessions: number }>;
      microSurvey: { n: number };
      llm: { draftsAccepted: number; spend: { usd: number; budgetUsd: number; remainingUsd: number } };
    }>(`/metrics?token=${METRICS_TOKEN}&format=json`);
    const reached = Object.fromEntries(metrics.funnel.map((step) => [step.event, step.sessions]));
    expect(reached["scan_complete"]).toBe(1);
    expect(reached["drill_submit"]).toBe(1);
    expect(reached["trial_start"]).toBe(1);
    expect(metrics.sessions.trials).toBe(1);
    expect(metrics.microSurvey.n).toBe(1);
    expect(metrics.llm.draftsAccepted).toBeGreaterThanOrEqual(2);
    // Every model call is priced: the estimate is positive and sits under the ceiling.
    expect(metrics.llm.spend.usd).toBeGreaterThan(0);
    expect(metrics.llm.spend.budgetUsd).toBe(20);
    expect(metrics.llm.spend.remainingUsd).toBeCloseTo(20 - metrics.llm.spend.usd, 6);

    const page = await (await client.request(`/metrics?token=${METRICS_TOKEN}`)).text();
    expect(page).toContain("Funnel (unique sessions)");
    expect(page).toContain("Model spend (estimate)");
  });

  test("automated browsers are tagged internal and kept out of the metrics", async () => {
    const before = await client.json<{ sessions: { total: number } }>(`/metrics?token=${METRICS_TOKEN}&format=json`);
    const bot = await app.request("/api/me", { headers: { "user-agent": "Mozilla/5.0 HeadlessChrome/159.0" } });
    expect(bot.status).toBe(200);
    const after = await client.json<{ sessions: { total: number } }>(`/metrics?token=${METRICS_TOKEN}&format=json`);
    expect(after.sessions.total).toBe(before.sessions.total);
  });
});

describe("when the model providers are down", () => {
  test("the verified pool is served at once, and the provider is not asked again during the cooldown", async () => {
    let calls = 0;
    const broken: StructuredProvider = {
      name: "claude",
      model: "fake-model",
      async generate() {
        calls++;
        throw new Error("credit balance is too low");
      },
    };
    const env = loadEnv({ NODE_ENV: "test", DB_PATH: ":memory:", APP_URL: "https://overrule.test" });
    const downCtx = await buildContext(env, { providers: { claude: broken } });
    // The committed pool (data/pool) is what keeps the product alive in this situation.
    expect(downCtx.pool.for(MARKETING).length).toBeGreaterThan(0);
    const downApp = createApp(downCtx);

    const scanAndStart = async (): Promise<ReadyEvent> => {
      const visitor = new Client(downApp);
      const detail = await visitor.json<OccupationDetail>(`/api/occupations/${MARKETING}`);
      const tasks = detail.tasks.slice(0, 4).map((task) => ({ taskId: task.id, frequency: "often" as const }));
      await visitor.json("/api/scan", { body: { soc: MARKETING, tasks, complete: true } });
      const events = await visitor.sse("/api/drills/next", { mode: "first" });
      // The person is told the truth: this drill comes from the pre-verified pool.
      expect(events.some((e) => e.event === "stage" && (e.data as { stage: string }).stage === "pool")).toBe(true);
      return events.find((e) => e.event === "ready")!.data as ReadyEvent;
    };

    expect((await scanAndStart()).origin).toBe("pool");
    const callsAfterFirstVisitor = calls;
    expect(callsAfterFirstVisitor).toBeGreaterThan(0);

    expect((await scanAndStart()).origin).toBe("pool");
    expect(calls).toBe(callsAfterFirstVisitor);
  });

  test("internal traffic never spends model budget", async () => {
    let calls = 0;
    const counting: StructuredProvider = {
      name: "claude",
      model: "fake-model",
      async generate() {
        calls++;
        throw new Error("should not be called");
      },
    };
    const env = loadEnv({ NODE_ENV: "test", DB_PATH: ":memory:", APP_URL: "https://overrule.test" });
    const internalApp = createApp(await buildContext(env, { providers: { claude: counting } }));
    const headers = { "user-agent": "Mozilla/5.0 HeadlessChrome/159.0", "content-type": "application/json" };
    const detail = (await (await internalApp.request(`/api/occupations/${MARKETING}`)).json()) as OccupationDetail;
    const tasks = detail.tasks.slice(0, 4).map((task) => ({ taskId: task.id, frequency: "often" }));
    const response = await internalApp.request("/api/scan", {
      method: "POST",
      headers,
      body: JSON.stringify({ soc: MARKETING, tasks, complete: true }),
    });
    expect(response.status).toBe(200);
    await Bun.sleep(20);
    expect(calls).toBe(0);
  });
});

describe("an occupation without a pool", () => {
  const NURSES = "29-1141.00";

  test("today's Daily Catch is prepared when the scan is finished, so opening it is instant", async () => {
    const calls: StructuredRequest[] = [];
    const provider = fakeProvider(await levelTwoDraft(), calls);
    const generations = () => calls.filter((call) => call.purpose === "generate").length;
    const env = loadEnv({ NODE_ENV: "test", DB_PATH: ":memory:", APP_URL: "https://overrule.test" });
    // 10:00 in New York on the day of Daily Catch #1, which is a level-2 drill like the fake draft.
    const nurseCtx = await buildContext(env, {
      now: () => new Date("2026-11-14T15:00:00Z"),
      providers: { claude: provider },
    });
    expect(nurseCtx.pool.for(NURSES)).toEqual([]);
    const visitor = new Client(createApp(nurseCtx));

    const detail = await visitor.json<OccupationDetail>(`/api/occupations/${NURSES}`);
    const tasks = detail.tasks.slice(0, 4).map((task) => ({ taskId: task.id, frequency: "often" as const }));
    await visitor.json("/api/scan", { body: { soc: NURSES, tasks } });
    expect(generations()).toBe(1); // the first personal drill, as soon as the tasks are known
    await visitor.json("/api/scan", { body: { soc: NURSES, tasks, complete: true } });
    expect(generations()).toBe(2); // plus today's shared drill, once the scan is finished
    await Bun.sleep(20);

    const daily = await visitor.json<DailyStatus>("/api/daily");
    expect(daily.state).toBe("available");
    expect(daily.drillId).toBeDefined();
    const events = await visitor.sse("/api/drills/next", { mode: "daily" });
    expect(events.find((e) => e.event === "ready")!.data).toEqual({ drillId: daily.drillId!, origin: "live" });
    // Nobody had to wait, and nothing was generated twice.
    expect(events.some((e) => e.event === "stage")).toBe(false);
    expect(generations()).toBe(2);
  });

  test("a preparation that fails is not paid for again on every page view", async () => {
    let calls = 0;
    // A model whose drafts never pass the verifier.
    const hopeless: StructuredProvider = {
      name: "claude",
      model: "fake-model",
      async generate() {
        calls++;
        return { data: { artifact: "not a drill" }, inputTokens: 100, outputTokens: 100 };
      },
    };
    let nowMs = Date.parse("2026-11-14T15:00:00Z");
    const env = loadEnv({ NODE_ENV: "test", DB_PATH: ":memory:", APP_URL: "https://overrule.test" });
    const failingCtx = await buildContext(env, { now: () => new Date(nowMs), providers: { claude: hopeless } });
    const visitor = new Client(createApp(failingCtx));
    const detail = await visitor.json<OccupationDetail>(`/api/occupations/${NURSES}`);
    const tasks = detail.tasks.slice(0, 4).map((task) => ({ taskId: task.id, frequency: "often" as const }));
    await visitor.json("/api/scan", { body: { soc: NURSES, tasks, complete: true } });
    await Bun.sleep(20);
    // A draft and one retry for the personal drill, and the same for today's shared drill.
    expect(calls).toBe(4);

    // Later page views do not start another attempt, even once the provider cooldown is over…
    nowMs += 5 * 60_000;
    expect((await visitor.json<DailyStatus>("/api/daily")).state).toBe("available");
    await visitor.json<DailyStatus>("/api/daily");
    await Bun.sleep(20);
    expect(calls).toBe(4);
    // …until half an hour has passed.
    nowMs += 30 * 60_000;
    await visitor.json<DailyStatus>("/api/daily");
    await Bun.sleep(20);
    expect(calls).toBe(6);
  });

  test("our own traffic never starts the shared drill", async () => {
    const calls: StructuredRequest[] = [];
    const provider = fakeProvider(await levelTwoDraft(), calls);
    const env = loadEnv({ NODE_ENV: "test", DB_PATH: ":memory:", APP_URL: "https://overrule.test" });
    const internalApp = createApp(await buildContext(env, { providers: { claude: provider } }));
    const headers = { "user-agent": "Mozilla/5.0 HeadlessChrome/159.0", "content-type": "application/json" };
    const detail = (await (await internalApp.request(`/api/occupations/${NURSES}`)).json()) as OccupationDetail;
    const tasks = detail.tasks.slice(0, 4).map((task) => ({ taskId: task.id, frequency: "often" }));
    const scan = await internalApp.request("/api/scan", {
      method: "POST",
      headers,
      body: JSON.stringify({ soc: NURSES, tasks, complete: true }),
    });
    expect(scan.status).toBe(200);
    const cookie = scan.headers.getSetCookie()[0]!.split(";")[0]!;
    expect((await internalApp.request("/api/daily", { headers: { ...headers, cookie } })).status).toBe(200);
    await Bun.sleep(20);
    expect(calls.length).toBe(0);
  });
});

describe("server-rendered pages", () => {
  test("an SEO page is rendered for an occupation, and unknown slugs are 404", async () => {
    const page = await client.request("/will-ai-replace/marketing-managers");
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Will AI replace Marketing Managers?");
    expect((await client.request("/will-ai-replace/not-a-job")).status).toBe(404);
  });

  test("sitemap and robots are served", async () => {
    const sitemap = await (await client.request("/sitemap.xml")).text();
    expect(sitemap).toContain("https://overrule.test/will-ai-replace/marketing-managers");
    expect(await (await client.request("/robots.txt")).text()).toContain("Sitemap: https://overrule.test/sitemap.xml");
  });
});
