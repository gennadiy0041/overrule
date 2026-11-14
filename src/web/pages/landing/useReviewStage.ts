import { useEffect, useState, type RefObject } from "react";

/** 0 — the draft as AI wrote it · 1 — the real mistake is flagged · 2 — the look-alike line is cleared. */
export type ReviewStage = 0 | 1 | 2;

const FLAG_AFTER_MS = 800;
const CLEAR_AFTER_MS = 1700;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Plays the review in front of the visitor instead of showing a finished
 * screenshot: the flag lands a beat after the document is on screen, which is
 * the whole product in one motion.
 *
 * The clock starts when `target` scrolls into view, because on a phone the
 * document sits below the fold. With reduced motion the finished review is
 * shown straight away.
 */
export function useReviewStage(target: RefObject<HTMLElement | null>): ReviewStage {
  const [stage, setStage] = useState<ReviewStage>(() => (prefersReducedMotion() ? 2 : 0));

  useEffect(() => {
    const element = target.current;
    if (!element || prefersReducedMotion()) return;

    let timers: number[] = [];
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        timers = [
          window.setTimeout(() => setStage(1), FLAG_AFTER_MS),
          window.setTimeout(() => setStage(2), CLEAR_AFTER_MS),
        ];
      },
      { threshold: 0.5 },
    );
    observer.observe(element);

    return () => {
      observer.disconnect();
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [target]);

  return stage;
}
