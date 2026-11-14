import { FREQUENCY_WEIGHT, labelShares, percentileBelow, personalBeta, type ExposureLabel } from "../../engine/exposure";
import type { Occupation } from "../../engine/occupations";
import type { MapResponse, MapTask, ScanAnswers } from "../../shared/api";
import { summarize, toTaskView, type OccupationStore } from "../occupationStore";
import type { UserTask } from "../repos/sessions";

const LABEL_ORDER: Readonly<Record<ExposureLabel, number>> = { E1: 0, E2: 1, E0: 2 };

/**
 * The personal exposure map: the published task labels, re-weighted by what this
 * person says they actually do and how often.
 */
export function buildExposureMap(
  occupation: Occupation,
  userTasks: ReadonlyArray<UserTask>,
  answers: ScanAnswers,
  store: OccupationStore,
): MapResponse {
  const byId = new Map(occupation.tasks.map((t) => [t.id, t]));
  const tasks: MapTask[] = userTasks.flatMap((selected) => {
    const task = byId.get(selected.taskId);
    return task ? [{ ...toTaskView(task), frequency: selected.frequency }] : [];
  });

  // Most exposed first; within a label, the things done most often first.
  tasks.sort(
    (a, b) =>
      LABEL_ORDER[a.label] - LABEL_ORDER[b.label] || FREQUENCY_WEIGHT[b.frequency] - FREQUENCY_WEIGHT[a.frequency],
  );

  const beta = personalBeta(tasks);
  return {
    occupation: summarize(occupation),
    personal: {
      beta,
      percentile: percentileBelow(beta, store.betas),
      shares: labelShares(tasks.map((t) => ({ label: t.label, weight: FREQUENCY_WEIGHT[t.frequency] }))),
      taskCount: tasks.length,
    },
    medianBeta: store.medianBeta,
    occupationCount: store.all.length,
    tasks,
    answers,
  };
}
