import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ERROR_TYPE_INFO, ERROR_TYPES, type ErrorType } from "../../engine/drillSchema";
import { Button, cx } from "../ui";

export interface FlagDraft {
  type: ErrorType;
  why: string;
}

const WHY_MAX = 140;

/**
 * The flag sheet: say what kind of mistake a line is and, optionally, why.
 * A bottom sheet on phones and a centred panel on desktop; focus stays inside
 * while it is open and Esc or the backdrop closes it.
 */
export function FlagSheet({
  text,
  existing,
  onSave,
  onRemove,
  onClose,
}: {
  text: string;
  existing: FlagDraft | undefined;
  onSave: (flag: FlagDraft) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [type, setType] = useState<ErrorType | undefined>(existing?.type);
  const [why, setWhy] = useState(existing?.why ?? "");
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !panel.current) return;
    const focusable = [...panel.current.querySelectorAll<HTMLElement>("button:not([disabled]), input")];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center sm:items-center" onKeyDown={onKeyDown}>
      <button type="button" aria-label="Close" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-ink/40" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Flag this line"
        className="relative w-full max-w-lg animate-rise rounded-t-3xl bg-card px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-sheet sm:rounded-3xl"
      >
        <blockquote className="max-h-24 overflow-y-auto border-l-2 border-overrule pl-3 text-[0.95rem] leading-snug text-ink-2">
          {text}
        </blockquote>

        <p className="mt-4 font-medium">What’s wrong with it?</p>
        <div role="radiogroup" aria-label="Mistake type" className="mt-2 flex flex-wrap gap-2">
          {ERROR_TYPES.map((option, index) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={type === option}
              data-autofocus={index === 0 ? "" : undefined}
              onClick={() => setType(option)}
              className={cx(
                "min-h-11 rounded-full border px-4 text-[0.95rem] transition-colors",
                type === option ? "border-overrule bg-overrule text-white" : "border-line-strong bg-card hover:border-ink",
              )}
            >
              {ERROR_TYPE_INFO[option].label}
            </button>
          ))}
        </div>
        <p className="mt-2 min-h-10 text-sm leading-snug text-ink-3">
          {type ? ERROR_TYPE_INFO[type].hint : "Pick the kind of mistake."}
        </p>

        <label className="mt-2 block">
          <span className="flex items-baseline justify-between text-sm">
            <span className="font-medium">Why? (optional)</span>
            <span className="tabular text-ink-3">
              {why.length}/{WHY_MAX}
            </span>
          </span>
          <input
            type="text"
            value={why}
            maxLength={WHY_MAX}
            onChange={(event) => setWhy(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && type) onSave({ type, why: why.trim() });
            }}
            placeholder="One line: what should it say?"
            className="mt-1 min-h-12 w-full rounded-xl border border-line-strong bg-paper px-3 placeholder:text-ink-3 focus:border-ink focus:outline-none"
          />
        </label>

        <div className="mt-4 flex items-center gap-3">
          <Button full size="lg" disabled={!type} onClick={() => type && onSave({ type, why: why.trim() })}>
            {existing ? "Update flag" : "Flag it"}
          </Button>
          {existing && (
            <Button variant="outline" size="lg" onClick={onRemove} className="shrink-0">
              Remove
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
