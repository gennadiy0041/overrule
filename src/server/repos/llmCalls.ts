import type { Database } from "../db";
import type { LlmCallRecord, LlmLogger } from "../llm/types";

/** Every model call is recorded: purpose, provider, latency, outcome, tokens. /metrics reads this table. */
export function createLlmLogger(db: Database, now: () => Date): LlmLogger {
  const insert = db.query(
    `INSERT INTO llm_calls (purpose, provider, model, ms, ok, input_tokens, output_tokens, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  return (record: LlmCallRecord) => {
    insert.run(
      record.purpose,
      record.provider,
      record.model,
      Math.round(record.ms),
      record.ok ? 1 : 0,
      record.inputTokens ?? null,
      record.outputTokens ?? null,
      record.error?.slice(0, 300) ?? null,
      now().toISOString(),
    );
  };
}
