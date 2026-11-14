import type { DrillMode } from "../../shared/api";

/** How a drill is named in headers: "Daily Catch #12", "Your first catch", "Practice". */
export function modeLabel(mode: DrillMode, dailyNumber?: number): string {
  if (mode === "daily") return dailyNumber === undefined ? "Daily Catch" : `Daily Catch #${dailyNumber}`;
  return mode === "first" ? "Your first catch" : "Practice";
}

/** Seconds → "3:07" */
export function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
