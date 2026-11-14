import type { ReactNode } from "react";
import { cx } from "../../ui";

export interface Source {
  label: string;
  href: string;
}

/**
 * A citation that opens the original in a new tab. Every statistic and quote
 * on the page carries one. The vertical padding is there so a 13 px line of
 * small print is still a 44 px tap target.
 */
export function SourceLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cx(
        "inline-block py-3 text-[0.8125rem] leading-5 text-ink-3 underline decoration-line-strong underline-offset-4 transition-colors hover:text-ink hover:decoration-ink",
        className,
      )}
    >
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
      <svg
        width="10"
        height="10"
        viewBox="0 0 10 10"
        fill="none"
        aria-hidden="true"
        className="ml-1 inline-block align-baseline"
      >
        <path d="M3 1.5h5.5V7M8.5 1.5L1.5 8.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    </a>
  );
}
