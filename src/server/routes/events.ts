import { Hono } from "hono";
import { EventRequestSchema, SurveyRequestSchema } from "../../shared/api";
import type { AppContext, AppEnv } from "../context";
import { readBody } from "../http";

/** Funnel events reported by the browser, and survey answers. */
export function eventRoutes(ctx: AppContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/events", async (c) => {
    const body = await readBody(c, EventRequestSchema);
    if (!body.ok) return body.response;
    ctx.events.log(c.get("session").id, body.data.name, ctx.now(), body.data.props);
    return c.json({ ok: true });
  });

  app.post("/survey", async (c) => {
    const body = await readBody(c, SurveyRequestSchema);
    if (!body.ok) return body.response;
    const { kind, ...answers } = body.data;
    const session = c.get("session");
    const now = ctx.now();
    ctx.db
      .query("INSERT INTO surveys (session_id, kind, answers, created_at) VALUES (?, ?, ?, ?)")
      .run(session.id, kind, JSON.stringify(answers), now.toISOString());
    ctx.events.log(session.id, "survey_submit", now, { kind });
    return c.json({ ok: true });
  });

  return app;
}
