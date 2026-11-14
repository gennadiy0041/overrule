import { useEffect, useState } from "react";

/**
 * Animate a number from `from` to `to` (ease-out). Used where the figure is the
 * point of the screen: the exposure share and the Judgment Score.
 * With reduced motion the final value is shown immediately.
 */
export function useCountUp(to: number, from = 0, durationMs = 900): number {
  const [value, setValue] = useState(from);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || from === to) {
      setValue(to);
      return;
    }
    let frame = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / durationMs);
      const eased = 1 - (1 - progress) ** 3;
      setValue(from + (to - from) * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [to, from, durationMs]);

  return value;
}
