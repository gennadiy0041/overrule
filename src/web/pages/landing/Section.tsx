import { useId, type ReactNode } from "react";

/**
 * The page's editorial grid. On a wide screen the title sits in a narrow left
 * column, like a running head, and the content takes the other two thirds; on
 * a phone the two simply stack. A hairline opens every section, so the page
 * reads as one ruled sheet rather than a pile of cards.
 */
export function Section({ title, lede, children }: { title: string; lede?: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="border-t hairline py-14 sm:py-20 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-x-14 lg:py-24"
    >
      <div>
        <h2 id={headingId} className="text-[2rem] leading-[1.1] sm:text-4xl">
          {title}
        </h2>
        {lede && <p className="mt-3 max-w-xs text-ink-2">{lede}</p>}
      </div>
      <div className="mt-8 lg:mt-1">{children}</div>
    </section>
  );
}
