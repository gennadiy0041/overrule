import { Hono } from "hono";
import { CheckoutRequestSchema, type CheckoutResponse } from "../../shared/api";
import { TRIAL_DAYS } from "../../shared/pricing";
import type { AppContext, AppEnv } from "../context";
import { readBody } from "../http";
import { buildMe } from "../services/profile";

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

  return app;
}
