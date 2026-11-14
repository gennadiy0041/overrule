import type { Drill } from "../../engine/drillSchema";
import type { DrillOrigin } from "../../shared/api";
import type { Database } from "../db";

export interface StoredDrill {
  /** The full drill, answer key included. Only `toPublicDrill(drill)` may leave the server before submission. */
  drill: Drill;
  origin: DrillOrigin;
  provider: string | null;
  model: string | null;
  /** Owner of a personal drill; null for pool drills and shared Daily Catch drills. */
  sessionId: string | null;
  createdAt: string;
}

interface DrillRow {
  payload: string;
  origin: string;
  provider: string | null;
  model: string | null;
  session_id: string | null;
  created_at: string;
}

function fromRow(row: DrillRow): StoredDrill {
  return {
    drill: JSON.parse(row.payload) as Drill,
    origin: row.origin === "pool" ? "pool" : "live",
    provider: row.provider,
    model: row.model,
    sessionId: row.session_id,
    createdAt: row.created_at,
  };
}

export class DrillRepo {
  constructor(private readonly db: Database) {}

  /** Insert, or refresh the content of an existing id (the pool is re-synced from disk at every boot). */
  upsert(stored: StoredDrill): void {
    const { drill } = stored;
    this.db
      .query(
        `INSERT INTO drills (id, soc, task_id, level, origin, provider, model, payload, session_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           soc = excluded.soc, task_id = excluded.task_id, level = excluded.level, payload = excluded.payload`,
      )
      .run(
        drill.id,
        drill.soc,
        drill.taskId,
        drill.level,
        stored.origin,
        stored.provider,
        stored.model,
        JSON.stringify(drill),
        stored.sessionId,
        stored.createdAt,
      );
  }

  find(id: string): StoredDrill | null {
    const row = this.db.query("SELECT * FROM drills WHERE id = ?").get(id) as DrillRow | null;
    return row ? fromRow(row) : null;
  }

  /** Personal drills this session has been given but not submitted yet, newest first. */
  unattemptedFor(sessionId: string): StoredDrill[] {
    const rows = this.db
      .query(
        `SELECT d.* FROM drills d
         WHERE d.session_id = ?
           AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.drill_id = d.id AND a.session_id = d.session_id)
         ORDER BY d.created_at DESC`,
      )
      .all(sessionId) as DrillRow[];
    return rows.map(fromRow);
  }

  /** Live generations since an instant — for one session, or across all of them. */
  countLiveSince(sinceIso: string, sessionId?: string): number {
    const row = (
      sessionId === undefined
        ? this.db.query("SELECT COUNT(*) AS n FROM drills WHERE origin = 'live' AND created_at >= ?").get(sinceIso)
        : this.db
            .query("SELECT COUNT(*) AS n FROM drills WHERE origin = 'live' AND created_at >= ? AND session_id = ?")
            .get(sinceIso, sessionId)
    ) as { n: number };
    return row.n;
  }

  dailyDrillId(day: string, soc: string): string | null {
    const row = this.db.query("SELECT drill_id AS id FROM daily WHERE day = ? AND soc = ?").get(day, soc) as {
      id: string;
    } | null;
    return row?.id ?? null;
  }

  /** First writer wins: a day's Daily Catch never changes once assigned. */
  assignDaily(day: string, soc: string, drillId: string): string {
    this.db.query("INSERT OR IGNORE INTO daily (day, soc, drill_id) VALUES (?, ?, ?)").run(day, soc, drillId);
    return this.dailyDrillId(day, soc) ?? drillId;
  }
}
