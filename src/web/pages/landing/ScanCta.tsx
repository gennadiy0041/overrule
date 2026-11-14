import { ButtonLink, cx } from "../../ui";

/**
 * The one primary action on the page. Every place that asks for a decision
 * repeats it verbatim, so the visitor never has to work out which button is
 * "the" button.
 */
export function ScanCta({ className }: { className?: string }) {
  return (
    <ButtonLink to="/scan" variant="primary" size="lg" className={cx("group", className)}>
      Scan my job — free
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
        className="transition-transform duration-150 group-hover:translate-x-0.5"
      >
        <path
          d="M3 8h10M9 4l4 4-4 4"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </ButtonLink>
  );
}
