import { ERROR_TYPE_INFO, ERROR_TYPES } from "../../engine/drillSchema";
import type { MeResponse } from "../../shared/api";

const GENERIC_LEAD =
  "You just reviewed one AI draft. Pro builds a new one from your own tasks whenever you want — and trains the mistakes you miss most.";

/**
 * The paywall's opening sentence in the person's own numbers: what they caught so far
 * and which kinds of mistake they let through. That miss is exactly what Pro trains,
 * so it leads the page instead of a generic promise.
 */
export function paywallLead(byType: MeResponse["byType"] | undefined): string {
  const rows = byType
    ? ERROR_TYPES.map((type) => ({ label: ERROR_TYPE_INFO[type].label.toLowerCase(), ...byType[type] }))
    : [];
  const appeared = rows.reduce((n, row) => n + row.appeared, 0);
  const caught = rows.reduce((n, row) => n + row.caught, 0);
  if (appeared === 0) return GENERIC_LEAD;

  const missed = rows.filter((row) => row.appeared > row.caught).map((row) => row.label);
  if (missed.length === 0) {
    return `You caught all ${appeared} planted mistakes so far. Pro builds harder drafts from your own tasks whenever you want — and keeps the score honest.`;
  }
  const kinds =
    missed.length === 1
      ? `${/^[aeiou]/.test(missed[0]!) ? "an" : "a"} ${missed[0]} mistake`
      : `${missed.slice(0, -1).join(", ")} and ${missed[missed.length - 1]} mistakes`;
  return `You caught ${caught} of ${appeared} planted mistakes so far — and let ${kinds} through. Pro builds new drafts from your own tasks whenever you want, and drills exactly what you miss.`;
}
