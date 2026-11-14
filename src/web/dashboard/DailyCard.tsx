import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { MeResponse } from "../../shared/api";
import { countdown, signed } from "../lib/format";
import { ButtonLink, Card, Eyebrow } from "../ui";

/** Milliseconds until `iso`, re-evaluated every second. */
function useTimeLeft(iso: string): number {
  const [left, setLeft] = useState(() => new Date(iso).getTime() - Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setLeft(new Date(iso).getTime() - Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [iso]);
  return left;
}

/** The main reason to open the app today: one shared drill per profession per day. */
export function DailyCard({ me }: { me: MeResponse }) {
  const { daily } = me;
  const left = useTimeLeft(daily.nextAt);

  return (
    <Card className="border-line-strong p-5 sm:p-6">
      <Eyebrow>Today</Eyebrow>
      <h2 className="mt-1 text-3xl">Daily Catch #{daily.number}</h2>

      {daily.state === "available" && (
        <>
          <p className="mt-2 text-ink-2">
            One AI draft from {me.occupation?.short ?? "your field"}. Same for everyone in your field today.
          </p>
          <ButtonLink to="/daily" size="lg" full className="mt-4">
            Play today’s catch
          </ButtonLink>
        </>
      )}

      {daily.state === "done" && daily.result && (
        <>
          <p className="tabular mt-2 text-lg">
            Caught {daily.result.caught}/{daily.result.total} · {signed(daily.result.delta)}
            {daily.attemptId && (
              <>
                {" · "}
                <Link to={`/result/${daily.attemptId}`} className="underline underline-offset-4">
                  Review it
                </Link>
              </>
            )}
          </p>
          <p className="mt-3 text-ink-2">
            Next Daily Catch in <span className="tabular font-medium text-ink">{countdown(left)}</span>
          </p>
        </>
      )}

      {daily.state === "needs_scan" && (
        <ButtonLink to="/scan" size="lg" full className="mt-4">
          Scan my job first
        </ButtonLink>
      )}
    </Card>
  );
}
