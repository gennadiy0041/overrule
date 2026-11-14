import { z } from "zod";

/**
 * All configuration comes from the environment and is validated once at boot.
 * API keys never leave the server; nothing here is exposed to the client.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  /** SQLite file. On Railway this lives on the /data volume. */
  DB_PATH: z.string().default(".local/overrule.db"),
  /** Public origin, used for share links, sitemap and Open Graph tags. */
  APP_URL: z.string().default("http://localhost:3000"),

  ANTHROPIC_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  CLAUDE_MODEL: z.string().default("claude-sonnet-5-5"),
  /** Model used to grade the short "why" notes; defaults to CLAUDE_MODEL. */
  CLAUDE_FAST_MODEL: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-3.5-flash"),

  /** Guards /metrics. Without it the page is disabled. */
  METRICS_TOKEN: z.string().optional(),

  /** Live drill generations allowed per session per ET day; beyond it we serve the pool. */
  GEN_LIMIT_PER_SESSION: z.coerce.number().int().nonnegative().default(12),
  /** Live drill generations allowed across all sessions per ET day. */
  GEN_LIMIT_GLOBAL: z.coerce.number().int().nonnegative().default(600),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${z.prettifyError(parsed.error)}`);
  }
  return { ...parsed.data, APP_URL: parsed.data.APP_URL.replace(/\/+$/, "") };
}
