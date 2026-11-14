/**
 * The Wordle-style share text.
 *
 * The grid shows how the attempt went without giving the drill away: one square per planted
 * mistake in key order, then one black square per flag that hit nothing. Which line a square
 * stands for is never revealed, so people who share spoil nothing for those who have not played
 * today's drill yet.
 *
 *   Overrule · Daily Catch #12 · Marketing
 *   🟩🟨🟥🟩⬛
 *   Caught 3/4 · Judgment 1,084 (+21)
 *   https://…
 */
import type { KeyCell, ScoreResult } from "./scoring";

type ShareableResult = Pick<ScoreResult, "cells" | "falseFlags" | "decoyFlags">;

const CELL_SQUARE: Readonly<Record<KeyCell, string>> = { caught: "🟩", wrong_type: "🟨", missed: "🟥" };

/** A flag on a decoy and a flag on a plain line both hit nothing, so they share one square. */
const STRAY_SQUARE = "⬛";

/** A real minus sign (U+2212): it matches "+" in width, where a hyphen would read as a dash. */
const MINUS = "−";

const THOUSANDS = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function shareGrid(result: ShareableResult): string {
  const strays = result.falseFlags.length + result.decoyFlags.length;
  return result.cells.map((cell) => CELL_SQUARE[cell]).join("") + STRAY_SQUARE.repeat(strays);
}

export interface ShareInput {
  /** Omitted for Practice drills, which are personal and have no shared number. */
  dailyNumber?: number;
  occupationShort: string;
  result: ShareableResult;
  rating: number;
  delta: number;
  url: string;
}

/** Always signed, so a flat day reads "+0" rather than looking like a missing value. */
function signed(delta: number): string {
  return `${delta < 0 ? MINUS : "+"}${Math.abs(delta)}`;
}

export function shareText(input: ShareInput): string {
  const { cells } = input.result;
  const mode = input.dailyNumber === undefined ? "Practice" : `Daily Catch #${input.dailyNumber}`;
  // A mistake flagged under the wrong type was still caught: the user stopped it going out.
  const caught = cells.filter((cell) => cell !== "missed").length;
  return [
    `Overrule · ${mode} · ${input.occupationShort}`,
    shareGrid(input.result),
    `Caught ${caught}/${cells.length} · Judgment ${THOUSANDS.format(input.rating)} (${signed(input.delta)})`,
    input.url,
  ].join("\n");
}
