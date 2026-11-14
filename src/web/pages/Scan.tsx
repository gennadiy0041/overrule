import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { SCAN_OPTIONS, type OccupationDetail, type ScanAnswers, type ScanRequest } from "../../shared/api";
import { api, track } from "../lib/api";
import { ProgressBar, Shell } from "../ui";
import { BuildingStep } from "./scan/BuildingStep";
import { OccupationStep } from "./scan/OccupationStep";
import { QuestionStep, type QuestionOption } from "./scan/QuestionStep";
import { TasksStep, type TaskSelection } from "./scan/TasksStep";

const STEPS = 7;
const STORAGE_KEY = "overrule.scan";

interface ScanState {
  step: number;
  occupation?: { soc: string; title: string };
  selection?: TaskSelection;
  answers: ScanAnswers;
}

type AnswerKey = keyof typeof SCAN_OPTIONS;

const QUESTIONS: ReadonlyArray<{ key: AnswerKey; title: string; labels: Readonly<Record<string, string>> }> = [
  {
    key: "aiUse",
    title: "How often do you use AI at work?",
    labels: { never: "Never", monthly: "A few times a month", weekly: "Weekly", daily: "Daily" },
  },
  {
    key: "aiInReview",
    title: "Is AI part of how your work is reviewed?",
    labels: { yes: "Yes", no: "No", not_sure: "Not sure" },
  },
  {
    key: "shippedAiError",
    title: "Have you ever sent work with an AI mistake in it?",
    labels: { yes: "Yes", no: "No", not_sure: "Not sure" },
  },
  {
    key: "worry",
    title: "What worries you most?",
    labels: {
      careless: "Looking careless",
      behind: "Falling behind peers",
      automation: "Automation",
      compliance: "Compliance risk",
    },
  },
];

function loadState(): ScanState {
  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored) as ScanState;
  } catch {
    // Private mode or corrupted entry: start over.
  }
  return { step: 1, answers: {} };
}

function toRequest(state: ScanState): ScanRequest | null {
  if (!state.occupation || !state.selection) return null;
  return {
    soc: state.occupation.soc,
    tasks: Object.entries(state.selection).map(([taskId, frequency]) => ({ taskId: Number(taskId), frequency })),
  };
}

/** The scan: a 7-step quiz that ends in a personal exposure map. Progress survives a refresh. */
export default function Scan() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [state, setState] = useState<ScanState>(loadState);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();

  useEffect(() => {
    track("scan_start");
  }, []);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage unavailable: the scan still works, it just won't survive a refresh.
    }
  }, [state]);

  // Arriving from an SEO page: the occupation is already chosen.
  const linkedSoc = params.get("soc");
  const fromSeo = params.get("from") === "seo";
  useEffect(() => {
    if (!linkedSoc) return;
    let cancelled = false;
    api
      .get<OccupationDetail>(`/api/occupations/${encodeURIComponent(linkedSoc)}`)
      .then((occupation) => {
        if (cancelled) return;
        if (fromSeo) track("seo_cta_click", { soc: occupation.soc });
        setState({ step: 2, occupation: { soc: occupation.soc, title: occupation.title }, answers: {} });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [linkedSoc, fromSeo]);

  const go = (step: number) => setState((current) => ({ ...current, step }));
  const setSelection = useCallback(
    (selection: TaskSelection) => setState((current) => ({ ...current, selection })),
    [],
  );

  /** Saving the tasks right away lets the server start preparing the first drill during the remaining questions. */
  async function saveTasks() {
    const request = toRequest(state);
    if (!request) return;
    setSaving(true);
    setSaveError(undefined);
    try {
      await api.post("/api/scan", request);
      go(3);
    } catch {
      setSaveError("Couldn’t save — check your connection.");
    } finally {
      setSaving(false);
    }
  }

  const saveAll = useCallback(async () => {
    const request = toRequest(state);
    if (!request) throw new Error("scan incomplete");
    await api.post("/api/scan", { ...request, answers: state.answers, complete: true });
  }, [state]);

  const finish = useCallback(() => {
    window.sessionStorage.removeItem(STORAGE_KEY);
    navigate("/map");
  }, [navigate]);

  // Without an occupation there is nothing to ask about yet.
  const step = state.occupation ? state.step : 1;
  const question = QUESTIONS[step - 3];

  return (
    <Shell footer={false} headerRight={<span className="tabular">Step {step} of {STEPS}</span>}>
      <ProgressBar value={step / STEPS} label="Scan progress" />
      <button
        type="button"
        onClick={() => (step === 1 ? navigate("/") : go(step - 1))}
        className="mt-3 -ml-2 min-h-11 px-2 text-sm text-ink-2 hover:text-ink"
        hidden={step === STEPS}
      >
        ← Back
      </button>

      <div key={step} className="mt-3 animate-rise">
        {step === 1 && (
          <OccupationStep
            onPick={(occupation) =>
              setState({ step: 2, occupation: { soc: occupation.soc, title: occupation.title }, answers: {} })
            }
          />
        )}
        {step === 2 && state.occupation && (
          <TasksStep
            soc={state.occupation.soc}
            selection={state.selection}
            onChange={setSelection}
            onContinue={saveTasks}
            saving={saving}
            error={saveError}
          />
        )}
        {question && (
          <QuestionStep
            title={question.title}
            options={SCAN_OPTIONS[question.key].map(
              (value): QuestionOption<string> => ({ value, label: question.labels[value] ?? value }),
            )}
            value={state.answers[question.key]}
            onAnswer={(value) =>
              setState((current) => ({
                ...current,
                step: current.step + 1,
                answers: { ...current.answers, [question.key]: value },
              }))
            }
          />
        )}
        {step === STEPS && <BuildingStep save={saveAll} onDone={finish} />}
      </div>
    </Shell>
  );
}
