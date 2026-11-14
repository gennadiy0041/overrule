/**
 * A scripted reviewer shared by the screenshot and demo-video scripts. To make
 * the result worth looking at, it reviews like a decent human would: it looks the
 * served drill up in the committed pool and knows which lines to flag.
 */
import type { Page } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ERROR_TYPE_INFO, type Drill, type ErrorType } from "../../src/engine/drillSchema";

const POOL_DIR = join(import.meta.dir, "..", "..", "data", "pool");

/** The pool drill with this id, or undefined when the drill was generated live. */
export function poolDrill(id: string): Drill | undefined {
  for (const name of readdirSync(POOL_DIR)) {
    if (!/^\d{2}-\d{4}\.\d{2}\.json$/.test(name)) continue;
    const file = JSON.parse(readFileSync(join(POOL_DIR, name), "utf8")) as { drills: Drill[] };
    const drill = file.drills.find((d) => d.id === id);
    if (drill) return drill;
  }
  return undefined;
}

/** Open the flag sheet on a target and choose a type (and optionally a reason), without submitting the sheet. */
export async function openFlagSheet(page: Page, targetId: string, type: ErrorType, why?: string): Promise<void> {
  const target = page.locator(`[data-target-id="${targetId}"]`);
  await target.scrollIntoViewIfNeeded();
  await target.click();
  await page.getByRole("radio", { name: ERROR_TYPE_INFO[type].label }).click();
  if (why) await page.getByLabel("Why? (optional)").fill(why.slice(0, 140));
}

export async function flag(page: Page, targetId: string, type: ErrorType, why?: string): Promise<void> {
  await openFlagSheet(page, targetId, type, why);
  await page.getByRole("button", { name: "Flag it" }).click();
}
