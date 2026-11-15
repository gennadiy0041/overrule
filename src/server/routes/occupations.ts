import { Hono } from "hono";
import type { OccupationHit } from "../../shared/api";
import type { AppContext } from "../context";
import { apiError } from "../http";
import { toDetail } from "../occupationStore";

const MAX_QUERY_LENGTH = 80;

/** Public, session-less reads over the occupation data. */
export function occupationRoutes(ctx: AppContext): Hono {
  const app = new Hono();

  app.get("/occupations", (c) => {
    const query = (c.req.query("q") ?? "").slice(0, MAX_QUERY_LENGTH);
    const results: OccupationHit[] = ctx.occupations.search(query);
    // Before anything is typed the scan suggests the launch occupations and, apart from them, leadership roles.
    const leadership: OccupationHit[] = query.trim().length < 2 ? ctx.occupations.leadership : [];
    return c.json({ results, leadership });
  });

  app.get("/occupations/:soc", (c) => {
    const occupation = ctx.occupations.get(c.req.param("soc"));
    if (!occupation) return apiError(c, 404, "unknown_occupation");
    c.header("Cache-Control", "public, max-age=3600");
    return c.json(toDetail(occupation));
  });

  return app;
}
