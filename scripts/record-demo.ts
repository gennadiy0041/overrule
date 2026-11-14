/**
 * Records a walkthrough of the deployed product on a phone-sized screen and
 * converts it to docs/demo.mp4 (needs ffmpeg on PATH; without it the .webm is kept).
 *
 *   bun run record-demo            (production)
 *   BASE_URL=http://localhost:3000 bun run record-demo
 *
 * The path is the judges' path: landing → scan → map → drill → review → paywall →
 * demo checkout → dashboard, then the demo profile's dashboard.
 */
import { chromium, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { flag, openFlagSheet, poolDrill } from "./lib/reviewer";

const ROOT = join(import.meta.dir, "..");
const WORK = join(ROOT, "deck", "out", "video");
const OUTPUT = join(ROOT, "docs", "demo.mp4");
const BASE = process.env["BASE_URL"] ?? "https://overrule-production.up.railway.app";
const SIZE = { width: 390, height: 844 };

const pause = (page: Page, ms: number) => page.waitForTimeout(ms);

/** Scroll like a person reading: in steps, with a beat between them. */
async function read(page: Page, pixels: number, steps = 3): Promise<void> {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, pixels / steps);
    await pause(page, 650);
  }
}

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: SIZE,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  recordVideo: { dir: WORK, size: { width: SIZE.width * 2, height: SIZE.height * 2 } },
});
const page = await context.newPage();

await page.goto(`${BASE}/`);
await pause(page, 2600);
await read(page, 900);
await page.mouse.wheel(0, -2000);
await pause(page, 700);
await page.getByRole("link", { name: "Scan my job — free" }).first().click();

await pause(page, 900);
await page.getByRole("combobox").pressSequentially("marketing manager", { delay: 70 });
await pause(page, 900);
await page.getByRole("option", { name: /Marketing Managers/ }).first().click();
await page.getByRole("heading", { name: "Which of these do you actually do?" }).waitFor();
await pause(page, 1200);
await read(page, 500, 2);
await page.getByRole("button", { name: "Continue" }).click();
for (const answer of ["Daily", "Yes", "Yes", "Looking careless"]) {
  await pause(page, 900);
  await page.getByRole("radio", { name: answer, exact: true }).click();
}

await page.waitForURL(/\/map$/);
await pause(page, 2600);
await read(page, 1100, 4);
await page.getByRole("link", { name: "Catch your first AI mistake (2 min)" }).click();

await page.waitForURL(/\/drill\//, { timeout: 120_000 });
await page.getByText("Overrule only what’s actually wrong.").waitFor();
await pause(page, 2200);
await read(page, 420, 2);
const drill = poolDrill(page.url().split("/drill/")[1] ?? "");
const [first, second] = drill?.key ?? [];
if (first) {
  await openFlagSheet(page, first.targetId, first.type, first.cue);
  await pause(page, 1500);
  await page.getByRole("button", { name: "Flag it" }).click();
  await pause(page, 900);
}
if (second) {
  await flag(page, second.targetId, second.type);
  await pause(page, 900);
}
const decoy = drill?.decoys[0];
if (decoy) {
  await flag(page, decoy.targetId, "numbers");
  await pause(page, 900);
}
await page.getByRole("button", { name: "Submit review" }).click();
if (!drill) await page.getByRole("button", { name: "Yes, submit" }).click();

await page.waitForURL(/\/result\//, { timeout: 45_000 });
await pause(page, 2600);
await read(page, 2200, 7);
await page.getByRole("link", { name: "Continue" }).click();

await page.waitForURL(/\/pro$/);
await pause(page, 1800);
await read(page, 500, 2);
await page.getByRole("link", { name: "Start my 7-day free trial" }).click();
await pause(page, 1800);
await page.getByRole("button", { name: "Start my free trial" }).click();
await page.waitForURL(/\/dashboard$/);
await pause(page, 2200);
await read(page, 900, 3);

await page.goto(`${BASE}/demo`);
await page.waitForURL(/\/dashboard$/);
await page.getByRole("heading", { name: "History" }).waitFor();
await pause(page, 2000);
await read(page, 2400, 7);
await pause(page, 800);

await context.close();
await browser.close();

const recording = readdirSync(WORK).find((name) => name.endsWith(".webm"));
if (!recording) throw new Error("No recording was produced");
const webm = join(WORK, recording);
mkdirSync(join(ROOT, "docs"), { recursive: true });
const ffmpeg = Bun.spawnSync(
  ["ffmpeg", "-y", "-i", webm, "-vf", "scale=540:-2", "-c:v", "libx264", "-preset", "medium", "-crf", "27", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", OUTPUT],
  { stdout: "ignore", stderr: "ignore" },
);
if (ffmpeg.exitCode === 0 && existsSync(OUTPUT)) {
  console.log(`docs/demo.mp4 written (${Math.round(Bun.file(OUTPUT).size / 1024)} kB)`);
} else {
  renameSync(webm, join(ROOT, "docs", "demo.webm"));
  console.log("ffmpeg unavailable: kept docs/demo.webm");
}
