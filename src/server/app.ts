import { existsSync, readFileSync } from "node:fs";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { serveStatic } from "hono/bun";
import { secureHeaders } from "hono/secure-headers";
import type { AppContext, AppEnv } from "./context";
import { apiError } from "./http";
import { accountRoutes } from "./routes/account";
import { drillRoutes } from "./routes/drills";
import { eventRoutes } from "./routes/events";
import { occupationRoutes } from "./routes/occupations";
import { pageRoutes } from "./routes/pages";
import { scanRoutes } from "./routes/scan";
import { createDemoSession } from "./services/demo";
import { internalFlag, isInternalRequest, setSessionCookie, withSession } from "./session";

/** The largest legitimate request (a scan with 60 tasks) is a few kilobytes. */
const MAX_BODY_BYTES = 32 * 1024;

/** Relative to the process working directory (the repository root). */
const WEB_ROOT = "./dist/web";

/**
 * The SPA shell with absolute Open Graph URLs. Link previews (LinkedIn, messengers)
 * ignore relative image paths, and the public origin is only known at runtime.
 */
function loadShell(appUrl: string): string | null {
  const path = `${WEB_ROOT}/index.html`;
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8")
    .replace('content="/og.png"', `content="${appUrl}/og.png"`)
    .replace('<meta property="og:type"', `<meta property="og:url" content="${appUrl}/" />
    <meta property="og:type"`);
}

export function createApp(ctx: AppContext): Hono {
  const app = new Hono();

  app.use("*", secureHeaders({ crossOriginResourcePolicy: false }));
  app.use("*", internalFlag(ctx));
  app.use("/api/*", bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => apiError(c, 400, "body_too_large") }));

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

  // …and neither does entering the demo: it replaces the session with a fresh copy of the demo profile.
  app.post("/api/demo", (c) => {
    const session = createDemoSession(ctx, {
      userAgent: c.req.header("user-agent") ?? null,
      isInternal: isInternalRequest(c),
    });
    setSessionCookie(c, ctx, session.id);
    return c.json({ ok: true });
  });

  // …everything else runs behind the anonymous session cookie.
  const api = new Hono<AppEnv>();
  api.use("*", withSession(ctx));
  api.route("/", scanRoutes(ctx));
  api.route("/", drillRoutes(ctx));
  api.route("/", accountRoutes(ctx));
  api.route("/", eventRoutes(ctx));
  api.all("*", (c) => apiError(c, 404, "not_found"));
  app.route("/api", api);

  // Server-rendered pages: SEO, public reports, metrics.
  app.route("/", pageRoutes(ctx));

  const shell = loadShell(ctx.env.APP_URL);
  const serveShell = (c: Context) => {
    if (shell === null) return c.text("The web app has not been built yet: run `bun run build`.", 503);
    c.header("Cache-Control", "no-cache");
    return c.html(shell);
  };
  app.get("/", serveShell);

  // Hashed build assets are immutable; everything else falls back to the SPA shell.
  app.use(
    "/assets/*",
    serveStatic({
      root: WEB_ROOT,
      onFound: (_path, c) => c.header("Cache-Control", "public, max-age=31536000, immutable"),
    }),
  );
  app.use("*", serveStatic({ root: WEB_ROOT }));
  app.get("*", serveShell);

  return app;
}
