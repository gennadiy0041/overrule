import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { OccupationHit } from "../../../shared/api";
import { api } from "../../lib/api";
import { cx, Spinner } from "../../ui";

const DEBOUNCE_MS = 150;

/** Step 1: find your occupation among 923, by whatever title you actually use. */
export function OccupationStep({ onPick }: { onPick: (occupation: { soc: string; title: string }) => void }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<OccupationHit[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(0);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Typing on a phone opens the keyboard over half the screen; only desktop gets autofocus.
    if (window.matchMedia("(min-width: 768px)").matches) input.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(
      () => {
        api
          .get<{ results: OccupationHit[] }>(`/api/occupations?q=${encodeURIComponent(query.trim())}`)
          .then(({ results }) => {
            if (cancelled) return;
            setHits(results);
            setActive(0);
          })
          .catch(() => {
            if (!cancelled) setHits([]);
          })
          .finally(() => {
            if (!cancelled) setLoading(false);
          });
      },
      query ? DEBOUNCE_MS : 0,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const typed = query.trim().length >= 2;

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, hits.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      const hit = hits[active];
      if (hit) onPick(hit);
    } else if (event.key === "Escape") {
      setQuery("");
    }
  }

  return (
    <div>
      <h1 className="text-[2rem] leading-tight sm:text-4xl">What do you do?</h1>
      <p className="mt-2 text-ink-2">Type your job title the way you’d say it. We’ll match it to 923 occupations.</p>

      <div className="relative mt-6">
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-expanded={hits.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={hits[active] ? `${listId}-${active}` : undefined}
          aria-label="Your job title"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={80}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="e.g. marketing manager, accountant, recruiter"
          className="min-h-14 w-full rounded-2xl border border-line-strong bg-card px-4 pr-12 text-lg placeholder:text-ink-3 focus:border-ink focus:outline-none"
        />
        {loading && <Spinner className="absolute top-1/2 right-4 -translate-y-1/2" />}
      </div>

      {!typed && <p className="eyebrow mt-6">Popular</p>}
      <ul id={listId} role="listbox" aria-label="Matching occupations" className="mt-3 divide-y divide-line">
        {hits.map((hit, index) => (
          <li key={hit.soc} id={`${listId}-${index}`} role="option" aria-selected={index === active}>
            <button
              type="button"
              onClick={() => onPick(hit)}
              onMouseEnter={() => setActive(index)}
              className={cx(
                "flex min-h-14 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                index === active && typed ? "bg-paper-2" : "hover:bg-paper-2",
              )}
            >
              <span>
                <span className="block font-medium">{hit.title}</span>
                {hit.matchedTitle && <span className="block text-sm text-ink-3">matches “{hit.matchedTitle}”</span>}
              </span>
              {hit.closest ? (
                <span className="shrink-0 rounded-full bg-partial-soft px-2.5 py-1 text-xs font-medium text-partial-deep">
                  closest match
                </span>
              ) : (
                <span aria-hidden="true" className="shrink-0 text-ink-3">
                  →
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {typed && !loading && hits.length === 0 && (
        <p className="mt-4 text-ink-2">No match — try a simpler title, like “accountant” or “project manager”.</p>
      )}
    </div>
  );
}
