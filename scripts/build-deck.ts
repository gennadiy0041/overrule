/**
 * Builds the pitch deck: deck/deck.html → deck/Overrule_BusinessCup2.pdf (10 slides, 16:9),
 * plus one PNG per slide in deck/out/ for checking that nothing overflows.
 *
 *   bun run build-deck
 *
 * Screenshots come from the deployed product (bun run screenshots). Live numbers
 * are read from /metrics at build time (METRICS_TOKEN or .local/metrics-token.txt);
 * without a token the deck says where the numbers live instead of inventing any.
 */
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import QRCode from "qrcode";

const ROOT = join(import.meta.dir, "..");
const DECK = join(ROOT, "deck");
const APP_URL = process.env["APP_URL"] ?? "https://overrule-production.up.railway.app";
const SHORT_URL = APP_URL.replace(/^https?:\/\//, "");
const UNIT_TESTS = 344;

// ───────────────────────────── Inputs ─────────────────────────────

interface Metrics {
  sessions: { total: number; withScan: number; withAttempt: number; trials: number };
  microSurvey: { n: number; wouldPay: Record<string, number>; shippedAiError: Record<string, number> };
  fullSurvey: { n: number; answers: Record<string, Record<string, number>> };
}

async function liveMetrics(): Promise<Metrics | null> {
  const file = join(ROOT, ".local", "metrics-token.txt");
  const token = process.env["METRICS_TOKEN"] ?? (existsSync(file) ? readFileSync(file, "utf8").trim() : "");
  if (!token) return null;
  try {
    const response = await fetch(`${APP_URL}/metrics?token=${token}&format=json`, { signal: AbortSignal.timeout(20_000) });
    return response.ok ? ((await response.json()) as Metrics) : null;
  } catch {
    return null;
  }
}

interface PoolStats {
  totals: { accepted: number; generated: number; rejectedByVerify: number; providerErrors: number };
  perOccupation: Array<{ crossCheckedBy: Record<string, number> }>;
}

const pool = JSON.parse(readFileSync(join(ROOT, "data", "pool", "stats.json"), "utf8")) as PoolStats;
const drafts = pool.totals.generated - pool.totals.providerErrors;
/** Drills that also passed the blind cross-check by a second model ("none" = verified by code only). */
const crossChecked = pool.perOccupation.reduce(
  (n, o) => n + Object.entries(o.crossCheckedBy).reduce((m, [by, count]) => m + (by === "none" ? 0 : count), 0),
  0,
);
const crossCheckedShare = crossChecked === pool.totals.accepted ? "all" : `${crossChecked}`;
const metrics = await liveMetrics();
const builtOn = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const font = (pkg: string, file: string) =>
  `data:font/woff2;base64,${readFileSync(join(ROOT, "node_modules", "@fontsource-variable", pkg, "files", file)).toString("base64")}`;
const qr = await QRCode.toString(APP_URL, { type: "svg", margin: 0, color: { dark: "#14120F", light: "#00000000" } });

// ───────────────────────────── Building blocks ─────────────────────────────

const LOGO = `<span class="logo"><svg width="30" height="30" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#14120F"/><path d="M8 16.5l5.2 5.2L24 10.5" fill="none" stroke="#FAF7F2" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 23L26 9" stroke="#D93A2B" stroke-width="3" stroke-linecap="round"/></svg>overrule</span>`;

function slide(n: number, title: string, body: string, notes: string): string {
  return `<section class="slide">
  <header><p class="eyebrow">${String(n).padStart(2, "0")} / 10</p><h1>${title}</h1></header>
  <div class="body">${body}</div>
  <footer>${LOGO}<p class="notes">${notes}</p></footer>
</section>`;
}

const phone = (shot: string, caption = "") =>
  `<figure class="phone"><img src="shots/${shot}.png" alt="" />${caption ? `<figcaption>${caption}</figcaption>` : ""}</figure>`;
const stat = (figure: string, text: string) => `<div class="stat"><p class="figure">${figure}</p><p>${text}</p></div>`;
const tally = (t: Record<string, number> | undefined) =>
  Object.entries(t ?? {})
    .map(([answer, count]) => `${answer.replace(/_/g, " ")} ${count}`)
    .join(" · ") || "no answers yet";

function liveBox(): string {
  // No token, or nobody but us has finished a scan yet: say where the numbers live rather than print a row of zeros.
  if (!metrics || metrics.sessions.withScan === 0) {
    return `<div class="box"><p class="eyebrow">Live numbers</p><p>Funnel, retention and survey answers are measured in production from launch (${builtOn}) and shown, with N, at <b>/metrics</b>. Our own traffic is excluded.</p></div>`;
  }
  const surveyN = metrics.microSurvey.n + metrics.fullSurvey.n;
  const pay = { ...metrics.microSurvey.wouldPay };
  for (const [answer, count] of Object.entries(metrics.fullSurvey.answers["wouldPay"] ?? {})) pay[answer] = (pay[answer] ?? 0) + count;
  return `<div class="box"><p class="eyebrow">Live in production · ${builtOn}</p>
    <p><b>${metrics.sessions.total}</b> sessions · <b>${metrics.sessions.withScan}</b> scans · <b>${metrics.sessions.withAttempt}</b> with a scored drill · <b>${metrics.sessions.trials}</b> trials started</p>
    <p>“Would you pay $8/month?” — N = ${surveyN}${surveyN > 0 ? `: ${tally(pay)}` : ""}${surveyN < 10 ? " <i>(N &lt; 10: too few to conclude)</i>" : ""}</p>
    <p class="small">Internal traffic and the demo profile are excluded.</p></div>`;
}

// ───────────────────────────── Slides ─────────────────────────────

const slides = [
  `<section class="slide title">
    <div class="titleLeft">
      ${LOGO}
      <h1>AI does the work.<br/>You get paid for the judgment.</h1>
      <p class="lede">Overrule — a 5-minute daily drill and a rating for the skill people are now paid for: reviewing AI’s work.</p>
      <p class="meta">Business Cup 2.0 · Skills track · Gennady Kozlov — solo</p>
    </div>
    <div class="titleRight">
      ${phone("drill-phone")}
      <div class="qr">${qr}<p>${SHORT_URL}</p><p class="small">No sign-up. Try it now.</p></div>
    </div>
  </section>`,

  slide(
    2,
    "AI is now mandatory at work. Its mistakes are still yours.",
    `<div class="grid4">
      ${stat("58%", "of US workers rely on AI output without properly checking it<sup>1</sup>")}
      ${stat("57%", "have made mistakes in their work because of AI<sup>1</sup>")}
      ${stat("40%", "received AI “workslop” last month — 42% trusted the sender less<sup>2</sup>")}
      ${stat("Reviews", "Meta now formally assesses employees on how they use AI<sup>3</sup>")}
    </div>
    <blockquote>“The real challenge is not whether people use AI, but whether they know when to rely on it, when to question it and when to override it.”<cite>Shuhua Sun, Tulane University<sup>4</sup></cite></blockquote>`,
    "1 KPMG US, Trust in AI, Apr 2025 (n = 1,019) · 2 Stanford Social Media Lab × BetterUp Labs, via The Register, Sep 2025 · 3 eWeek, Feb 2026 · 4 VKTR, Mar 2026",
  ),

  slide(
    3,
    "Meet Jess: 34, marketing manager, AI in her review",
    `<div class="cols3">
      <div><p class="eyebrow">Who</p><ul>
        <li>Marketing manager at a 2,000-person company in Ohio</li>
        <li>The CEO announced “AI-first”; an AI item appeared in her review form</li>
        <li>Writes her reports with ChatGPT every day</li>
        <li>Last quarter an invented number reached her VP — and he noticed</li></ul></div>
      <div><p class="eyebrow">When she pays</p><ul>
        <li>Before a performance review</li>
        <li>Right after an AI mistake was caught by someone else</li>
        <li>When “uses AI well” becomes part of her job description</li></ul>
        <p class="pull">She is not afraid of losing her job. She is afraid of signing her name under a mistake.</p></div>
      <div><p class="eyebrow">How many</p>
        ${stat("≈ 22M", "US professionals: 73.3M employed aged 25–44<sup>1</sup> × 30% who use AI at work several times a week<sup>2</sup>")}
        <p class="small">Our estimate. Launch professions: marketing, finance, HR, project management, customer service — the product works for all 923 occupations.</p></div>
    </div>`,
    "Illustrative persona, not a real person · 1 BLS, Current Population Survey 2025 · 2 Gallup AI indicator, May 2026",
  ),

  slide(
    4,
    "AI replaces book knowledge, not judgment",
    `<div class="cols2">
      <div>
        <div class="grid2">
          ${stat("−13%", "relative employment for ages 22–25 in the most AI-exposed occupations<sup>1</sup>")}
          ${stat("+6–12%", "for workers aged 30+ in the same occupations<sup>2</sup>")}
        </div>
        <p class="pull">Where AI drafts the document, the scarce skill is knowing what is wrong with it — before it goes out.</p>
        <p>Courses teach people to do more with AI. Nobody trains, or measures, the other half: when to overrule it.</p>
      </div>
      <div class="shotWide">${phone("map-phone", "The free scan: how much of <i>your</i> work AI can already draft — from task-level labour data, weighted by what you actually do.")}</div>
    </div>`,
    "1 Brynjolfsson, Chandar, Chen, “Canaries in the Coal Mine?”, Stanford Digital Economy Lab, Aug 2025 · 2 TIME on the same study",
  ),

  slide(
    5,
    "Discover → Develop → Prove",
    `<div class="cols3 shots">
      ${phone("map-phone", "<b>Discover.</b> Free scan → a personal exposure map built on 19,265 human-labelled tasks across 923 occupations.")}
      ${phone("drill-phone", "<b>Develop.</b> An AI-written document from your job: 3–4 planted mistakes and lines that only look wrong.")}
      ${phone("dashboard-phone", "<b>Prove.</b> A Judgment Score (Elo), a streak, and a report for your next review.")}
    </div>`,
    "All screenshots are the live product. The dashboard shows the demo profile (a simulated week played through the real engine).",
  ),

  slide(
    6,
    "Catch today’s AI mistake — live",
    `<div class="cols3 live">
      <div class="liveLeft">
        <div class="qrBig">${qr}<div><p><b>${SHORT_URL}</b></p><p class="small">No sign-up · 2 minutes · any of 923 occupations</p></div></div>
        <div class="facts">
          <p><b>Generated, then proven.</b> One model call writes the document and its key; deterministic code verifies it. Every number is recomputed by our own evaluator.</p>
          <p><b>Never a dead end.</b> Claude → retry with the verifier’s notes → Gemini → verified pool. No provider errors, ever.</p>
          <p><b>Calibration, not suspicion.</b> Misses cost points — and so do false alarms.</p>
        </div>
      </div>
      ${phone("sheet-phone", "Tap a line, name the mistake, say why.")}
      ${phone("review-phone", "Every flag is scored by code against an answer key.")}
    </div>`,
    `Launch pool: ${drafts} model drafts · ${pool.totals.rejectedByVerify} rejected by the verifier · ${pool.totals.accepted} drills accepted, ${crossCheckedShare} of them also solved blind by a second model`,
  ),

  slide(
    7,
    "Why they come back tomorrow",
    `<div class="cols2 wideRight">
      <ul class="big">
        <li><b>Daily Catch.</b> One shared drill per profession per day. Miss it and it is gone.</li>
        <li><b>Streak + Judgment Score.</b> The score only moves when you play.</li>
        <li><b>Shareable result.</b> A Wordle-style grid: green, amber, red — and black for false alarms.</li>
        <li><b>Weekly Debrief.</b> Strongest and weakest mistake type, false-alarm rate.</li>
        <li><b>Review Report.</b> A printable record for the next performance review.</li>
        <li><b>The metric that matters: renewal.</b> Only ~8% of monthly subscriptions survive a year<sup>1</sup> — so annual is the default plan.</li>
      </ul>
      <figure class="desktop"><img src="shots/dashboard-desktop.png" alt="" /></figure>
    </div>`,
    "1 RevenueCat, State of Subscription Apps 2026 · Dashboard: demo profile, simulated week",
  ),

  slide(
    8,
    "CAC ≈ $48, paid back on the first payment",
    `<div class="cols2">
      <div>
        <p class="eyebrow">Funnel hypothesis · per 1,000 clicks at $1</p>
        <table>
          <tr><td>Start the scan</td><td>600</td></tr>
          <tr><td>See their map</td><td>420</td></tr>
          <tr><td>Finish the first drill</td><td>290</td></tr>
          <tr><td>Start a trial</td><td>60</td></tr>
          <tr><td><b>Pay</b></td><td><b>21 → CAC ≈ $48</b></td></tr>
        </table>
        <p class="small">A hypothesis, to be tested with a $300–500 ad test. If clicks cost more: SEO and sharing are free channels.</p>
      </div>
      <div>
        <p class="eyebrow">Price and lifetime value · estimate</p>
        <table>
          <tr><td>Annual (default, 7-day trial)</td><td>$99.99</td></tr>
          <tr><td>Monthly</td><td>$19.99</td></tr>
          <tr><td>Average first payment (50/50 mix)</td><td>≈ $60</td></tr>
          <tr><td><b>Blended LTV, net of fees and refunds</b></td><td><b>≈ $95</b></td></tr>
        </table>
        <p class="small">Monthly: 3.5 payments ≈ $70. Annual: $99.99 + 30% renewals<sup>1</sup> ≈ $130. LTV/CAC ≈ 2 today, target 3. Web checkout: no 15–30% store fee.</p>
        ${liveBox()}
      </div>
    </div>`,
    "1 RevenueCat 2026: first renewal of annual plans is 23–40% by category · Unit economics are hypotheses, labelled as such",
  ),

  slide(
    9,
    "Path to $100M ARR",
    `<div class="cols2 wideRight">
      <div>
        ${stat("1M × $100", "paying members × revenue per year = $100M ARR — about 4.5% of the ≈ 22M frequent AI users aged 25–44 (estimate)")}
        <ul>
          <li><b>923 SEO pages, live today.</b> “Will AI replace {job}?” — each one ends in the scan.</li>
          <li><b>The shareable grid.</b> Every Daily Catch result is a post.</li>
          <li><b>Quiz-funnel ads.</b> Scan → personal map → first catch → paywall.</li>
          <li><b>LinkedIn, in review season.</b> “AI in my review” is the purchase moment.</li>
        </ul>
        <p class="pull">Tailwind: frequent AI use at work went from 11% to 30% in three years<sup>1</sup>.</p>
      </div>
      <figure class="desktop"><img src="shots/seo-desktop.png" alt="" /></figure>
    </div>`,
    "1 Gallup AI indicator, May 2023 → May 2026 · Market size is our estimate from BLS and Gallup figures",
  ),

  slide(
    10,
    "Why us, why now",
    `<div class="cols2">
      <div>
        <p class="eyebrow">Alternatives</p>
        <table class="compact">
          <tr><td>Coursiv</td><td>teaches using AI tools — the step before us</td></tr>
          <tr><td>Lacuna</td><td>free hallucination-spotting trainer, mostly for lawyers</td></tr>
          <tr><td>Slopcheck</td><td>daily “AI photo or real?” game</td></tr>
          <tr><td>Hallucination Lab</td><td>learning games</td></tr>
          <tr><td>HumanEdge AI</td><td>workshops for executives</td></tr>
        </table>
        <p class="pull">Overrule: drills from <i>your</i> tasks on labour data · blind drills with decoys, scored for calibration · a consumer subscription.</p>
      </div>
      <div>
        <p class="eyebrow">Built solo in 24 hours — and live</p>
        <div class="grid2 tight">
          ${stat("923", "occupations, 19,265 tasks; published scores reproduced exactly — as a unit test")}
          ${stat(String(pool.totals.accepted), `verified drills in the launch pool; ${crossCheckedShare} also passed a blind cross-check`)}
          ${stat(String(UNIT_TESTS), "automated tests, plus end-to-end runs on phone and desktop")}
          ${stat("0", "sign-ups needed: the whole path works for the jury right now")}
        </div>
        <p class="eyebrow next">Next</p>
        <p>A $300–500 ad test on the scan funnel · real checkout · “Second Look” for your own AI drafts.</p>
      </div>
    </div>`,
    "Coursiv teaches you to do more with AI. Overrule trains you not to sign off on its mistakes.",
  ),
];

// ───────────────────────────── Document ─────────────────────────────

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>Overrule — Business Cup 2.0</title>
<style>
@font-face { font-family: "Fraunces"; src: url("${font("fraunces", "fraunces-latin-opsz-normal.woff2")}") format("woff2"); font-weight: 100 900; }
@font-face { font-family: "Geist"; src: url("${font("geist", "geist-latin-wght-normal.woff2")}") format("woff2"); font-weight: 100 900; }
@page { size: 1280px 720px; margin: 0; }
* { box-sizing: border-box; margin: 0; }
body { background: #FAF7F2; color: #14120F; font: 19px/1.45 "Geist", sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.slide { width: 1280px; height: 720px; padding: 44px 60px 34px; display: flex; flex-direction: column; overflow: hidden; page-break-after: always; position: relative; }
h1 { font: 500 46px/1.06 "Fraunces", serif; letter-spacing: -0.02em; font-variation-settings: "opsz" 144; max-width: 1040px; }
.eyebrow { font-size: 12.5px; font-weight: 600; letter-spacing: 0.09em; text-transform: uppercase; color: #6B655A; margin-bottom: 8px; }
header { margin-bottom: 24px; }
.body { flex: 1; min-height: 0; }
footer { display: flex; align-items: flex-end; justify-content: space-between; gap: 32px; padding-top: 12px; }
.logo { display: inline-flex; align-items: center; gap: 9px; font: 500 21px/1 "Fraunces", serif; letter-spacing: -0.02em; flex-shrink: 0; }
.notes { font-size: 11.5px; line-height: 1.4; color: #6B655A; text-align: right; max-width: 880px; }
.small { font-size: 13.5px; color: #6B655A; line-height: 1.4; }
sup { font-size: 0.6em; color: #6B655A; }
b { font-weight: 600; }
ul { padding-left: 20px; } li { margin-bottom: 9px; }
ul.big li { margin-bottom: 15px; font-size: 19.5px; }
.cols2 { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; height: 100%; }
.cols2.wideRight { grid-template-columns: 5fr 6fr; }
.cols3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 36px; height: 100%; }
.grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 28px; } .grid4 .stat .figure { font-size: 66px; } .grid4 .stat p:last-child { font-size: 18px; }
.grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
.grid2.tight { gap: 14px 28px; }
.stat { border-top: 1.5px solid #14120F; padding-top: 12px; }
.stat .figure { font: 500 54px/1 "Fraunces", serif; letter-spacing: -0.02em; margin-bottom: 8px; font-variation-settings: "opsz" 144; }
.stat p:last-child { font-size: 16.5px; line-height: 1.35; color: #48433B; }
.tight .stat .figure { font-size: 42px; } .tight .stat p:last-child { font-size: 14.5px; }
blockquote { margin-top: 54px; font: 400 35px/1.22 "Fraunces", serif; letter-spacing: -0.01em; max-width: 1080px; }
cite { display: block; font: 400 15px "Geist", sans-serif; color: #6B655A; margin-top: 12px; font-style: normal; }
.pull { font: 500 23px/1.25 "Fraunces", serif; letter-spacing: -0.01em; margin: 18px 0 14px; padding-left: 14px; border-left: 3px solid #D93A2B; }
table { width: 100%; border-collapse: collapse; margin: 4px 0 10px; font-size: 17.5px; }
td { padding: 8px 0; border-bottom: 1px solid #E2DBCE; } td:last-child { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; padding-left: 16px; }
table.compact td { padding: 7px 0; font-size: 16px; } table.compact td:last-child { text-align: left; white-space: normal; color: #48433B; }
table.compact td:first-child { font-weight: 600; white-space: nowrap; }
.box { margin-top: 12px; border: 1px solid #C9C0B0; border-radius: 12px; padding: 12px 16px; background: #FFFDF9; font-size: 15px; line-height: 1.45; }
.box .eyebrow { margin-bottom: 4px; }
.next { margin-top: 16px; }
.phone { display: flex; flex-direction: column; align-items: center; min-height: 0; height: 100%; }
.phone img { flex: 1; min-height: 0; max-width: 100%; object-fit: contain; object-position: top; border: 1px solid #C9C0B0; border-radius: 22px; box-shadow: 0 14px 34px -18px rgba(20,18,15,.35); background: #FAF7F2; }
.phone figcaption { font-size: 15px; line-height: 1.35; color: #48433B; margin-top: 12px; text-align: center; max-width: 330px; }
.desktop { height: 100%; min-height: 0; overflow: hidden; border: 1px solid #C9C0B0; border-radius: 14px; box-shadow: 0 14px 34px -18px rgba(20,18,15,.35); }
.desktop img { width: 100%; display: block; }
.shots { align-items: stretch; }
.live { grid-template-columns: 1.25fr 0.9fr 0.9fr; }
.liveLeft { display: flex; flex-direction: column; justify-content: space-between; min-height: 0; }
.facts { font-size: 15.5px; line-height: 1.4; color: #48433B; } .facts b { color: #14120F; } .facts p { margin-top: 10px; }
.qrBig { display: flex; align-items: center; gap: 22px; }
.qrBig svg { width: 168px; height: 168px; flex-shrink: 0; } .qrBig b { font-size: 18px; } .qrBig p { margin-bottom: 4px; }
.shotWide { height: 100%; min-height: 0; }
.title { flex-direction: row; gap: 56px; padding: 56px 64px; }
.titleLeft { flex: 1.25; display: flex; flex-direction: column; justify-content: center; }
.titleLeft .logo { font-size: 30px; margin-bottom: 44px; } .titleLeft .logo svg { width: 42px; height: 42px; }
.title h1 { font-size: 66px; line-height: 1.02; }
.lede { font-size: 23px; line-height: 1.4; color: #48433B; margin-top: 24px; max-width: 600px; }
.meta { margin-top: 40px; font-size: 16px; color: #6B655A; }
.titleRight { flex: 1; display: flex; gap: 28px; align-items: center; min-height: 0; }
.titleRight .phone { flex: 1; }
.qr { width: 170px; text-align: center; font-size: 12.5px; line-height: 1.35; } .qr svg { width: 170px; height: 170px; margin-bottom: 10px; }
</style></head>
<body>
${slides.join("\n")}
</body></html>`;

mkdirSync(join(DECK, "out"), { recursive: true });
const htmlPath = join(DECK, "deck.html");
await Bun.write(htmlPath, html);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
await page.pdf({ path: join(DECK, "Overrule_BusinessCup2.pdf"), width: "1280px", height: "720px", printBackground: true });

// One PNG per slide, and a report of anything that spills out of its slide.
const frames = page.locator(".slide");
const count = await frames.count();
for (let i = 0; i < count; i++) {
  await frames.nth(i).screenshot({ path: join(DECK, "out", `slide-${String(i + 1).padStart(2, "0")}.png`) });
}
const overflow = await page.evaluate(() =>
  [...document.querySelectorAll<HTMLElement>(".slide")].flatMap((slideElement, index) => {
    const box = slideElement.getBoundingClientRect();
    const spills = [...slideElement.querySelectorAll<HTMLElement>("*")].some((element) => {
      const r = element.getBoundingClientRect();
      return r.width > 0 && (r.bottom > box.bottom + 1 || r.right > box.right + 1);
    });
    return spills ? [index + 1] : [];
  }),
);
await browser.close();
console.log(`deck: ${count} slides → deck/Overrule_BusinessCup2.pdf${metrics ? " (live metrics included)" : " (no metrics token: live numbers omitted)"}`);
console.log(overflow.length ? `OVERFLOW on slides: ${overflow.join(", ")}` : "no overflow");
if (count > 10) throw new Error("The deck must not exceed 10 slides");
