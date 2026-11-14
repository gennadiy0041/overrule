import type { MeResponse } from "../../shared/api";
import { score, signed, wholePercent } from "../lib/format";
import { Card, Eyebrow } from "../ui";

const WIDTH = 320;
const HEIGHT = 96;
const PAD = 8;

/** The Judgment Score over time, as a plain SVG line — no chart library for one line. */
function RatingChart({ values }: { values: ReadonlyArray<number> }) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (index: number) => PAD + (index / (values.length - 1)) * (WIDTH - 2 * PAD);
  const y = (value: number) => PAD + (1 - (value - min) / span) * (HEIGHT - 2 * PAD);
  const points = values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const lastX = x(values.length - 1);
  const lastY = y(values[values.length - 1]!);

  return (
    <div className="mt-4">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-24 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Judgment Score over ${values.length - 1} drills: from ${values[0]} to ${values[values.length - 1]}, low ${min}, high ${max}`}
      >
        <polygon points={`${PAD},${HEIGHT - PAD} ${points} ${lastX},${HEIGHT - PAD}`} fill="var(--color-ink)" fillOpacity="0.05" />
        <polyline points={points} fill="none" stroke="var(--color-ink)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <circle cx={lastX} cy={lastY} r="4" fill="var(--color-overrule)" />
      </svg>
      <div className="tabular mt-1 flex justify-between text-xs text-ink-3">
        <span>low {score(min)}</span>
        <span>high {score(max)}</span>
      </div>
    </div>
  );
}

function percentileLine(percentile: MeResponse["percentile"]): string {
  if (percentile.locked) {
    return `Percentile unlocks at ${percentile.needed} players (${percentile.players} so far)`;
  }
  const scope = percentile.scope === "occupation" ? "players in your field" : "all players";
  return `Ahead of ${wholePercent(percentile.value)} of ${scope}`;
}

export function ScoreCard({ me }: { me: MeResponse }) {
  const first = me.history[0];
  const series = first ? [first.ratingAfter - first.delta, ...me.history.map((entry) => entry.ratingAfter)] : [];
  const change = first ? me.rating - (first.ratingAfter - first.delta) : 0;

  return (
    <Card className="p-5 sm:p-6">
      <Eyebrow>Judgment Score</Eyebrow>
      <div className="mt-1 flex items-end justify-between gap-4">
        <p className="tabular font-serif text-7xl leading-none">{score(me.rating)}</p>
        {first && (
          <p className="tabular pb-2 text-sm text-ink-2">
            {signed(change)} over {me.history.length} {me.history.length === 1 ? "drill" : "drills"}
          </p>
        )}
      </div>
      {series.length >= 3 ? (
        <RatingChart values={series} />
      ) : (
        <p className="mt-4 text-sm text-ink-3">Your score starts at 1,000. It moves with every drill.</p>
      )}
      <dl className="mt-4 grid gap-2 border-t hairline pt-4 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-ink-2">Streak</dt>
          <dd className="tabular font-medium">{me.streak > 0 ? `${me.streak}-day streak` : "No streak yet — today counts"}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-ink-2">Standing</dt>
          <dd className="text-right">{percentileLine(me.percentile)}</dd>
        </div>
      </dl>
    </Card>
  );
}
