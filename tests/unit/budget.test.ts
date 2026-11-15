/**
 * The dollar ceiling on model spend: prices, the estimate built from the ledger of
 * model calls, and what the product does once the ceiling is reached.
 */
import { describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { createApp } from "../../src/server/app";
import { buildContext } from "../../src/server/bootstrap";
import { openDatabase } from "../../src/server/db";
import { loadEnv } from "../../src/server/env";
import { estimateCostUsd, priceOf } from "../../src/server/llm/pricing";
import type { LlmCallRecord, StructuredProvider } from "../../src/server/llm/types";
import { createLlmLogger } from "../../src/server/repos/llmCalls";
import { GENERATION_RESERVE_USD, ModelBudget, modelSpend } from "../../src/server/services/budget";
import type { AttemptResult, DrillResponse, OccupationDetail, ReadyEvent } from "../../src/shared/api";

const MARKETING = "11-2021.00";
const NOW = () => new Date("2026-11-15T12:00:00Z");

function ledger(records: LlmCallRecord[]) {
  const db = openDatabase(":memory:");
  const log = createLlmLogger(db, NOW);
  for (const record of records) log(record);
  return db;
}

const call = (overrides: Partial<LlmCallRecord>): LlmCallRecord => ({
  purpose: "generate",
  provider: "claude",
  model: "claude-sonnet-5-5",
  ms: 30_000,
  ok: true,
  ...overrides,
});

describe("prices", () => {
  test("a real generation costs what the price list says", () => {
    // 4,270 input and 5,070 output tokens on Claude Sonnet 5.5 at $2 / $10 per million.
    expect(estimateCostUsd("claude-sonnet-5-5", 4_270, 5_070)).toBeCloseTo(0.05924, 6);
    expect(estimateCostUsd("claude-haiku-5-5", 963, 370)).toBeCloseTo(0.0002813, 7);
  });

  test("a model that is not in the table is priced at the highest rate, so the estimate errs high", () => {
    const unknown = priceOf("some-future-model");
    for (const model of ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "gemini-3.5-flash"]) {
      expect(unknown.inputPerMTok).toBeGreaterThanOrEqual(priceOf(model).inputPerMTok);
      expect(unknown.outputPerMTok).toBeGreaterThanOrEqual(priceOf(model).outputPerMTok);
    }
  });
});

describe("spend estimate", () => {
  test("adds up every call in the ledger, including drafts the verifier rejected", () => {
    const db = ledger([
      call({ inputTokens: 4_000, outputTokens: 5_000 }),
      call({ ok: false, error: "verify: numeric_mismatch", inputTokens: 5_000, outputTokens: 6_000 }),
      call({ purpose: "grade_why", model: "claude-haiku-5-5", inputTokens: 1_000, outputTokens: 400 }),
    ]);
    const spend = modelSpend(db, 20);
    const sonnet = spend.lines.find((line) => line.model === "claude-sonnet-5-5")!;
    expect(sonnet).toMatchObject({ calls: 2, inputTokens: 9_000, outputTokens: 11_000 });
    expect(sonnet.usd).toBeCloseTo(0.128, 6);
    expect(spend.usd).toBeCloseTo(0.128 + 0.0003, 6);
    expect(spend.remainingUsd).toBeCloseTo(20 - spend.usd, 6);
    expect(spend.lines[0]!.model).toBe("claude-sonnet-5-5"); // most expensive first
  });

  test("a failed call without usage is free, but a timed-out call is charged at its ceiling", () => {
    const refused = ledger([call({ ok: false, error: "claude 400: credit balance is too low" })]);
    expect(modelSpend(refused, 20).usd).toBe(0);

    const timedOut = ledger([call({ ok: false, error: "claude: timed out" })]);
    // 8,000 input and 12,000 output tokens assumed: 0.016 + 0.12.
    expect(modelSpend(timedOut, 20).usd).toBeCloseTo(0.136, 6);
  });

  test("the budget allows a call only while its worst case still fits", () => {
    const db = ledger([call({ inputTokens: 100_000, outputTokens: 80_000 })]); // $1.00
    const budget = new ModelBudget(db, 1.5);
    expect(budget.spend().usd).toBeCloseTo(1, 6);
    expect(budget.allows(0.5)).toBe(true);
    expect(budget.allows(0.51)).toBe(false);
    expect(new ModelBudget(db, 1).allows(GENERATION_RESERVE_USD)).toBe(false);
  });
});

describe("when the budget is spent", () => {
  async function visitor(app: Hono) {
    const cookies = new Map<string, string>();
    return async (path: string, body?: unknown): Promise<Response> => {
      const headers: Record<string, string> = { "user-agent": "Mozilla/5.0 (test browser)" };
      if (cookies.size > 0) headers["cookie"] = [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
      if (body !== undefined) headers["content-type"] = "application/json";
      const response = await app.request(path, {
        method: body === undefined ? "GET" : "POST",
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      for (const cookie of response.headers.getSetCookie()) {
        const [name, value] = cookie.split(";")[0]!.split("=");
        cookies.set(name!, value ?? "");
      }
      return response;
    };
  }

  test("no model is called: the drill comes from the verified pool and notes are graded by the heuristic", async () => {
    let calls = 0;
    const counting: StructuredProvider = {
      name: "claude",
      model: "claude-sonnet-5-5",
      async generate() {
        calls++;
        throw new Error("the budget should have stopped this call");
      },
    };
    const env = loadEnv({ NODE_ENV: "test", DB_PATH: ":memory:", APP_URL: "https://overrule.test", LLM_BUDGET_USD: "0" });
    const ctx = await buildContext(env, { providers: { claude: counting, claudeFast: counting } });
    const request = await visitor(createApp(ctx));

    const detail = (await (await request(`/api/occupations/${MARKETING}`)).json()) as OccupationDetail;
    const tasks = detail.tasks.slice(0, 4).map((task) => ({ taskId: task.id, frequency: "often" }));
    expect((await request("/api/scan", { soc: MARKETING, tasks, complete: true })).status).toBe(200);

    const stream = await (await request("/api/drills/next", { mode: "first" })).text();
    const ready = JSON.parse(/event: ready\ndata: (.+)/.exec(stream)![1]!) as ReadyEvent;
    expect(ready.origin).toBe("pool");

    expect(((await (await request(`/api/drills/${ready.drillId}`)).json()) as DrillResponse).origin).toBe("pool");
    // Flag a planted mistake and explain it: with budget left, this note would go to a model.
    const planted = ctx.drills.find(ready.drillId)!.drill.key[0]!;
    const submitted = await request(`/api/drills/${ready.drillId}/submit`, {
      flags: [{ targetId: planted.targetId, type: planted.type, why: "the figures do not add up" }],
    });
    expect(submitted.status).toBe(200);
    const result = (await submitted.json()) as AttemptResult;
    expect(result.caught).toBe(1);
    expect(result.whyGradedBy).toBe("heuristic");
    expect(calls).toBe(0);
  });

  test("the default ceiling is 20 dollars and can be set from the environment", () => {
    expect(loadEnv({}).LLM_BUDGET_USD).toBe(20);
    expect(loadEnv({ LLM_BUDGET_USD: "7.5" }).LLM_BUDGET_USD).toBe(7.5);
    expect(() => loadEnv({ LLM_BUDGET_USD: "-1" })).toThrow();
  });
});
