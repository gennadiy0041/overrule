import type { Database } from "../db";

export type RehearsalSource = "llm" | "rules";

export interface RehearsalRow {
  id: string;
  sessionId: string;
  writtenBy: RehearsalSource;
  questions: number;
  gradedBy: RehearsalSource | null;
  held: number | null;
  createdAt: string;
}

/**
 * Rehearsals and the packs that pay for them. Only counts and outcomes are kept:
 * the document a person pastes, the questions and the answers are never stored.
 */
export class RehearsalRepo {
  constructor(private readonly db: Database) {}

  create(input: { id: string; sessionId: string; writtenBy: RehearsalSource; questions: number; now: Date }): void {
    this.db
      .query("INSERT INTO rehearsals (id, session_id, written_by, questions, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(input.id, input.sessionId, input.writtenBy, input.questions, input.now.toISOString());
  }

  find(id: string): RehearsalRow | null {
    return this.db
      .query(
        `SELECT id, session_id AS sessionId, written_by AS writtenBy, questions,
                graded_by AS gradedBy, held, created_at AS createdAt
         FROM rehearsals WHERE id = ?`,
      )
      .get(id) as RehearsalRow | null;
  }

  /** Record the one scored round. Returns false when the rehearsal was already scored. */
  markGraded(id: string, gradedBy: RehearsalSource, held: number, now: Date): boolean {
    const result = this.db
      .query("UPDATE rehearsals SET graded_by = ?, held = ?, graded_at = ? WHERE id = ? AND graded_by IS NULL")
      .run(gradedBy, held, now.toISOString(), id);
    return result.changes === 1;
  }

  started(sessionId: string): number {
    return this.count("SELECT COUNT(*) AS n FROM rehearsals WHERE session_id = ?", sessionId);
  }

  /** Rehearsals a model wrote for this session since `since` (a per-person cap on model calls). */
  writtenByModelSince(sessionId: string, since: Date): number {
    return this.count(
      "SELECT COUNT(*) AS n FROM rehearsals WHERE session_id = ? AND written_by = 'llm' AND created_at >= ?",
      sessionId,
      since.toISOString(),
    );
  }

  /** The same across all sessions (a cap on the whole product). */
  writtenByModelSinceAll(since: Date): number {
    return this.count("SELECT COUNT(*) AS n FROM rehearsals WHERE written_by = 'llm' AND created_at >= ?", since.toISOString());
  }

  addPack(sessionId: string, size: number, priceUsd: number, now: Date): void {
    this.db
      .query("INSERT INTO rehearsal_packs (session_id, size, price_usd, created_at) VALUES (?, ?, ?, ?)")
      .run(sessionId, size, priceUsd, now.toISOString());
  }

  /** Rehearsals this session has paid for, used or not. */
  purchased(sessionId: string): number {
    return this.count("SELECT COALESCE(SUM(size), 0) AS n FROM rehearsal_packs WHERE session_id = ?", sessionId);
  }

  private count(sql: string, ...params: string[]): number {
    return (this.db.query(sql).get(...params) as { n: number }).n;
  }
}
