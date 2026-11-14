import { useEffect, useMemo, useState } from "react";
import { MIN_PERSONAL_TASKS, type Frequency } from "../../../engine/exposure";
import { FREQUENCIES, type OccupationDetail, type TaskView } from "../../../shared/api";
import { useApi } from "../../lib/api";
import { truncate } from "../../lib/format";
import { Button, cx, PageError, PageLoading } from "../../ui";

export type TaskSelection = Record<number, Frequency>;

const FREQUENCY_LABEL: Readonly<Record<Frequency, string>> = { often: "Often", sometimes: "Sometimes", rarely: "Rarely" };
const DEFAULT_FREQUENCY: Frequency = "sometimes";

function TaskRow({
  task,
  frequency,
  onToggle,
  onFrequency,
}: {
  task: TaskView;
  frequency: Frequency | undefined;
  onToggle: () => void;
  onFrequency: (frequency: Frequency) => void;
}) {
  const selected = frequency !== undefined;
  return (
    <li className="py-3">
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        onClick={onToggle}
        title={task.text}
        className="flex min-h-11 w-full items-start gap-3 text-left"
      >
        <span
          aria-hidden="true"
          className={cx(
            "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border transition-colors",
            selected ? "border-ink bg-ink text-paper" : "border-line-strong bg-card",
          )}
        >
          {selected && (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 7.5l2.8 2.8L11 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
        <span className={cx("leading-snug", selected ? "text-ink" : "text-ink-2")}>
          {task.short ?? truncate(task.text, 90)}
        </span>
      </button>
      {selected && (
        <div role="radiogroup" aria-label="How often" className="mt-2 ml-9 flex gap-2">
          {FREQUENCIES.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={frequency === option}
              onClick={() => onFrequency(option)}
              className={cx(
                "min-h-9 rounded-full border px-3 text-sm transition-colors",
                frequency === option
                  ? "border-ink bg-ink text-paper"
                  : "border-line-strong bg-card text-ink-2 hover:border-ink",
              )}
            >
              {FREQUENCY_LABEL[option]}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}

/** Step 2: which of the occupation's tasks you actually do, and how often. No exposure labels yet — no spoilers. */
export function TasksStep({
  soc,
  selection,
  onChange,
  onContinue,
  saving,
  error,
}: {
  soc: string;
  selection: TaskSelection | undefined;
  onChange: (selection: TaskSelection) => void;
  onContinue: () => void;
  saving: boolean;
  error: string | undefined;
}) {
  const { data, error: loadError, loading, reload } = useApi<OccupationDetail>(`/api/occupations/${soc}`);
  const [showAll, setShowAll] = useState(false);

  // Core tasks describe the heart of the job: start with them selected.
  useEffect(() => {
    if (!data || selection !== undefined) return;
    const core = data.tasks.filter((task) => task.type === "Core");
    const preselected = core.length >= MIN_PERSONAL_TASKS ? core : data.tasks;
    onChange(Object.fromEntries(preselected.map((task) => [task.id, DEFAULT_FREQUENCY])));
  }, [data, selection, onChange]);

  const { core, rest } = useMemo(() => {
    const tasks = data?.tasks ?? [];
    const coreTasks = tasks.filter((task) => task.type === "Core");
    return coreTasks.length >= MIN_PERSONAL_TASKS
      ? { core: coreTasks, rest: tasks.filter((task) => task.type !== "Core") }
      : { core: tasks, rest: [] };
  }, [data]);

  if (loadError) return <PageError retry={reload} />;
  if (loading || !data || selection === undefined) return <PageLoading label="Loading the tasks of this job…" />;

  const count = Object.keys(selection).length;
  const toggle = (task: TaskView) => {
    const next = { ...selection };
    if (next[task.id]) delete next[task.id];
    else next[task.id] = DEFAULT_FREQUENCY;
    onChange(next);
  };
  const row = (task: TaskView) => (
    <TaskRow
      key={task.id}
      task={task}
      frequency={selection[task.id]}
      onToggle={() => toggle(task)}
      onFrequency={(frequency) => onChange({ ...selection, [task.id]: frequency })}
    />
  );

  return (
    <div className="pb-28">
      <p className="eyebrow">{data.title}</p>
      <h1 className="mt-2 text-[2rem] leading-tight sm:text-4xl">Which of these do you actually do?</h1>
      <p className="mt-2 text-ink-2">Untick what isn’t yours, and say how often you do the rest.</p>

      <ul className="mt-5 divide-y divide-line border-y hairline">{core.map(row)}</ul>
      {rest.length > 0 &&
        (showAll ? (
          <ul className="divide-y divide-line border-b hairline">{rest.map(row)}</ul>
        ) : (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="mt-3 min-h-11 font-medium underline underline-offset-4"
          >
            Show {rest.length} more tasks
          </button>
        ))}

      <div className="fixed inset-x-0 bottom-0 border-t hairline bg-paper/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-4 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <p className="text-sm text-ink-2" aria-live="polite">
            {error ? (
              <span className="text-overrule-deep">{error}</span>
            ) : count < MIN_PERSONAL_TASKS ? (
              `Pick at least ${MIN_PERSONAL_TASKS}`
            ) : (
              <span className="tabular">{count} selected</span>
            )}
          </p>
          <Button onClick={onContinue} disabled={count < MIN_PERSONAL_TASKS || saving} size="lg">
            {saving ? "Saving…" : error ? "Try again" : "Continue"}
          </Button>
        </div>
      </div>
    </div>
  );
}
