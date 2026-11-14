import { Hono } from "hono";
import { MIN_PERSONAL_TASKS } from "../../engine/exposure";
import { ScanRequestSchema } from "../../shared/api";
import type { AppContext, AppEnv } from "../context";
import { apiError, readBody } from "../http";
import type { UserTask } from "../repos/sessions";
import { buildExposureMap } from "../services/exposureMap";

export function scanRoutes(ctx: AppContext): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  /**
   * Called twice by the scan: after the tasks are picked, and at the end with the
   * remaining answers. The first call already starts preparing the first drill, so
   * it is ready by the time the person reaches their map.
   */
  app.post("/scan", async (c) => {
    const body = await readBody(c, ScanRequestSchema);
    if (!body.ok) return body.response;

    const occupation = ctx.occupations.get(body.data.soc);
    if (!occupation) return apiError(c, 404, "unknown_occupation");

    // Keep only tasks that belong to this occupation, one entry per task.
    const known = new Set(occupation.tasks.map((t) => t.id));
    const selected = new Map<number, UserTask>();
    for (const task of body.data.tasks) if (known.has(task.taskId)) selected.set(task.taskId, task);
    if (selected.size < MIN_PERSONAL_TASKS) {
      return apiError(c, 400, "too_few_tasks", `Pick at least ${MIN_PERSONAL_TASKS} tasks`);
    }

    const session = c.get("session");
    const answers = { ...session.scanAnswers, ...body.data.answers };
    ctx.sessions.saveScan(session.id, occupation.soc, [...selected.values()], answers);
    ctx.events.log(session.id, body.data.complete ? "scan_complete" : "task_select", ctx.now(), {
      soc: occupation.soc,
      tasks: selected.size,
    });

    ctx.drillService.prepareFirstDrill(session.id);
    return c.json({ ok: true });
  });

  app.get("/map", (c) => {
    const session = c.get("session");
    const occupation = session.soc ? ctx.occupations.get(session.soc) : undefined;
    const tasks = ctx.sessions.tasks(session.id);
    if (!occupation || tasks.length < MIN_PERSONAL_TASKS) return apiError(c, 409, "scan_required");
    return c.json(buildExposureMap(occupation, tasks, session.scanAnswers, ctx.occupations));
  });

  return app;
}
