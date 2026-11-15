import { Hono, type Context } from "hono";
import { RehearsalGradeRequestSchema, RehearsalRequestSchema } from "../../shared/api";
import type { AppContext, AppEnv } from "../context";
import { apiError, readBody } from "../http";
import { ServiceError } from "../services/drillService";

function fail(c: Context, error: unknown): Response {
  if (error instanceof ServiceError) return apiError(c, error.status, error.code);
  console.error("defend route failed:", error instanceof Error ? error.message : error);
  return apiError(c, 500, "internal_error");
}

/** "Defend your work": rehearse the questions a reader will ask before a document is sent. */
export function defendRoutes(ctx: AppContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/defend", (c) => c.json(ctx.rehearsalService.status(c.get("session"))));

  app.post("/defend/rehearsals", async (c) => {
    const body = await readBody(c, RehearsalRequestSchema);
    if (!body.ok) return body.response;
    try {
      return c.json(await ctx.rehearsalService.start(c.get("session"), body.data.text, body.data.reader ?? "manager"));
    } catch (error) {
      return fail(c, error);
    }
  });

  app.post("/defend/rehearsals/:id/grade", async (c) => {
    const body = await readBody(c, RehearsalGradeRequestSchema);
    if (!body.ok) return body.response;
    try {
      return c.json(await ctx.rehearsalService.grade(c.get("session"), c.req.param("id"), body.data.items));
    } catch (error) {
      return fail(c, error);
    }
  });

  /**
   * Demo checkout, like the subscription: no card fields, no payment collected.
   * It adds a pack to this session and records the purchase event.
   */
  app.post("/defend/pack", (c) => c.json(ctx.rehearsalService.buyPack(c.get("session"))));

  return app;
}
