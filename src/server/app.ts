import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { secureHeaders } from "hono/secure-headers";
import type { AppContext, AppEnv } from "./context";
import { apiError } from "./http";
import { accountRoutes } from "./routes/account";
import { drillRoutes } from "./routes/drills";
import { eventRoutes } from "./routes/events";
import { occupationRoutes } from "./routes/occupations";
import { scanRoutes } from "./routes/scan";
import { internalFlag, withSession } from "./session";

/** Relative to the process working directory (the repository root). */
const WEB_ROOT = "./dist/web";

export function createApp(ctx: AppContext): Hono {
  const app = new Hono();

  app.use("*", secureHeaders({ crossOriginResourcePolicy: false }));
  app.use("*", internalFlag(ctx));

  app.get("/api/health", (c) => {
    const row = ctx.db.query("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get() as {
      version: number;
    };
    return c.json({
      status: "ok",
      schema: row.version,
      occupations: ctx.occupations.all.length,
      llm: { claude: Boolean(ctx.env.ANTHROPIC_API_KEY), gemini: Boolean(ctx.env.GEMINI_API_KEY) },
      time: ctx.now().toISOString(),
    });
  });

  // Public reads need no session…
  app.route("/api", occupationRoutes(ctx));

  // …everything else runs behind the anonymous session cookie.
  const api = new Hono<AppEnv>();
  api.use("*", withSession(ctx));
  api.route("/", scanRoutes(ctx));
  api.route("/", drillRoutes(ctx));
  api.route("/", accountRoutes(ctx));
  api.route("/", eventRoutes(ctx));
  api.all("*", (c) => apiError(c, 404, "not_found"));
  app.route("/api", api);

  // Hashed build assets are immutable; everything else falls back to the SPA shell.
  app.use(
    "/assets/*",
    serveStatic({
      root: WEB_ROOT,
      onFound: (_path, c) => c.header("Cache-Control", "public, max-age=31536000, immutable"),
    }),
  );
  app.use("*", serveStatic({ root: WEB_ROOT }));
  app.get("*", serveStatic({ path: `${WEB_ROOT}/index.html` }));

  return app;
}
