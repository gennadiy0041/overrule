import type { Frequency } from "../../engine/exposure";
import { START_RATING } from "../../engine/elo";
import type { ScanAnswers } from "../../shared/api";
import type { PlanChoice } from "../../shared/pricing";
import type { Database } from "../db";

export interface Session {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  soc: string | null;
  scanAnswers: ScanAnswers;
  plan: "free" | "trial";
  planChoice: PlanChoice | null;
  trialEndsAt: string | null;
  /** Judgment Score. */
  rating: number;
  attemptsCount: number;
  isDemo: boolean;
  /** Our own traffic (tests, the team) — excluded from metrics and percentiles. */
  isInternal: boolean;
}

export interface UserTask {
  taskId: number;
  frequency: Frequency;
}

interface SessionRow {
  id: string;
  created_at: string;
  last_seen_at: string;
  soc: string | null;
  scan_answers: string | null;
  plan: string;
  plan_choice: string | null;
  trial_ends_at: string | null;
  rating: number;
  attempts_count: number;
  is_demo: number;
  is_internal: number;
}

function fromRow(row: SessionRow): Session {
  return {
    id: row.id,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    soc: row.soc,
    scanAnswers: row.scan_answers ? (JSON.parse(row.scan_answers) as ScanAnswers) : {},
    plan: row.plan === "trial" ? "trial" : "free",
    planChoice: row.plan_choice === "annual" || row.plan_choice === "monthly" ? row.plan_choice : null,
    trialEndsAt: row.trial_ends_at,
    rating: row.rating,
    attemptsCount: row.attempts_count,
    isDemo: row.is_demo === 1,
    isInternal: row.is_internal === 1,
  };
}

/** Pro features are on while a trial is running. */
export function isPro(session: Pick<Session, "plan" | "trialEndsAt">, now: Date): boolean {
  return session.plan === "trial" && session.trialEndsAt !== null && new Date(session.trialEndsAt) > now;
}

export class SessionRepo {
  constructor(private readonly db: Database) {}

  find(id: string): Session | null {
    const row = this.db.query("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | null;
    return row ? fromRow(row) : null;
  }

  create(input: { id: string; now: Date; userAgent: string | null; isInternal: boolean; isDemo?: boolean }): Session {
    const at = input.now.toISOString();
    this.db
      .query(
        `INSERT INTO sessions (id, created_at, last_seen_at, rating, is_demo, is_internal, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        at,
        at,
        START_RATING,
        input.isDemo ? 1 : 0,
        input.isInternal ? 1 : 0,
        input.userAgent?.slice(0, 300) ?? null,
      );
    return this.find(input.id)!;
  }

  touch(id: string, now: Date): void {
    this.db.query("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(now.toISOString(), id);
  }

  markInternal(id: string): void {
    this.db.query("UPDATE sessions SET is_internal = 1 WHERE id = ?").run(id);
  }

  /** Replace the scan: occupation, task selection and (merged) answers. */
  saveScan(id: string, soc: string, tasks: ReadonlyArray<UserTask>, answers: ScanAnswers): void {
    this.db.transaction(() => {
      this.db.query("UPDATE sessions SET soc = ?, scan_answers = ? WHERE id = ?").run(soc, JSON.stringify(answers), id);
      this.db.query("DELETE FROM user_tasks WHERE session_id = ?").run(id);
      const insert = this.db.query("INSERT INTO user_tasks (session_id, task_id, frequency) VALUES (?, ?, ?)");
      for (const task of tasks) insert.run(id, task.taskId, task.frequency);
    })();
  }

  tasks(id: string): UserTask[] {
    const rows = this.db
      .query("SELECT task_id AS taskId, frequency FROM user_tasks WHERE session_id = ?")
      .all(id) as UserTask[];
    return rows;
  }

  startTrial(id: string, planChoice: PlanChoice, trialEndsAt: Date): void {
    this.db
      .query("UPDATE sessions SET plan = 'trial', plan_choice = ?, trial_ends_at = ? WHERE id = ?")
      .run(planChoice, trialEndsAt.toISOString(), id);
  }

  recordAttempt(id: string, ratingAfter: number): void {
    this.db
      .query("UPDATE sessions SET rating = ?, attempts_count = attempts_count + 1 WHERE id = ?")
      .run(ratingAfter, id);
  }
}
