import type { Database } from "./db";
import type { Env } from "./env";
import type { OccupationStore } from "./occupationStore";
import type { AttemptRepo } from "./repos/attempts";
import type { DrillRepo } from "./repos/drills";
import type { EventRepo } from "./repos/events";
import type { ReportRepo } from "./repos/reports";
import type { Session, SessionRepo } from "./repos/sessions";
import type { ModelBudget } from "./services/budget";
import type { DrillService } from "./services/drillService";
import type { DrillPool } from "./services/pool";
import type { RehearsalService } from "./services/rehearsalService";
import type { SsrAssets } from "./ssr/layout";

/** Everything a route needs, built once at boot (and rebuilt per test with an in-memory database). */
export interface AppContext {
  env: Env;
  db: Database;
  /** Injected clock: tests and the demo seeder move time. */
  now: () => Date;
  occupations: OccupationStore;
  sessions: SessionRepo;
  events: EventRepo;
  drills: DrillRepo;
  attempts: AttemptRepo;
  reports: ReportRepo;
  /** Verified, pre-generated drills: the fallback for live generation and the Daily Catch source. */
  pool: DrillPool;
  /** Dollar ceiling on model spend, estimated from the ledger of model calls. */
  budget: ModelBudget;
  drillService: DrillService;
  /** "Defend your work": questions about a document before it is sent, and a scored round of answers. */
  rehearsalService: RehearsalService;
  ssrAssets: SsrAssets;
}

/** Hono environment for routes behind the session middleware. */
export type AppEnv = { Variables: { session: Session } };
