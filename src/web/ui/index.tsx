/**
 * The small UI kit every page is built from. Keep it small: if a pattern is used
 * on one page only, it lives with that page.
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router-dom";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// ───────────────────────────── Logo ─────────────────────────────

/** The mark: AI's confident check mark, overruled in red. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="var(--color-ink)" />
      <path
        d="M8 16.5l5.2 5.2L24 10.5"
        fill="none"
        stroke="var(--color-paper)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M6 23L26 9" stroke="var(--color-overrule)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ size = 26 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <LogoMark size={size} />
      <span className="font-serif text-[1.35rem] leading-none font-medium tracking-tight">overrule</span>
    </span>
  );
}

// ───────────────────────────── Buttons ─────────────────────────────

type ButtonVariant = "primary" | "dark" | "outline" | "ghost";
type ButtonSize = "md" | "lg";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-[background-color,border-color,transform,opacity] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 select-none";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-overrule text-white hover:bg-overrule-deep",
  dark: "bg-ink text-paper hover:bg-ink-2",
  outline: "border border-line-strong bg-card text-ink hover:border-ink",
  ghost: "text-ink-2 hover:text-ink underline-offset-4 hover:underline",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  md: "min-h-11 px-5 text-[0.95rem]",
  lg: "min-h-14 px-7 text-base",
};

interface ButtonStyleProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  full?: boolean;
  className?: string;
}

function buttonClass({ variant = "primary", size = "md", full, className }: ButtonStyleProps): string {
  return cx(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], full && "w-full", className);
}

export function Button({
  variant,
  size,
  full,
  className,
  type = "button",
  ...rest
}: ButtonStyleProps & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={buttonClass({ variant, size, full, className })} {...rest} />;
}

/** A link that looks like a button. Internal paths use the router; anything else is a plain anchor. */
export function ButtonLink({
  to,
  children,
  onClick,
  ...style
}: ButtonStyleProps & { to: string; children: ReactNode; onClick?: () => void }) {
  const className = buttonClass(style);
  if (to.startsWith("/") && !to.startsWith("//")) {
    return (
      <Link to={to} className={className} onClick={onClick}>
        {children}
      </Link>
    );
  }
  return (
    <a href={to} className={className} onClick={onClick}>
      {children}
    </a>
  );
}

// ───────────────────────────── Layout ─────────────────────────────

/** Page frame: slim header, content column, quiet footer with data attribution. */
export function Shell({
  children,
  headerRight,
  width = "narrow",
  footer = true,
}: {
  children: ReactNode;
  headerRight?: ReactNode;
  width?: "narrow" | "wide";
  footer?: boolean;
}) {
  const column = width === "wide" ? "max-w-5xl" : "max-w-2xl";
  return (
    <div className="flex min-h-dvh flex-col">
      <header className={cx("mx-auto flex w-full items-center justify-between px-5 py-4", column)}>
        <Link to="/" aria-label="Overrule — home" className="rounded-md">
          <Logo />
        </Link>
        <div className="flex items-center gap-4 text-sm text-ink-2">{headerRight}</div>
      </header>
      <main className={cx("mx-auto w-full flex-1 px-5 pb-16", column)}>{children}</main>
      {footer && <Footer column={column} />}
    </div>
  );
}

function Footer({ column }: { column: string }) {
  return (
    <footer className="border-t hairline">
      <div className={cx("mx-auto w-full px-5 py-8 text-[0.8rem] leading-relaxed text-ink-3", column)}>
        <nav className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-ink-2">
          <Link to="/about" className="underline-offset-4 hover:underline">
            About &amp; method
          </Link>
          <a href="/will-ai-replace" className="underline-offset-4 hover:underline">
            AI exposure by job
          </a>
          <Link to="/survey" className="underline-offset-4 hover:underline">
            2-minute survey
          </Link>
          <a
            href="https://github.com/gennadiy0041/overrule"
            className="underline-offset-4 hover:underline"
            rel="noreferrer"
          >
            GitHub
          </a>
        </nav>
        <p>
          Exposure data: Eloundou et al., “GPTs are GPTs” (2023), dataset under the MIT License. Task statements from
          the O*NET® Database by the U.S. Department of Labor, Employment and Training Administration (USDOL/ETA), used
          under the CC BY 4.0 license. Overrule has modified this information; USDOL/ETA has not approved, endorsed, or
          tested these modifications.
        </p>
        <p className="mt-2">Exposure means AI can speed up a task — not that a job disappears.</p>
      </div>
    </footer>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-card border hairline bg-card shadow-card", className)}>{children}</div>;
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx("eyebrow", className)}>{children}</p>;
}

// ───────────────────────────── Controls ─────────────────────────────

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={label ?? "Progress"}
      className="h-1.5 w-full overflow-hidden rounded-full bg-paper-2"
    >
      <div className="h-full rounded-full bg-ink transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** A selectable pill. Used for answers, frequencies and error types. */
export function Chip({
  selected,
  children,
  onClick,
  className,
  ...rest
}: {
  selected?: boolean;
  children: ReactNode;
  className?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cx(
        "inline-flex min-h-10 items-center justify-center rounded-full border px-3.5 text-sm transition-colors",
        selected ? "border-ink bg-ink text-paper" : "border-line-strong bg-card text-ink-2 hover:border-ink hover:text-ink",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cx(
        "inline-block size-5 animate-spin rounded-full border-2 border-line-strong border-t-ink",
        className,
      )}
    />
  );
}

/** Full-height placeholder while a page's data loads. */
export function PageLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-[50dvh] flex-col items-center justify-center gap-3 text-sm text-ink-3">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

/** Shown when a request fails; always offers a way forward. */
export function PageError({ message, retry }: { message?: string; retry?: () => void }) {
  return (
    <div className="flex min-h-[50dvh] flex-col items-center justify-center gap-4 text-center">
      <p className="font-serif text-2xl">That didn’t load.</p>
      <p className="max-w-sm text-sm text-ink-2">{message ?? "Check your connection and try again."}</p>
      <div className="flex gap-3">
        {retry && (
          <Button variant="dark" onClick={retry}>
            Try again
          </Button>
        )}
        <ButtonLink to="/" variant="outline">
          Home
        </ButtonLink>
      </div>
    </div>
  );
}
