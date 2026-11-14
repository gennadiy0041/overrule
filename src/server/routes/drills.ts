import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { NextDrillRequestSchema, SubmitRequestSchema, type ReadyEvent, type StageEvent } from "../../shared/api";
import type { AppContext, AppEnv } from "../context";
import { apiError, readBody } from "../http";
import { ServiceError } from "../services/drillService";

function fail(c: Context, error: unknown): Response {
  if (error instanceof ServiceError) return apiError(c, error.status, error.code);
  console.error("drill route failed:", error instanceof Error ? error.message : error);
  return apiError(c, 500, "internal_error");
}

export function drillRoutes(ctx: AppContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  /**
   * Resolve the next drill, streaming honest progress as server-sent events:
   * `stage` events while the drill is drafted and verified, then one `ready`
   * (or `failed`). The person is never shown a provider error — the verified
   * pool is the last fallback.
   */
  app.post("/drills/next", async (c) => {
    const body = await readBody(c, NextDrillRequestSchema);
    if (!body.ok) return body.response;
    const session = c.get("session");

    return streamSSE(c, async (stream) => {
      const send = (event: "stage" | "ready" | "failed", data: StageEvent | ReadyEvent | { error: string }) =>
        stream.writeSSE({ event, data: JSON.stringify(data) });
      // Stage callbacks are synchronous; chain the writes so events keep their order.
      let queue: Promise<void> = Promise.resolve();
      const onStage = (stage: StageEvent["stage"]) => {
        queue = queue.then(() => send("stage", { stage })).catch(() => undefined);
      };
      try {
        const ready = await ctx.drillService.next(session, body.data.mode, onStage);
        await queue;
        await send("ready", ready);
      } catch (error) {
        await queue;
        await send("failed", { error: error instanceof ServiceError ? error.code : "internal_error" });
      }
    });
  });

  app.get("/drills/:id", (c) => {
    try {
      return c.json(ctx.drillService.getDrill(c.get("session"), c.req.param("id")));
    } catch (error) {
      return fail(c, error);
    }
  });

  app.post("/drills/:id/submit", async (c) => {
    const body = await readBody(c, SubmitRequestSchema);
    if (!body.ok) return body.response;
    try {
      const flags = body.data.flags.map((f) => ({ targetId: f.targetId, type: f.type, ...(f.why ? { why: f.why } : {}) }));
      return c.json(await ctx.drillService.submit(c.get("session"), c.req.param("id"), flags, body.data.elapsedMs));
    } catch (error) {
      return fail(c, error);
    }
  });

  app.get("/attempts/:id", (c) => {
    try {
      return c.json(ctx.drillService.getResult(c.get("session"), c.req.param("id")));
    } catch (error) {
      return fail(c, error);
    }
  });

  app.get("/daily", (c) => c.json(ctx.drillService.dailyStatus(c.get("session"))));

  return app;
}
