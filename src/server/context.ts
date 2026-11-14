import type { Database } from "./db";
import type { Env } from "./env";
import type { OccupationStore } from "./occupationStore";
import type { AttemptRepo } from "./repos/attempts";
import type { DrillRepo } from "./repos/drills";
import type { EventRepo } from "./repos/events";
import type { Session, SessionRepo } from "./repos/sessions";
import type { DrillService } from "./services/drillService";
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
  drillService: DrillService;
  ssrAssets: SsrAssets;
}

/** Hono environment for routes behind the session middleware. */
export type AppEnv = { Variables: { session: Session } };
