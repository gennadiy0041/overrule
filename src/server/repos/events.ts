import type { ClientEvent } from "../../shared/api";
import type { Database } from "../db";

/** Events only the server can vouch for. */
export type ServerEvent =
  | "task_select"
  | "scan_complete"
  | "drill_submit"
  | "trial_start"
  | "daily_return"
  | "report_create"
  | "survey_submit"
  | "seo_page_view";

export type EventName = ClientEvent | ServerEvent;

export type EventProps = Record<string, string | number | boolean>;

export class EventRepo {
  constructor(private readonly db: Database) {}

  log(sessionId: string, name: EventName, now: Date, props?: EventProps): void {
    this.db
      .query("INSERT INTO events (session_id, name, props, created_at) VALUES (?, ?, ?, ?)")
      .run(sessionId, name, props ? JSON.stringify(props) : null, now.toISOString());
  }
}
