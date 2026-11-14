import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import type { Database } from "./db";
import type { Env } from "./env";

export interface AppDeps {
  env: Env;
  db: Database;
}

const WEB_ROOT = "./dist/web";

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.get("/api/health", (c) => {
    const row = deps.db.query("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get() as {
      version: number;
    };
    return c.json({
      status: "ok",
      schema: row.version,
      llm: { claude: Boolean(deps.env.ANTHROPIC_API_KEY), gemini: Boolean(deps.env.GEMINI_API_KEY) },
      time: new Date().toISOString(),
    });
  });

  app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

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
