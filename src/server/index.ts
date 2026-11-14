import { createApp } from "./app";
import { buildContext } from "./bootstrap";
import { loadEnv } from "./env";

const env = loadEnv();
const ctx = await buildContext(env);
const app = createApp(ctx);

const server = Bun.serve({
  port: env.PORT,
  hostname: "0.0.0.0",
  fetch: app.fetch,
  // Drill generation streams progress over SSE and can take up to a minute.
  idleTimeout: 120,
});

console.log(`overrule listening on :${server.port} (${env.NODE_ENV}), db ${env.DB_PATH}`);

function shutdown(): void {
  void server.stop();
  ctx.db.close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
