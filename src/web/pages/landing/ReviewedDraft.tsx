import { useRef, type ReactNode } from "react";
import { Card, cx } from "../../ui";
import { useReviewStage } from "./useReviewStage";

/**
 * The figures of the reference drill (tests/fixtures/reference-drill.json), so
 * the picture holds up to a visitor who checks it: revenue ÷ spend gives each
 * ROAS, and TikTok really did return $3.50 per $1.
 */
const CHANNELS = [
  { channel: "Meta", spend: "$42,000", revenue: "$126,000", roas: "3.0x" },
  { channel: "TikTok", spend: "$18,000", revenue: "$63,000", roas: "3.5x" },
  { channel: "Pinterest", spend: "$10,000", revenue: "$22,000", roas: "2.2x" },
] as const;

type Verdict = "mistake" | "correct";

/** Red is loud (solid chip), green is quiet (soft chip): the mistake is the thing to see first. */
const VERDICT_STYLE: Record<Verdict, { mark: string; elbow: string; chip: string }> = {
  mistake: {
    mark: "bg-overrule-soft shadow-[inset_0_-2px_0_var(--color-overrule)]",
    elbow: "border-overrule",
    chip: "bg-overrule text-white",
  },
  correct: {
    mark: "bg-caught-soft shadow-[inset_0_-2px_0_var(--color-caught)]",
    elbow: "border-caught",
    chip: "bg-caught-soft text-caught-deep",
  },
};

function FlagIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" className="shrink-0">
      <path d="M2.5 11V1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M2.5 2h7L7.9 4.25 9.5 6.5h-7z" fill="currentColor" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" className="shrink-0">
      <path d="M2.2 6.4l2.5 2.5 5.1-5.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DraftHeader() {
  return (
    <dl className="grid grid-cols-[4.75rem_1fr] gap-y-1.5 border-b hairline px-4 py-3.5 text-[0.8125rem] leading-5 sm:px-5">
      <dt className="text-ink-3">Drafted by</dt>
      <dd className="flex items-center gap-1.5">
        <span className="rounded-[5px] bg-ink px-1.5 text-[0.6875rem] leading-[1.125rem] font-semibold tracking-wide text-paper">
          AI
        </span>
        assistant
      </dd>
      <dt className="text-ink-3">To</dt>
      <dd>Dana Ortiz</dd>
      <dt className="text-ink-3">Subject</dt>
      <dd className="font-medium">October paid social: results + November test budget</dd>
    </dl>
  );
}

function ChannelTable() {
  return (
    <table className="tabular mt-3 w-full text-[0.8125rem] leading-5">
      <caption className="sr-only">October results by channel</caption>
      <thead>
        <tr className="border-y hairline text-xs text-ink-3">
          <th scope="col" className="py-1.5 text-left font-medium">
            Channel
          </th>
          <th scope="col" className="py-1.5 text-right font-medium">
            Spend
          </th>
          <th scope="col" className="py-1.5 text-right font-medium">
            Revenue
          </th>
          <th scope="col" className="py-1.5 text-right font-medium">
            ROAS
          </th>
        </tr>
      </thead>
      <tbody>
        {CHANNELS.map((row) => (
          <tr key={row.channel} className="border-b hairline">
            <th scope="row" className="py-1.5 text-left font-normal">
              {row.channel}
            </th>
            <td className="py-1.5 text-right">{row.spend}</td>
            <td className="py-1.5 text-right">{row.revenue}</td>
            <td className="py-1.5 text-right font-medium">{row.roas}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ReviewedLine({
  verdict,
  revealed,
  sentence,
  icon,
  note,
}: {
  verdict: Verdict;
  revealed: boolean;
  sentence: string;
  icon: ReactNode;
  note: ReactNode;
}) {
  const style = VERDICT_STYLE[verdict];
  return (
    <div>
      <p>
        <span
          className={cx(
            "-mx-1 rounded-[3px] box-decoration-clone px-1 py-0.5 transition-[background-color,box-shadow] duration-300",
            revealed && style.mark,
          )}
        >
          {sentence}
        </span>
      </p>
      {/* Always in the layout, only its opacity is staged: the card never changes height under the reader. */}
      <p className={cx("mt-1.5 flex items-start", revealed ? "animate-rise" : "opacity-0")}>
        <span
          aria-hidden="true"
          className={cx(
            "mt-0.5 mr-1.5 ml-1 size-2.5 shrink-0 rounded-bl-[5px] border-b-[1.5px] border-l-[1.5px]",
            style.elbow,
          )}
        />
        <span
          className={cx(
            "inline-flex min-h-7 items-center gap-1.5 rounded-full py-1 pr-3 pl-2.5 text-xs leading-4 font-medium",
            style.chip,
          )}
        >
          {icon}
          <span>{note}</span>
        </span>
      </p>
    </div>
  );
}

/**
 * The product in one picture: a believable AI-written email in which one line
 * is wrong and another only looks wrong. It is real text, not an image, so it
 * stays sharp at any size and is readable by assistive tech.
 */
export function ReviewedDraft({ className }: { className?: string }) {
  const review = useRef<HTMLDivElement>(null);
  const stage = useReviewStage(review);

  return (
    <figure className={cx("mx-auto w-full max-w-[30rem] animate-rise [animation-delay:120ms] lg:mx-0", className)}>
      <div className="relative">
        {/* Tomorrow's document under today's. Only this blank sheet is rotated, so the text on top stays pixel-crisp. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 translate-y-1.5 rotate-[1.8deg] rounded-card border hairline bg-paper-2"
        />
        <Card className="relative">
          <DraftHeader />
          <div className="px-4 pt-3.5 pb-5 text-sm leading-6 sm:px-5">
            <p>Hi Dana, here’s the October summary for Monday.</p>
            <ChannelTable />
            <div ref={review} className="mt-4 space-y-2.5">
              <ReviewedLine
                verdict="mistake"
                revealed={stage >= 1}
                sentence="Blended ROAS rose from 2.6x to 3.0x, a 40% improvement."
                icon={<FlagIcon />}
                note={
                  <>
                    <span className="sr-only">Flagged as a mistake: </span>
                    <strong className="font-semibold">Numbers</strong> · 3.0 ÷ 2.6 = +15%, not +40%
                  </>
                }
              />
              <ReviewedLine
                verdict="correct"
                revealed={stage >= 2}
                sentence="TikTok returned $3.50 for every $1 spent."
                icon={<CheckIcon />}
                note="Looks wrong · actually right"
              />
            </div>
          </div>
        </Card>
      </div>
      <figcaption className="mt-6 text-center text-[0.8125rem] leading-5 text-ink-3">
        The drill, in miniature: overrule only what’s actually wrong.
      </figcaption>
    </figure>
  );
}
