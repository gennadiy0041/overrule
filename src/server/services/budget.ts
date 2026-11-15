import type { Database } from "../db";
import { estimateCostUsd } from "../llm/pricing";

/**
 * A hard ceiling on what the product spends on models, in US dollars.
 *
 * Spend is estimated from the ledger of model calls (`llm_calls`): token counts
 * times list prices. It is an estimate, not an invoice, and it is built to err
 * high. Once the ceiling is reached the product stops calling models by itself:
 * drills come from the verified pool and notes are graded by the keyword
 * heuristic. Nothing breaks for the person using it.
 */
export interface ModelSpendLine {
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
}

export interface ModelSpend {
  usd: number;
  budgetUsd: number;
  remainingUsd: number;
  lines: ModelSpendLine[];
}

/**
 * What one live generation can cost at the very worst: two Claude drafts and one
 * from the second provider, each running to its output ceiling. A generation
 * starts only while this much is still free for it and for every one in flight,
 * so the ceiling holds even when several start at once.
 */
export const GENERATION_RESERVE_USD = 0.65;

/** The same for grading the notes of one attempt (one short call). */
export const GRADING_RESERVE_USD = 0.02;

/**
 * A call that timed out reports no usage, yet the provider may bill what it had
 * produced by then. Such calls are charged as if they had run to the ceiling.
 */
const TIMED_OUT_TOKENS: Record<string, { input: number; output: number }> = {
  generate: { input: 8_000, output: 12_000 },
};
const TIMED_OUT_DEFAULT = { input: 2_000, output: 2_000 };

interface LedgerRow {
  model: string;
  purpose: string;
  calls: number;
  input: number;
  output: number;
  timeouts: number;
}

export function modelSpend(db: Database, budgetUsd: number): ModelSpend {
  const rows = db
    .query(
      `SELECT model, purpose, COUNT(*) AS calls,
              COALESCE(SUM(input_tokens), 0) AS input,
              COALESCE(SUM(output_tokens), 0) AS output,
              COALESCE(SUM(CASE WHEN input_tokens IS NULL AND output_tokens IS NULL AND error LIKE '%timed out%'
                                THEN 1 ELSE 0 END), 0) AS timeouts
       FROM llm_calls GROUP BY model, purpose`,
    )
    .all() as LedgerRow[];

  const byModel = new Map<string, ModelSpendLine>();
  for (const row of rows) {
    const assumed = TIMED_OUT_TOKENS[row.purpose] ?? TIMED_OUT_DEFAULT;
    const line = byModel.get(row.model) ?? { model: row.model, calls: 0, inputTokens: 0, outputTokens: 0, usd: 0 };
    line.calls += row.calls;
    line.inputTokens += row.input + row.timeouts * assumed.input;
    line.outputTokens += row.output + row.timeouts * assumed.output;
    byModel.set(row.model, line);
  }

  const lines = [...byModel.values()]
    .map((line) => ({ ...line, usd: estimateCostUsd(line.model, line.inputTokens, line.outputTokens) }))
    .sort((a, b) => b.usd - a.usd || a.model.localeCompare(b.model));
  const usd = lines.reduce((sum, line) => sum + line.usd, 0);
  return { usd, budgetUsd, remainingUsd: Math.max(0, budgetUsd - usd), lines };
}

export class ModelBudget {
  constructor(
    private readonly db: Database,
    readonly limitUsd: number,
  ) {}

  spend(): ModelSpend {
    return modelSpend(this.db, this.limitUsd);
  }

  /** True while calls that may cost up to `reserveUsd` in total still fit under the ceiling. */
  allows(reserveUsd: number): boolean {
    return this.spend().usd + reserveUsd <= this.limitUsd;
  }
}
