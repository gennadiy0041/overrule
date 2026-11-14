import type { Database } from "../db";
import type { ReportSnapshot } from "../services/report";

export class ReportRepo {
  constructor(private readonly db: Database) {}

  insert(publicId: string, sessionId: string, snapshot: ReportSnapshot): void {
    this.db
      .query("INSERT INTO reports (public_id, session_id, snapshot, created_at) VALUES (?, ?, ?, ?)")
      .run(publicId, sessionId, JSON.stringify(snapshot), snapshot.createdAt);
  }

  find(publicId: string): ReportSnapshot | null {
    const row = this.db.query("SELECT snapshot FROM reports WHERE public_id = ?").get(publicId) as {
      snapshot: string;
    } | null;
    return row ? (JSON.parse(row.snapshot) as ReportSnapshot) : null;
  }
}
