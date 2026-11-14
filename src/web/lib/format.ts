import { ERROR_TYPE_INFO, type ErrorType } from "../../engine/drillSchema";
import type { ExposureLabel } from "../../engine/exposure";

/** 0.578 → "58%" */
export function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** 89.7 → "90%" (a percentile that is already on a 0–100 scale). */
export function wholePercent(value: number): string {
  return `${Math.round(value)}%`;
}

/** 1084 → "1,084" */
export function score(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

/** +21, −4, +0 — always signed, with a real minus sign. */
export function signed(delta: number): string {
  const rounded = Math.round(delta);
  return rounded < 0 ? `−${Math.abs(rounded)}` : `+${rounded}`;
}

/** Long task statements are trimmed in lists; the full text stays in the title attribute. */
export function truncate(text: string, max = 96): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20)).replace(/[,;:.\s]+$/, "")}…`;
}

/** How each exposure label is explained to a person looking at their own work. */
export const EXPOSURE_INFO: Readonly<
  Record<ExposureLabel, { title: string; blurb: string; text: string; bar: string; soft: string; dot: string }>
> = {
  E1: {
    title: "AI drafts it — you’re the reviewer",
    blurb: "AI alone can do this at least twice as fast. Your job becomes checking it.",
    text: "text-overrule-deep",
    bar: "bg-overrule",
    soft: "bg-overrule-soft",
    dot: "bg-overrule",
  },
  E2: {
    title: "AI + tools",
    blurb: "Twice as fast once AI is wired into your software — coming, not here everywhere yet.",
    text: "text-partial-deep",
    bar: "bg-partial",
    soft: "bg-partial-soft",
    dot: "bg-partial",
  },
  E0: {
    title: "Your human edge",
    blurb: "AI doesn’t meaningfully speed this up. This is where you are hard to replace.",
    text: "text-caught-deep",
    bar: "bg-caught",
    soft: "bg-caught-soft",
    dot: "bg-caught",
  },
};

export function errorTypeLabel(type: ErrorType): string {
  return ERROR_TYPE_INFO[type].label;
}

/** "2026-11-14" → "Nov 14" */
export function shortDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, date!)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Milliseconds → "13:42:10" */
export function countdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}
