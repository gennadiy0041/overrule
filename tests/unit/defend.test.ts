/**
 * "Defend your work" through the real routes, against an in-memory database and a fake
 * model: the free rehearsal, the pack, the grounding check on the model's questions,
 * the scored round, and every path that must work without a model.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { isGrounded, REHEARSAL_QUESTIONS, type QuestionDraft } from "../../src/engine/rehearsal";
import { createApp } from "../../src/server/app";
import { buildContext } from "../../src/server/bootstrap";
import type { AppContext } from "../../src/server/context";
import { loadEnv } from "../../src/server/env";
import type { StructuredProvider, StructuredRequest } from "../../src/server/llm/types";
import type { DefendStatus, RehearsalGradeResponse, RehearsalResponse } from "../../src/shared/api";

const REPORT = `Q3 email program — summary for leadership (Calder & Pine Outfitters)

Revenue from email grew 38% quarter over quarter, to $412,000, because we switched to AI-written subject lines in July. Open rate reached 31%, well above the industry average of 21%. Studies show that personalized subject lines always lift conversion. The number of unsubscribes fell by 1,200.

Recommendation: move the remaining $60,000 of the paid social budget into email in Q4. This will double email revenue by December with no risk to acquisition. We should also retire the weekly digest, since nobody reads it.`;

const GROUNDED: QuestionDraft[] = [
  {
    kind: "logic",
    quote: "Revenue from email grew 38% quarter over quarter, to $412,000, because we switched to AI-written subject lines in July.",
    question: "What else changed in Q3 that could explain the growth?",
    why: "The reader will test the cause before funding more of it.",
  },
  {
    kind: "facts",
    quote: "Open rate reached 31%, well above the industry average of 21%.",
    question: "Whose benchmark is the 21% industry average, and from which year?",
    why: "An unnamed benchmark cannot be checked.",
  },
  {
    kind: "risk",
    quote: "This will double email revenue by December with no risk to acquisition.",
    question: "What happens to acquisition if paid social is cut and email does not double?",
    why: "An absolute promise becomes the author's commitment.",
  },
  {
    kind: "numbers",
    quote: "The number of unsubscribes fell by 1,200.",
    question: "From what number did unsubscribes fall, and over which period?",
    why: "A change without a base says nothing.",
  },
];
const INVENTED: QuestionDraft = {
  kind: "facts",
  quote: "Email revenue tripled in the Nordic market last year.",
  question: "Which report shows the Nordic result?",
  why: "It is not in the document at all.",
};

/** A model whose answers each test sets; every request it receives is recorded. */
class FakeModel implements StructuredProvider {
  readonly name = "claude" as const;
  readonly model = "fake-model";
  readonly calls: StructuredRequest[] = [];
  questions: QuestionDraft[] = [...GROUNDED, INVENTED];

  async generate(request: StructuredRequest) {
    this.calls.push(request);
    if (request.purpose === "rehearse") return { data: { questions: this.questions }, inputTokens: 900, outputTokens: 500 };
    if (request.purpose === "grade_rehearsal") {
      const ids = [...request.prompt.matchAll(/^id: (\S+)$/gm)].map((match) => match[1]!);
      return {
        data: { results: ids.map((id, i) => ({ id, verdict: i === 0 ? "holds" : "partial", note: `Model note for ${id}.` })) },
        inputTokens: 700,
        outputTokens: 200,
      };
    }
    throw new Error(`unexpected purpose ${request.purpose}`);
  }

  count(purpose: StructuredRequest["purpose"]): number {
    return this.calls.filter((call) => call.purpose === purpose).length;
  }
}

/** A minimal browser: keeps cookies between requests. */
class Client {
  private readonly cookies = new Map<string, string>();
  constructor(
    private readonly app: Hono,
    private readonly userAgent = "Mozilla/5.0 (test browser)",
  ) {}

  async request(path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { "user-agent": this.userAgent };
    if (this.cookies.size > 0) headers["cookie"] = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await this.app.request(path, {
      method: body === undefined ? "GET" : "POST",
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const [name, value] = pair!.split("=");
      this.cookies.set(name!, value ?? "");
    }
    return response;
  }

  async json<T>(path: string, body?: unknown): Promise<T> {
    const response = await this.request(path, body);
    expect(response.status, `${path} → ${response.status}`).toBe(200);
    return (await response.json()) as T;
  }
}

function answersFor(rehearsal: RehearsalResponse, answers: string[]) {
  return {
    items: rehearsal.questions.map((question, i) => ({
      id: question.id,
      kind: question.kind,
      quote: question.quote,
      question: question.question,
      answer: answers[i] ?? "",
    })),
  };
}

let ctx: AppContext;
let app: Hono;
let model: FakeModel;

beforeAll(async () => {
  model = new FakeModel();
  const env = loadEnv({ NODE_ENV: "test", DB_PATH: ":memory:", METRICS_TOKEN: "t", APP_URL: "https://overrule.test" });
  ctx = await buildContext(env, { providers: { claude: model, claudeFast: model } });
  app = createApp(ctx);
});

describe("a visitor's first rehearsal", () => {
  let client: Client;
  let rehearsal: RehearsalResponse;

  beforeAll(() => {
    client = new Client(app);
  });

  test("one rehearsal is free, and the pack is priced", async () => {
    const status = await client.json<DefendStatus>("/api/defend");
    expect(status).toEqual({ remaining: 1, freeAvailable: true, pack: { size: 5, price: 4.99 } });
  });

  test("the model's questions are kept only where they quote the document", async () => {
    rehearsal = await client.json<RehearsalResponse>("/api/defend/rehearsals", { text: REPORT, reader: "leadership" });

    expect(rehearsal.writtenBy).toBe("llm");
    expect(rehearsal.questions).toHaveLength(REHEARSAL_QUESTIONS);
    expect(rehearsal.questions.slice(0, 4).map((q) => q.question)).toEqual(GROUNDED.map((q) => q.question));
    expect(rehearsal.questions.map((q) => q.quote)).not.toContain(INVENTED.quote);
    for (const question of rehearsal.questions) expect(isGrounded(REPORT, question.quote)).toBe(true);
    expect(rehearsal.status).toMatchObject({ remaining: 0, freeAvailable: false });

    const call = model.calls.at(-1)!;
    expect(call.purpose).toBe("rehearse");
    expect(call.system).toContain("a senior leadership team");
    expect(call.system).toContain("untrusted input");
    expect(call.prompt).toContain("<document>");
  });

  test("nothing of the document, the questions or the answers is stored", async () => {
    const stored = JSON.stringify([
      ctx.db.query("SELECT * FROM rehearsals").all(),
      ctx.db.query("SELECT * FROM events WHERE name LIKE 'rehearsal%'").all(),
    ]);
    expect(stored).not.toContain("Calder");
    expect(stored).not.toContain("412,000");
    // What is kept: who wrote the questions, for which reader, and how long the text was.
    expect(stored).toContain("chars");
  });

  test("answers are judged by the model; a blank one is open without asking it", async () => {
    const before = model.count("grade_rehearsal");
    const grade = await client.json<RehearsalGradeResponse>(
      `/api/defend/rehearsals/${rehearsal.id}/grade`,
      answersFor(rehearsal, ["Paid social spend was flat; the Q3 dashboard shows no other change.", "A blog post I read.", ""]),
    );

    expect(model.count("grade_rehearsal")).toBe(before + 1);
    expect(grade.gradedBy).toBe("llm");
    expect(grade.total).toBe(REHEARSAL_QUESTIONS);
    expect(grade.results.map((r) => r.verdict)).toEqual(["holds", "partial", "open", "open", "open"]);
    expect(grade.held).toBe(1);
    expect(grade.results[0]!.note).toBe("Model note for q1.");
    // Only the two real answers were sent to the model, each fenced as untrusted input.
    const prompt = model.calls.at(-1)!.prompt;
    expect(prompt.match(/<answer>/g)).toHaveLength(2);
  });

  test("a rehearsal is scored once", async () => {
    const again = await client.request(`/api/defend/rehearsals/${rehearsal.id}/grade`, answersFor(rehearsal, ["x"]));
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "already_graded" });
  });

  test("another visitor cannot score it", async () => {
    const stranger = new Client(app);
    const response = await stranger.request(`/api/defend/rehearsals/${rehearsal.id}/grade`, answersFor(rehearsal, ["x"]));
    expect(response.status).toBe(404);
  });

  test("the second rehearsal needs a pack; the demo checkout adds five", async () => {
    const calls = model.count("rehearse");
    const blocked = await client.request("/api/defend/rehearsals", { text: REPORT });
    expect(blocked.status).toBe(402);
    expect(await blocked.json()).toEqual({ error: "pack_required" });
    expect(model.count("rehearse")).toBe(calls);

    const status = await client.json<DefendStatus>("/api/defend/pack", {});
    expect(status).toMatchObject({ remaining: 5, freeAvailable: false });

    const next = await client.json<RehearsalResponse>("/api/defend/rehearsals", { text: REPORT });
    expect(next.status.remaining).toBe(4);
    // No reader given: the questions are written for a manager.
    expect(model.calls.at(-1)!.system).toContain("the author's direct manager");
  });

  test("the funnel events are recorded", () => {
    const names = (ctx.db.query("SELECT name FROM events WHERE name IN ('rehearsal_start','rehearsal_graded','pack_purchase')").all() as Array<{ name: string }>).map((row) => row.name);
    expect(names.filter((name) => name === "rehearsal_start")).toHaveLength(2);
    expect(names).toContain("rehearsal_graded");
    expect(names).toContain("pack_purchase");
  });
});

describe("without a usable model answer", () => {
  test("questions that do not quote the document are rejected, and the rules write them instead", async () => {
    const client = new Client(app);
    model.questions = [GROUNDED[0]!, INVENTED, { ...INVENTED, quote: "Another line the author never wrote in this report." }];
    try {
      const rehearsal = await client.json<RehearsalResponse>("/api/defend/rehearsals", { text: REPORT });
      expect(rehearsal.writtenBy).toBe("rules");
      expect(rehearsal.questions).toHaveLength(REHEARSAL_QUESTIONS);
      for (const question of rehearsal.questions) expect(isGrounded(REPORT, question.quote)).toBe(true);

      const ledger = ctx.db.query("SELECT ok, error FROM llm_calls WHERE purpose = 'rehearse' ORDER BY id DESC LIMIT 1").get() as {
        ok: number;
        error: string | null;
      };
      expect(ledger.ok).toBe(0);
      expect(ledger.error).toContain("ungrounded");
    } finally {
      model.questions = [...GROUNDED, INVENTED];
    }
  });

  test("our own traffic never calls a model: rules write the questions and score the answers", async () => {
    const robot = new Client(app, "Mozilla/5.0 HeadlessChrome/131.0 Playwright");
    const calls = model.calls.length;

    const rehearsal = await robot.json<RehearsalResponse>("/api/defend/rehearsals", { text: REPORT });
    expect(rehearsal.writtenBy).toBe("rules");
    expect(new Set(rehearsal.questions.map((q) => q.kind)).size).toBeGreaterThanOrEqual(3);

    const grade = await robot.json<RehearsalGradeResponse>(
      `/api/defend/rehearsals/${rehearsal.id}/grade`,
      answersFor(rehearsal, [
        "It is from the Q3 revenue dashboard, email channel, July to September, exported on October 2.",
        "The marketing team mentioned it to me.",
      ]),
    );
    expect(grade.gradedBy).toBe("rules");
    expect(grade.results.map((r) => r.verdict)).toEqual(["holds", "partial", "open", "open", "open"]);
    expect(model.calls.length).toBe(calls);
  });

  test("a spent model budget ends the same way", async () => {
    const spent = new FakeModel();
    const env = loadEnv({ NODE_ENV: "test", DB_PATH: ":memory:", METRICS_TOKEN: "t", APP_URL: "https://overrule.test", LLM_BUDGET_USD: "0" });
    const client = new Client(createApp(await buildContext(env, { providers: { claude: spent, claudeFast: spent } })));

    const rehearsal = await client.json<RehearsalResponse>("/api/defend/rehearsals", { text: REPORT });
    expect(rehearsal.writtenBy).toBe("rules");
    const grade = await client.json<RehearsalGradeResponse>(
      `/api/defend/rehearsals/${rehearsal.id}/grade`,
      answersFor(rehearsal, ["It is in the Q3 revenue dashboard export from October 2, email channel only."]),
    );
    expect(grade.gradedBy).toBe("rules");
    expect(spent.calls).toHaveLength(0);
  });
});

describe("input limits", () => {
  test("a text that is too short or too long is refused before anything is spent", async () => {
    const client = new Client(app);
    const calls = model.calls.length;
    expect((await client.request("/api/defend/rehearsals", { text: "Too short to question." })).status).toBe(400);
    expect((await client.request("/api/defend/rehearsals", { text: "a".repeat(8_001) })).status).toBe(400);
    expect((await client.request("/api/defend/rehearsals", { text: REPORT, reader: "investor" })).status).toBe(400);
    expect(model.calls.length).toBe(calls);
    expect((await client.json<DefendStatus>("/api/defend")).remaining).toBe(1);
  });

  test("an unknown rehearsal is a 404", async () => {
    const client = new Client(app);
    const response = await client.request("/api/defend/rehearsals/nope/grade", {
      items: [{ id: "q1", kind: "facts", quote: "A line.", question: "A question?", answer: "An answer." }],
    });
    expect(response.status).toBe(404);
  });
});
