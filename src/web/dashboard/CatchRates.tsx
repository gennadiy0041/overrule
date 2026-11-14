import { ERROR_TYPE_INFO, ERROR_TYPES } from "../../engine/drillSchema";
import type { MeResponse } from "../../shared/api";
import { percent } from "../lib/format";
import { Card, Eyebrow } from "../ui";

function calibration(rate: number | null): string {
  if (rate === null) return "No flags yet.";
  const share = `False alarms: ${percent(rate)} of your flags hit lines that were fine.`;
  if (rate <= 0.1) return `${share} Well calibrated.`;
  if (rate <= 0.3) return `${share} Slightly trigger-happy — make sure you can say why.`;
  return `${share} Over-flagging: being suspicious isn’t the skill; being right is.`;
}

/** Catch rate per mistake type, and how often a flag was a false alarm (calibration). */
export function CatchRates({ me }: { me: MeResponse }) {
  return (
    <Card className="p-5 sm:p-6">
      <Eyebrow>How you catch</Eyebrow>
      <ul className="mt-4 space-y-3.5">
        {ERROR_TYPES.map((type) => {
          const stat = me.byType[type];
          const rate = stat.appeared === 0 ? 0 : stat.caught / stat.appeared;
          return (
            <li key={type}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium">
                  {ERROR_TYPE_INFO[type].label}
                  {me.weakSpot === type && (
                    <span className="ml-2 rounded-full bg-overrule-soft px-2 py-0.5 text-xs font-semibold text-overrule-deep">
                      weak spot
                    </span>
                  )}
                </span>
                <span className="tabular text-ink-2">
                  {stat.appeared === 0 ? "not seen yet" : `${stat.caught}/${stat.appeared}`}
                </span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-paper-2">
                <div className="h-full rounded-full bg-caught transition-[width] duration-700" style={{ width: `${rate * 100}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-5 border-t hairline pt-4 text-sm leading-relaxed text-ink-2">{calibration(me.falseFlagRate)}</p>
    </Card>
  );
}
