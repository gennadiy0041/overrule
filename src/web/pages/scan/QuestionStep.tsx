import { useEffect, useRef, useState } from "react";
import { cx } from "../../ui";

/** Long enough to see your choice land, short enough to feel instant. */
const ADVANCE_AFTER_MS = 220;

export interface QuestionOption<T extends string> {
  value: T;
  label: string;
}

/** Steps 3–6: one question, one tap. Choosing an answer moves on by itself. */
export function QuestionStep<T extends string>({
  title,
  options,
  value,
  onAnswer,
}: {
  title: string;
  options: ReadonlyArray<QuestionOption<T>>;
  value: T | undefined;
  onAnswer: (value: T) => void;
}) {
  const [picked, setPicked] = useState<T | undefined>(value);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  function choose(option: T) {
    setPicked(option);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onAnswer(option), ADVANCE_AFTER_MS);
  }

  return (
    <div>
      <h1 className="text-[2rem] leading-tight sm:text-4xl">{title}</h1>
      <div role="radiogroup" aria-label={title} className="mt-7 grid gap-3">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={picked === option.value}
            onClick={() => choose(option.value)}
            className={cx(
              "flex min-h-16 items-center justify-between rounded-2xl border px-5 text-left text-lg transition-colors",
              picked === option.value
                ? "border-ink bg-ink text-paper"
                : "border-line-strong bg-card hover:border-ink",
            )}
          >
            {option.label}
            <span aria-hidden="true" className={picked === option.value ? "text-paper" : "text-ink-3"}>
              →
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
