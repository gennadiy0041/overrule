import { join } from "node:path";
import type { AppContext } from "./context";
import { openDatabase } from "./db";
import type { Env } from "./env";
import { createProviders } from "./llm";
import { loadOccupationStore } from "./occupationStore";
import { AttemptRepo } from "./repos/attempts";
import { DrillRepo } from "./repos/drills";
import { EventRepo } from "./repos/events";
import { ReportRepo } from "./repos/reports";
import { createLlmLogger } from "./repos/llmCalls";
import { RehearsalRepo } from "./repos/rehearsals";
import { SessionRepo } from "./repos/sessions";
import { ModelBudget } from "./services/budget";
import { DrillService, type Providers } from "./services/drillService";
import { loadPool, syncPool } from "./services/pool";
import { RehearsalService } from "./services/rehearsalService";
import { loadSsrAssets } from "./ssr/layout";

export const DATA_DIR = join(import.meta.dir, "..", "..", "data");
export const WEB_ROOT = join(import.meta.dir, "..", "..", "dist", "web");

export interface BootstrapOptions {
  /** Injected clock (tests, demo seeding). Defaults to the wall clock. */
  now?: () => Date;
  /** Replace the model providers (tests run without network). */
  providers?: Providers;
}

/** Wire the application once: database, data, drill pool, model providers, services. */
export async function buildContext(env: Env, options: BootstrapOptions = {}): Promise<AppContext> {
  const now = options.now ?? (() => new Date());
  const db = openDatabase(env.DB_PATH);
  const occupations = await loadOccupationStore(DATA_DIR);

  const sessions = new SessionRepo(db);
  const events = new EventRepo(db);
  const drills = new DrillRepo(db);
  const attempts = new AttemptRepo(db);

  const pool = loadPool(DATA_DIR);
  syncPool(pool, drills, now());
  for (const rejected of pool.rejected) console.warn(`pool drill rejected by verifyDrill — ${rejected}`);

  const budget = new ModelBudget(db, env.LLM_BUDGET_USD);
  const providers = options.providers ?? createProviders(env);
  const llmLog = createLlmLogger(db, now);
  const drillService = new DrillService({
    env,
    now,
    occupations,
    sessions,
    drills,
    attempts,
    events,
    pool,
    providers,
    llmLog,
    budget,
  });
  const rehearsalService = new RehearsalService({
    now,
    rehearsals: new RehearsalRepo(db),
    events,
    providers,
    llmLog,
    budget,
  });

  console.log(`data: ${occupations.all.length} occupations · pool: ${pool.size} verified drills`);
  return {
    env,
    db,
    now,
    occupations,
    sessions,
    events,
    drills,
    attempts,
    reports: new ReportRepo(db),
    pool,
    budget,
    drillService,
    rehearsalService,
    ssrAssets: loadSsrAssets(WEB_ROOT),
  };
}
