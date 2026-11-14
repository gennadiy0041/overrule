import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ExposureLabel, Frequency } from "../../engine/exposure";
import type { MapResponse, MapTask } from "../../shared/api";
import { track, useApi } from "../lib/api";
import { EXPOSURE_INFO, percent, truncate, wholePercent } from "../lib/format";
import { useCountUp } from "../lib/useCountUp";
import { ButtonLink, Card, cx, Eyebrow, PageError, PageLoading, Shell } from "../ui";

const LABEL_ORDER: ReadonlyArray<ExposureLabel> = ["E1", "E2", "E0"];
const FREQUENCY_LABEL: Readonly<Record<Frequency, string>> = { often: "Often", sometimes: "Sometimes", rarely: "Rarely" };

/** The headline: a large numeral that counts up, and what it means next to other jobs. */
function Headline({ map }: { map: MapResponse }) {
  const shown = useCountUp(map.personal.beta * 100);
  const rank = map.personal.percentile;
  return (
    <div>
      <p className="tabular font-serif text-[6.5rem] leading-none tracking-tight sm:text-[8.5rem]">
        {Math.round(shown)}
        <span className="text-[0.5em]">%</span>
      </p>
      <p className="mt-3 text-xl leading-snug sm:text-2xl">
        of your work is AI-exposed —{" "}
        {rank >= 50 ? (
          <>more than {wholePercent(rank)} of US occupations.</>
        ) : (
          <>less than {wholePercent(100 - rank)} of US occupations.</>
        )}
      </p>
    </div>
  );
}

function ShareBar({ shares }: { shares: MapResponse["personal"]["shares"] }) {
  return (
    <div className="mt-8">
      <div
        role="img"
        aria-label={LABEL_ORDER.map((label) => `${EXPOSURE_INFO[label].title}: ${percent(shares[label])}`).join(", ")}
        className="flex h-3.5 w-full overflow-hidden rounded-full bg-paper-2"
      >
        {LABEL_ORDER.map((label) => (
          <div
            key={label}
            className={cx("h-full transition-[width] duration-700 ease-out", EXPOSURE_INFO[label].bar)}
            style={{ width: `${shares[label] * 100}%` }}
          />
        ))}
      </div>
      <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
        {LABEL_ORDER.map((label) => (
          <li key={label} className="flex items-center gap-2">
            <span className={cx("size-2.5 shrink-0 rounded-full", EXPOSURE_INFO[label].dot)} />
            <span>
              {EXPOSURE_INFO[label].title} · <span className="tabular font-medium">{percent(shares[label])}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** You vs your occupation vs the median job, on one 0–100% track. */
function Comparison({ map }: { map: MapResponse }) {
  const markers = [
    { name: "You", value: map.personal.beta, strong: true },
    { name: `${map.occupation.title}, average`, value: map.occupation.beta, strong: false },
    { name: `Median of ${map.occupationCount} occupations`, value: map.medianBeta, strong: false },
  ];
  return (
    <section className="mt-10" aria-label="How you compare">
      <Eyebrow>How you compare</Eyebrow>
      <div className="relative mt-5 h-2 rounded-full bg-paper-2">
        {markers.map((marker) => (
          <span
            key={marker.name}
            aria-hidden="true"
            className={cx(
              "absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-paper",
              marker.strong ? "bg-overrule" : "bg-ink-3",
            )}
            style={{ left: `${marker.value * 100}%` }}
          />
        ))}
      </div>
      {/* A legend instead of labels on the track: three labels cannot sit side by side on a phone. */}
      <ul className="mt-4 space-y-1.5 text-sm">
        {markers.map((marker) => (
          <li key={marker.name} className="flex items-baseline justify-between gap-3">
            <span className="flex items-center gap-2">
              <span className={cx("size-2.5 shrink-0 rounded-full", marker.strong ? "bg-overrule" : "bg-ink-3")} />
              <span className={marker.strong ? "font-medium" : "text-ink-2"}>{marker.name}</span>
            </span>
            <span className="tabular">{percent(marker.value)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Insight({ map }: { map: MapResponse }) {
  const drafted = map.tasks.filter((task) => task.label !== "E0").length;
  return (
    <Card className="mt-10 p-5 sm:p-6">
      <h2 className="text-2xl leading-tight sm:text-[1.75rem]">Your value is moving from doing to judging.</h2>
      <p className="mt-3 leading-relaxed text-ink-2">
        AI can already speed up {drafted} of the {map.personal.taskCount} things you do. On those, the scarce skill
        isn’t producing the document — it’s knowing what’s wrong with it before it goes out.
        {map.answers.shippedAiError === "yes" &&
          " You said an AI mistake has already slipped into your work. That’s the exact moment this trains for."}
        {map.answers.aiInReview === "yes" && " And AI is already part of your review."}
      </p>
    </Card>
  );
}

function TaskRow({ task }: { task: MapTask }) {
  const [open, setOpen] = useState(false);
  const name = task.short ?? truncate(task.text, 110);
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-12 w-full items-center justify-between gap-3 py-2.5 text-left"
      >
        <span className="leading-snug">{name}</span>
        <span className="shrink-0 rounded-full bg-paper-2 px-2.5 py-1 text-xs text-ink-2">
          {FREQUENCY_LABEL[task.frequency]}
        </span>
      </button>
      {open && <p className="animate-fade pb-3 text-sm leading-relaxed text-ink-2">{task.text}</p>}
    </li>
  );
}

function TaskGroups({ tasks }: { tasks: ReadonlyArray<MapTask> }) {
  return (
    <section className="mt-12" aria-label="Your tasks by exposure">
      {LABEL_ORDER.map((label) => {
        const group = tasks.filter((task) => task.label === label);
        if (group.length === 0) return null;
        const info = EXPOSURE_INFO[label];
        return (
          <div key={label} className="mt-8 first:mt-0">
            <h3 className="flex items-center gap-2.5 text-xl">
              <span className={cx("size-3 shrink-0 rounded-full", info.dot)} />
              {info.title}
              <span className="tabular font-sans text-base text-ink-3">{group.length}</span>
            </h3>
            <p className="mt-1 text-sm text-ink-2">{info.blurb}</p>
            <ul className="mt-2 divide-y divide-line border-y hairline">
              {group.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

/** The personal result of the scan: how much of *your* work AI can already speed up, task by task. */
export default function ExposureMap() {
  const navigate = useNavigate();
  const { data: map, error, loading, reload } = useApi<MapResponse>("/api/map");

  useEffect(() => {
    if (error?.code === "scan_required") navigate("/scan", { replace: true });
  }, [error, navigate]);
  useEffect(() => {
    if (map) track("map_view", { soc: map.occupation.soc });
  }, [map]);

  if (error && error.code !== "scan_required") return <Shell><PageError retry={reload} /></Shell>;
  if (loading || !map) return <Shell><PageLoading label="Building your map…" /></Shell>;

  return (
    <Shell>
      <div className="animate-rise pt-4 pb-24">
        <Eyebrow>Your AI exposure map · {map.occupation.title}</Eyebrow>
        <div className="mt-4">
          <Headline map={map} />
        </div>
        <ShareBar shares={map.personal.shares} />
        <Comparison map={map} />
        <Insight map={map} />
        <TaskGroups tasks={map.tasks} />
        <p className="mt-10 text-sm leading-relaxed text-ink-3">
          Exposure means AI can speed up a task — not that your job disappears.{" "}
          <Link to="/about#method" className="underline underline-offset-4">
            How we calculate this
          </Link>{" "}
          ·{" "}
          <Link to="/scan" className="underline underline-offset-4">
            Change my tasks
          </Link>
        </p>
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t hairline bg-paper/95 backdrop-blur">
        <div className="mx-auto w-full max-w-2xl px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <ButtonLink to="/start?mode=first" size="lg" full>
            Catch your first AI mistake (2 min)
          </ButtonLink>
        </div>
      </div>
    </Shell>
  );
}
