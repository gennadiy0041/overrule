/**
 * AI-exposure maths.
 *
 * Labels and the β aggregate follow Eloundou et al. (2023), "GPTs are GPTs"
 * (arXiv:2303.10130):
 *   E1 — an LLM alone cuts the time for the task by at least half at equal quality
 *   E2 — the same, but only with additional software built on top of the LLM
 *   E0 — no meaningful exposure
 *
 *   β = Σ wᵢ·vᵢ / Σ wᵢ,   v(E1)=1, v(E2)=0.5, v(E0)=0
 *
 * For an occupation, wᵢ is the O*NET task weight (Core = 2, otherwise 1). This
 * reproduces the published `human_rating_beta` for all 923 occupations — see
 * tests/unit/exposure.test.ts.
 *
 * For a person, wᵢ is how often they do the task, so the score reflects the job
 * they actually have rather than the job title.
 */

export type ExposureLabel = "E0" | "E1" | "E2";
export type TaskType = "Core" | "Supplemental" | null;
export type Frequency = "often" | "sometimes" | "rarely";

export const LABEL_VALUE: Readonly<Record<ExposureLabel, number>> = { E0: 0, E1: 1, E2: 0.5 };
export const FREQUENCY_WEIGHT: Readonly<Record<Frequency, number>> = { often: 3, sometimes: 2, rarely: 1 };

/** A personal score needs at least this many tasks to mean anything. */
export const MIN_PERSONAL_TASKS = 3;

export function taskTypeWeight(type: TaskType): number {
  return type === "Core" ? 2 : 1;
}

/** Σ w·v / Σ w. Returns 0 for an empty (or zero-weight) list. */
export function weightedExposure(items: ReadonlyArray<{ label: ExposureLabel; weight: number }>): number {
  let weighted = 0;
  let total = 0;
  for (const { label, weight } of items) {
    weighted += weight * LABEL_VALUE[label];
    total += weight;
  }
  return total === 0 ? 0 : weighted / total;
}

/** Occupation-level β, weighted by O*NET task type. */
export function occupationBeta(tasks: ReadonlyArray<{ label: ExposureLabel; type: TaskType }>): number {
  return weightedExposure(tasks.map((t) => ({ label: t.label, weight: taskTypeWeight(t.type) })));
}

/** Personal β, weighted by how often the person does each task. */
export function personalBeta(tasks: ReadonlyArray<{ label: ExposureLabel; frequency: Frequency }>): number {
  if (tasks.length < MIN_PERSONAL_TASKS) {
    throw new RangeError(`A personal exposure score needs at least ${MIN_PERSONAL_TASKS} tasks`);
  }
  return weightedExposure(tasks.map((t) => ({ label: t.label, weight: FREQUENCY_WEIGHT[t.frequency] })));
}

/** Share (0–100) of the population with a strictly smaller value. */
export function percentileBelow(value: number, population: ReadonlyArray<number>): number {
  if (population.length === 0) return 0;
  let below = 0;
  for (const other of population) if (other < value) below++;
  return (below / population.length) * 100;
}

/** Share of total weight carried by each label — used for the map's summary bar. */
export function labelShares(
  items: ReadonlyArray<{ label: ExposureLabel; weight: number }>,
): Record<ExposureLabel, number> {
  const sums: Record<ExposureLabel, number> = { E0: 0, E1: 0, E2: 0 };
  let total = 0;
  for (const { label, weight } of items) {
    sums[label] += weight;
    total += weight;
  }
  if (total === 0) return sums;
  return { E0: sums.E0 / total, E1: sums.E1 / total, E2: sums.E2 / total };
}
