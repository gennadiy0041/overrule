import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Forward-only migrations, applied in order at boot. Never edit a shipped
 * migration — append a new one.
 */
const MIGRATIONS: ReadonlyArray<string> = [
  /* 1 — initial schema */ `
  CREATE TABLE sessions (
    id            TEXT PRIMARY KEY,
    created_at    TEXT NOT NULL,
    last_seen_at  TEXT NOT NULL,
    soc           TEXT,
    scan_answers  TEXT,                          -- JSON: answers to the scan questions
    plan          TEXT NOT NULL DEFAULT 'free',  -- free | trial
    plan_choice   TEXT,                          -- annual | monthly
    trial_ends_at TEXT,
    rating        INTEGER NOT NULL DEFAULT 1000, -- Judgment Score
    attempts_count INTEGER NOT NULL DEFAULT 0,
    is_demo       INTEGER NOT NULL DEFAULT 0,
    is_internal   INTEGER NOT NULL DEFAULT 0,
    user_agent    TEXT
  );

  CREATE TABLE user_tasks (
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    task_id    INTEGER NOT NULL,
    frequency  TEXT NOT NULL,                    -- often | sometimes | rarely
    PRIMARY KEY (session_id, task_id)
  );

  CREATE TABLE drills (
    id         TEXT PRIMARY KEY,
    soc        TEXT NOT NULL,
    task_id    INTEGER NOT NULL,
    level      INTEGER NOT NULL,
    origin     TEXT NOT NULL,                    -- live | pool
    provider   TEXT,                             -- claude | gemini
    model      TEXT,
    payload    TEXT NOT NULL,                    -- full drill JSON, including the answer key
    session_id TEXT,                             -- owner, for personal drills
    created_at TEXT NOT NULL
  );
  CREATE INDEX drills_by_soc ON drills (soc, level);
  CREATE INDEX drills_by_session ON drills (session_id);

  CREATE TABLE attempts (
    id            TEXT PRIMARY KEY,
    session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    drill_id      TEXT NOT NULL REFERENCES drills(id),
    mode          TEXT NOT NULL,                 -- first | daily | practice
    day           TEXT NOT NULL,                 -- America/New_York calendar day, YYYY-MM-DD
    flags         TEXT NOT NULL,                 -- JSON: what the user flagged
    result        TEXT NOT NULL,                 -- JSON: scored outcome
    points        INTEGER NOT NULL,
    max_points    INTEGER NOT NULL,
    p             REAL NOT NULL,
    rating_before INTEGER NOT NULL,
    rating_after  INTEGER NOT NULL,
    elapsed_ms    INTEGER,
    created_at    TEXT NOT NULL,
    UNIQUE (session_id, drill_id)
  );
  CREATE INDEX attempts_by_session ON attempts (session_id, created_at);

  CREATE TABLE daily (
    day      TEXT NOT NULL,
    soc      TEXT NOT NULL,
    drill_id TEXT NOT NULL REFERENCES drills(id),
    PRIMARY KEY (day, soc)
  );

  CREATE TABLE events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    name       TEXT NOT NULL,
    props      TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX events_by_name ON events (name, created_at);
  CREATE INDEX events_by_session ON events (session_id);

  CREATE TABLE surveys (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    kind       TEXT NOT NULL,                    -- micro | full
    answers    TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE reports (
    public_id  TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    snapshot   TEXT NOT NULL,                    -- JSON frozen at creation time
    created_at TEXT NOT NULL
  );

  CREATE TABLE llm_calls (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    purpose       TEXT NOT NULL,                 -- generate | grade_why | cross_check
    provider      TEXT NOT NULL,
    model         TEXT NOT NULL,
    ms            INTEGER NOT NULL,
    ok            INTEGER NOT NULL,
    input_tokens  INTEGER,
    output_tokens INTEGER,
    error         TEXT,
    session_id    TEXT,
    created_at    TEXT NOT NULL
  );
  CREATE INDEX llm_calls_by_time ON llm_calls (created_at);
  `,
];

export function openDatabase(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

export function migrate(db: Database): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const row = db.query("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get() as {
    version: number;
  };
  for (let version = row.version + 1; version <= MIGRATIONS.length; version++) {
    const sql = MIGRATIONS[version - 1]!;
    db.transaction(() => {
      db.exec(sql);
      db.query("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
        version,
        new Date().toISOString(),
      );
    })();
  }
}

export type { Database };
