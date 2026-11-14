import { Hono } from "hono";
import { CheckoutRequestSchema, type CheckoutResponse, type ReportResponse } from "../../shared/api";
import { TRIAL_DAYS } from "../../shared/pricing";
import type { AppContext, AppEnv } from "../context";
import { apiError, readBody } from "../http";
import { isPro } from "../repos/sessions";
import { buildDailyReminderIcs } from "../services/calendar";
import { buildMe } from "../services/profile";
import { buildReportSnapshot, newPublicId } from "../services/report";

const DAY_MS = 24 * 60 * 60 * 1000;

export function accountRoutes(ctx: AppContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/me", (c) => c.json(buildMe(c.get("session"), ctx)));

  /**
   * Demo checkout: no card fields, no payment collected. It starts a 7-day Pro
   * trial on this session and records the funnel event, so the rest of the product
   * behaves exactly as it would after a real checkout.
   */
  app.post("/checkout", async (c) => {
    const body = await readBody(c, CheckoutRequestSchema);
    if (!body.ok) return body.response;
    const session = c.get("session");
    const now = ctx.now();
    const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * DAY_MS);
    ctx.sessions.startTrial(session.id, body.data.plan, trialEndsAt);
    ctx.events.log(session.id, "trial_start", now, { plan: body.data.plan });
    const response: CheckoutResponse = {
      plan: "trial",
      planChoice: body.data.plan,
      trialEndsAt: trialEndsAt.toISOString(),
    };
    return c.json(response);
  });

  /** Freeze the current practice record into a public, printable page (Pro). */
  app.post("/reports", (c) => {
    const session = c.get("session");
    const now = ctx.now();
    if (!isPro(session, now)) return apiError(c, 402, "pro_required");
    const occupation = session.soc ? ctx.occupations.get(session.soc) : undefined;
    const snapshot = buildReportSnapshot(occupation?.title ?? "Professional", ctx.attempts.list(session.id), now);
    if (!snapshot) return apiError(c, 409, "no_attempts", "Finish a drill first");

    const publicId = newPublicId();
    ctx.reports.insert(publicId, session.id, snapshot);
    ctx.events.log(session.id, "report_create", now);
    const response: ReportResponse = { publicId, path: `/r/${publicId}` };
    return c.json(response);
  });

  app.get("/calendar.ics", (c) => {
    c.header("Content-Type", "text/calendar; charset=utf-8");
    c.header("Content-Disposition", "attachment; filename=\"overrule-daily-catch.ics\"");
    return c.body(buildDailyReminderIcs(ctx.env.APP_URL, ctx.now()));
  });

  return app;
}
