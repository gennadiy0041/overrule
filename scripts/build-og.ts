/**
 * Renders the Open Graph image (public/og.png, 1200×630) from HTML with the
 * product's own fonts and colours. Run: bun scripts/build-og.ts
 */
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
// Fonts are inlined as data URLs: a page created with setContent may not read file:// resources.
const font = (pkg: string, file: string) =>
  `data:font/woff2;base64,${readFileSync(join(ROOT, "node_modules", "@fontsource-variable", pkg, "files", file)).toString("base64")}`;

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @font-face { font-family: "Fraunces"; src: url("${font("fraunces", "fraunces-latin-opsz-normal.woff2")}") format("woff2"); font-weight: 100 900; }
  @font-face { font-family: "Geist"; src: url("${font("geist", "geist-latin-wght-normal.woff2")}") format("woff2"); font-weight: 100 900; }
  * { box-sizing: border-box; margin: 0; }
  body { width: 1200px; height: 630px; background: #FAF7F2; color: #14120F; font-family: "Geist", sans-serif; padding: 64px 72px; display: flex; flex-direction: column; justify-content: space-between; }
  .logo { display: flex; align-items: center; gap: 14px; font-family: "Fraunces", serif; font-size: 40px; font-weight: 500; letter-spacing: -0.02em; }
  h1 { font-family: "Fraunces", serif; font-weight: 500; font-size: 84px; line-height: 1.02; letter-spacing: -0.025em; font-variation-settings: "opsz" 144; max-width: 1000px; }
  .doc { font-size: 27px; line-height: 1.5; color: #48433B; max-width: 1056px; }
  .flag { background: #FBE7E3; color: #14120F; border-bottom: 3px solid #D93A2B; padding: 2px 6px; border-radius: 4px; }
  .chip { display: inline-block; margin-left: 10px; background: #D93A2B; color: #fff; font-size: 20px; font-weight: 600; padding: 3px 12px; border-radius: 999px; vertical-align: 3px; }
  .foot { display: flex; justify-content: space-between; align-items: flex-end; font-size: 24px; color: #6B655A; }
</style>
</head>
<body>
  <div class="logo">
    <svg width="52" height="52" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#14120F"/><path d="M8 16.5l5.2 5.2L24 10.5" fill="none" stroke="#FAF7F2" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 23L26 9" stroke="#D93A2B" stroke-width="3" stroke-linecap="round"/></svg>
    overrule
  </div>
  <h1>AI does the work. You get paid for the judgment.</h1>
  <div>
    <p class="doc">“Blended ROAS rose from 2.6x to 3.0x, <span class="flag">a 40% improvement.</span><span class="chip">Numbers · it’s +15%</span>”</p>
    <div class="foot" style="margin-top: 28px">
      <span>A 5-minute daily drill: catch what AI gets wrong — before your boss does.</span>
    </div>
  </div>
</body>
</html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: join(ROOT, "public", "og.png"), type: "png" });
await browser.close();
console.log("public/og.png written");
