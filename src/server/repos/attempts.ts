import type { Flag } from "../../engine/scoring";
import type { AttemptResult } from "../../shared/api";
import type { Database } from "../db";

/**
 * Attempts are stored with the complete scored result as JSON: the result page,
 * the dashboard and the review report all read the same frozen record.
 */
export class AttemptRepo {
  constructor(private readonly db: Database) {}

  insert(sessionId: string, result: AttemptResult, flags: ReadonlyArray<Flag>): void {
    this.db
      .query(
        `INSERT INTO attempts (id, session_id, drill_id, mode, day, flags, result, points, max_points, p,
                               rating_before, rating_after, elapsed_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        result.attemptId,
        sessionId,
        result.drillId,
        result.mode,
        result.day,
        JSON.stringify(flags),
        JSON.stringify(result),
        result.points,
        result.maxPoints,
        result.p,
        result.rating.before,
        result.rating.after,
        result.elapsedMs ?? null,
        result.createdAt,
      );
  }

  find(attemptId: string): { sessionId: string; result: AttemptResult } | null {
    const row = this.db.query("SELECT session_id, result FROM attempts WHERE id = ?").get(attemptId) as {
      session_id: string;
      result: string;
    } | null;
    return row ? { sessionId: row.session_id, result: JSON.parse(row.result) as AttemptResult } : null;
  }

  findForDrill(sessionId: string, drillId: string): AttemptResult | null {
    const row = this.db
      .query("SELECT result FROM attempts WHERE session_id = ? AND drill_id = ?")
      .get(sessionId, drillId) as { result: string } | null;
    return row ? (JSON.parse(row.result) as AttemptResult) : null;
  }

  /** Every attempt of a session, oldest first. */
  list(sessionId: string): AttemptResult[] {
    const rows = this.db
      .query("SELECT result FROM attempts WHERE session_id = ? ORDER BY created_at ASC")
      .all(sessionId) as Array<{ result: string }>;
    return rows.map((row) => JSON.parse(row.result) as AttemptResult);
  }

  /** Attempts with the flags exactly as submitted — used to copy the demo week. */
  listRaw(sessionId: string): Array<{ result: AttemptResult; flags: Flag[] }> {
    const rows = this.db
      .query("SELECT result, flags FROM attempts WHERE session_id = ? ORDER BY created_at ASC")
      .all(sessionId) as Array<{ result: string; flags: string }>;
    return rows.map((row) => ({
      result: JSON.parse(row.result) as AttemptResult,
      flags: JSON.parse(row.flags) as Flag[],
    }));
  }

  countOnDay(sessionId: string, day: string, mode: AttemptResult["mode"]): number {
    const row = this.db
      .query("SELECT COUNT(*) AS n FROM attempts WHERE session_id = ? AND day = ? AND mode = ?")
      .get(sessionId, day, mode) as { n: number };
    return row.n;
  }

  /**
   * Judgment Scores of real players (no demo profiles, no internal traffic) with
   * enough attempts to be meaningful — the population for percentiles.
   */
  realPlayerRatings(minAttempts: number, soc?: string): number[] {
    const base = "SELECT rating FROM sessions WHERE is_demo = 0 AND is_internal = 0 AND attempts_count >= ?";
    const rows = (
      soc === undefined
        ? this.db.query(base).all(minAttempts)
        : this.db.query(`${base} AND soc = ?`).all(minAttempts, soc)
    ) as Array<{ rating: number }>;
    return rows.map((row) => row.rating);
  }
}
