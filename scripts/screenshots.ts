/**
 * Captures real screenshots of the deployed product for the deck and the README.
 *
 *   bun scripts/screenshots.ts            (production)
 *   BASE_URL=http://localhost:3000 bun scripts/screenshots.ts
 *
 * A scripted reviewer walks the same path as a user. To make the result screen
 * worth looking at it flags like a decent reviewer would: it looks the served
 * drill up in the committed pool (data/pool) and catches two of the planted
 * mistakes and trips on one decoy. Output: deck/shots/*.png
 */
import { chromium, type Browser, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { flag, openFlagSheet, poolDrill } from "./lib/reviewer";

const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, "deck", "shots");
const BASE = process.env["BASE_URL"] ?? "https://overrule-production.up.railway.app";
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DESKTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 };

async function save(page: Page, name: string): Promise<void> {
  // Let entrance animations and count-ups finish, so nothing is caught mid-motion.
  await page.waitForTimeout(1300);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`  ${name}.png`);
}

/** Landing → scan → map → drill → result → paywall, on a phone. */
async function journey(browser: Browser): Promise<void> {
  const context = await browser.newContext(PHONE);
  const page = await context.newPage();

  await page.goto(`${BASE}/`);
  await save(page, "landing-phone");
  await page.getByRole("link", { name: "Scan my job — free" }).first().click();

  await page.getByRole("combobox").fill("marketing manager");
  await page.getByRole("option", { name: /Marketing Managers/ }).first().click();
  await page.getByRole("heading", { name: "Which of these do you actually do?" }).waitFor();
  await save(page, "scan-phone");
  await page.getByRole("button", { name: "Continue" }).click();
  for (const answer of ["Daily", "Yes", "Yes", "Looking careless"]) {
    await page.getByRole("radio", { name: answer, exact: true }).click();
    await page.waitForTimeout(500);
  }

  await page.waitForURL(/\/map$/);
  await save(page, "map-phone");
  await page.getByRole("link", { name: "Catch your first AI mistake (2 min)" }).click();

  await page.waitForURL(/\/drill\//, { timeout: 120_000 });
  await page.getByText("Overrule only what’s actually wrong.").waitFor();
  const drill = poolDrill(page.url().split("/drill/")[1] ?? "");
  const [first, second] = drill?.key ?? [];
  if (first) {
    await openFlagSheet(page, first.targetId, first.type, first.cue);
    await save(page, "sheet-phone");
    await page.getByRole("button", { name: "Flag it" }).click();
  }
  if (second) await flag(page, second.targetId, second.type);
  const decoy = drill?.decoys[0];
  if (decoy) await flag(page, decoy.targetId, "numbers");
  if (first) await page.locator(`[data-target-id="${first.targetId}"]`).scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, -160);
  await save(page, "drill-phone");
  await page.getByRole("button", { name: "Submit review" }).click();
  if (!drill) await page.getByRole("button", { name: "Yes, submit" }).click();

  await page.waitForURL(/\/result\//, { timeout: 45_000 });
  await save(page, "result-phone");
  await page.getByRole("heading", { name: "The review, line by line" }).scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 420);
  await save(page, "review-phone");
  await page.getByRole("link", { name: "Continue" }).click();

  await page.waitForURL(/\/pro$/);
  await save(page, "paywall-phone");
  await context.close();
}

/** The demo profile: dashboard on phone and desktop, then a review report. */
async function demo(browser: Browser): Promise<void> {
  const phone = await browser.newContext(PHONE);
  const phonePage = await phone.newPage();
  await phonePage.goto(`${BASE}/demo`);
  await phonePage.waitForURL(/\/dashboard$/);
  await phonePage.getByRole("heading", { name: "History" }).waitFor();
  await save(phonePage, "dashboard-phone");
  await phone.close();

  const desktop = await browser.newContext(DESKTOP);
  const page = await desktop.newPage();
  await page.goto(`${BASE}/demo`);
  await page.waitForURL(/\/dashboard$/);
  await page.getByRole("heading", { name: "History" }).waitFor();
  await save(page, "dashboard-desktop");
  await page.getByRole("button", { name: "Create my review report" }).click();
  await page.waitForURL(/\/r\//);
  await save(page, "report-desktop");

  await page.goto(`${BASE}/will-ai-replace/marketing-managers`);
  await save(page, "seo-desktop");

  const tokenFile = join(ROOT, ".local", "metrics-token.txt");
  const token = process.env["METRICS_TOKEN"] ?? (existsSync(tokenFile) ? readFileSync(tokenFile, "utf8").trim() : "");
  if (token) {
    await page.goto(`${BASE}/metrics?token=${token}`);
    await save(page, "metrics-desktop");
  }
  await desktop.close();
}

mkdirSync(OUT, { recursive: true });
console.log(`Capturing ${BASE} → deck/shots`);
const browser = await chromium.launch();
try {
  await journey(browser);
  await demo(browser);
} finally {
  await browser.close();
}
