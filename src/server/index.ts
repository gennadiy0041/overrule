import { createApp } from "./app";
import { buildContext } from "./bootstrap";
import { loadEnv } from "./env";
import { seedDemoTemplate } from "./services/demo";

const env = loadEnv();
const ctx = await buildContext(env);
const app = createApp(ctx);

// The demo profile is replayed through the real engine at every boot (it follows the pool).
const demoAttempts = await seedDemoTemplate(ctx);
console.log(`demo profile: ${demoAttempts} simulated attempts`);

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
