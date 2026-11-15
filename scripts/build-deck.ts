/**
 * Builds the pitch deck in two forms from one set of slides (10 slides, 16:9):
 *
 *   deck/Overrule_BusinessCup2.pdf  the submission: slide 3 shows frames of the film and a QR code to it
 *   deck/pitch.html                 the stage version: opens in a browser, slide 3 plays the film
 *
 * plus deck/deck.html (the print source) and one PNG per slide in deck/out/ for
 * checking that nothing overflows.
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
const UNIT_TESTS = 352;

// ───────────────────────────── The founder's story ─────────────────────────────

/**
 * The opening is the founder's own: Kalyp is his earlier project and the four
 * positions are his account. The layoffs figure is a published one and carries its source.
 */
const LAYOFFS = {
  figure: "121,401",
  text: "announced US job cuts in January–October 2026 for which the employer named AI as the reason — more than twice the AI figure for all of 2025. In all, 617,189 cuts were announced.",
  source:
    "Challenger, Gray & Christmas, October 2026 report (Nov 5, 2026): job cuts announced by US-based employers, by stated reason; AI was cited in 54,836 in all of 2025",
};

/** The last slide: the proverb, the two halves of it, the callback to the first slide, the ask. */
const CLOSING = {
  proverb: "“Trust, but verify.”",
  origin:
    "The Russian proverb «Доверяй, но проверяй», as Ronald Reagan quoted it to Mikhail Gorbachev at the signing of the INF Treaty, December 8, 1987. Gorbachev: “You repeat that at every meeting.”",
  halves: "<b>Coursiv</b> teaches people to do more with AI.<br/><b>Overrule</b> trains them to check what comes back.",
  whole: "Same customer, next step: both halves of the proverb.",
  callback: "Kalyp took the rulebook, not the responsibility. Overrule trains the call.",
  ask: "Two minutes, no login: catch today’s AI mistake.",
};

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
/** The day the product went live; a fact, so it does not move when the deck is rebuilt. */
const LAUNCHED = "Nov 15, 2026";

const font = (pkg: string, file: string) =>
  `data:font/woff2;base64,${readFileSync(join(ROOT, "node_modules", "@fontsource-variable", pkg, "files", file)).toString("base64")}`;
const qrOptions = { type: "svg", margin: 0, color: { dark: "#14120F", light: "#00000000" } } as const;
const qr = await QRCode.toString(APP_URL, qrOptions);
const qrFilm = await QRCode.toString(`${APP_URL}/film`, qrOptions);

// ───────────────────────────── Building blocks ─────────────────────────────

const MARK = `<svg width="30" height="30" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#14120F"/><path d="M8 16.5l5.2 5.2L24 10.5" fill="none" stroke="#FAF7F2" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 23L26 9" stroke="#D93A2B" stroke-width="3" stroke-linecap="round"/></svg>`;
const LOGO = `<span class="logo">${MARK}overrule</span>`;
/** The same mark for dark slides: a paper tile instead of an ink one. */
const LOGO_ON_DARK = `<span class="logo"><svg width="30" height="30" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#FAF7F2"/><path d="M8 16.5l5.2 5.2L24 10.5" fill="none" stroke="#14120F" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 23L26 9" stroke="#D93A2B" stroke-width="3" stroke-linecap="round"/></svg>overrule</span>`;

const eyebrow = (n: number, label = "") =>
  `<p class="eyebrow">${String(n).padStart(2, "0")} / 10${label ? ` · ${label}` : ""}</p>`;

/** A product slide. `label` names the judging question the slide answers, in the organisers' own words. */
function slide(n: number, label: string, title: string, body: string, notes: string): string {
  return `<section class="slide">
  <header>${eyebrow(n, label)}<h1>${title}</h1></header>
  <div class="body">${body}</div>
  <footer>${LOGO}<p class="notes">${notes}</p></footer>
</section>`;
}

const REPO_URL = "https://github.com/gennadiy0041/overrule";
const SHORT_REPO = REPO_URL.replace(/^https?:\/\//, "");
/** Addresses and QR codes are links: the PDF is read on a laptop, where a QR code is one step too many. */
const link = (href: string, inner: string) => `<a href="${href}">${inner}</a>`;

const phone = (shot: string, caption = "") =>
  `<figure class="phone"><img src="shots/${shot}.png" alt="" />${caption ? `<figcaption>${caption}</figcaption>` : ""}</figure>`;
const stat = (figure: string, text: string) => `<div class="stat"><p class="figure">${figure}</p><p>${text}</p></div>`;
const tally = (t: Record<string, number> | undefined) =>
  Object.entries(t ?? {})
    .map(([answer, count]) => `${answer.replace(/_/g, " ")} ${count}`)
    .join(" · ") || "no answers yet";

function liveBox(): string {
  // No token, or nobody but us has finished a scan yet: say so plainly rather than print a row of zeros.
  if (!metrics || metrics.sessions.withScan === 0) {
    return `<div class="box"><p class="eyebrow">What is measured — and what is not yet</p><p>Launched ${LAUNCHED}. No outside users yet: every funnel number in this deck is a hypothesis. Production already records scan → map → first drill → trial, next-day return and shares, with our own traffic excluded.</p></div>`;
  }
  const surveyN = metrics.microSurvey.n + metrics.fullSurvey.n;
  const pay = { ...metrics.microSurvey.wouldPay };
  for (const [answer, count] of Object.entries(metrics.fullSurvey.answers["wouldPay"] ?? {})) pay[answer] = (pay[answer] ?? 0) + count;
  return `<div class="box"><p class="eyebrow">Live in production · launched ${LAUNCHED} · as of ${builtOn}</p>
    <p><b>${metrics.sessions.total}</b> sessions · <b>${metrics.sessions.withScan}</b> scans · <b>${metrics.sessions.withAttempt}</b> with a scored drill · <b>${metrics.sessions.trials}</b> trials started</p>
    <p>“Would you pay $8/month?” — N = ${surveyN}${surveyN > 0 ? `: ${tally(pay)}` : ""}${surveyN < 10 ? " <i>(N &lt; 10: too few to conclude)</i>" : ""}</p>
    <p class="small">Internal traffic and the demo profile are excluded.</p></div>`;
}

// ───────────────────────────── Slides ─────────────────────────────

/**
 * 1. The founder walks out to a logo nobody in the room knows. On stage it stands alone;
 * in the PDF, which the jury reads without him, a caption says what it is and what is submitted.
 */
const kalypSlide = (caption: boolean) => `<section class="slide kalyp${caption ? " captioned" : ""}">
  <img src="assets/kalyp-logo.png" alt="Kalyp" />
  ${
    caption
      ? `<div class="caption">
    <p><b>Kalyp</b> — the project I built before this one. It is not what I am submitting; it is why.</p>
    <p><b>Overrule</b> — a 5-minute daily drill that trains US professionals to catch the mistakes in AI’s work. B2C · web · live with no login: ${link(APP_URL, `<b>${SHORT_URL}</b>`)}</p>
  </div>`
      : ""
  }
  <p class="tag">Overrule · Business Cup 2.0 · Skills track · Gennady Kozlov, solo</p>
  <p class="tag right">01 / 10</p>
</section>`;

/** 2. What that logo did, what the same force is doing at scale, and the lesson the product is built on. */
const turnSlide = `<section class="slide night">
  <header>${eyebrow(2, "Why I built Overrule")}<h1>Software took the rulebook. The responsibility stayed human.</h1></header>
  <div class="body">
    <div class="turn">
      <div class="stat"><p class="figure">4</p><p>positions in normokontrol — the checking of student theses against formatting standards — closed by my university after Kalyp, the checker I built as a student in September, went live. I did not plan it; I learned of it afterwards.</p></div>
      <div class="stat"><p class="figure">${LAYOFFS.figure}</p><p>${LAYOFFS.text}<sup>1</sup></p></div>
    </div>
    <p class="pull">A program can check formatting against a standard. Whether a number in a report is right is written in no standard. Overrule trains that call — and does not promise to save a job.</p>
    <blockquote class="loud">“Artificial intelligence is gonna replace literally half of all white-collar workers in the U.S.”<cite>Jim Farley, CEO of Ford<sup>2</sup></cite></blockquote>
  </div>
  <footer><p class="notes left">Kalyp is the founder’s earlier project; the four positions are his own account · 1 ${LAYOFFS.source} · 2 Aspen Ideas Festival, June 2025, as quoted by Fortune, Jul 5, 2025</p></footer>
</section>`;

/** 3 (print). The film as four frames and a way to watch it. */
const filmSlidePrint = `<section class="slide cinema">
  <header>${eyebrow(3, "The first ad creative")}<h1>The ad is already made: 30 seconds.</h1></header>
  <div class="body filmBody">
    <a class="strip" href="${APP_URL}/film">
      <img src="assets/film-a.jpg" alt="" /><img src="assets/film-b.jpg" alt="" />
      <img src="assets/film-c.jpg" alt="" /><img src="assets/film-d.jpg" alt="" />
      <span class="play"><svg viewBox="0 0 24 24" width="34" height="34"><path d="M8 5v14l11-7z" fill="#14120F"/></svg></span>
    </a>
    <div class="filmSide">
      ${link(`${APP_URL}/film`, `<div class="qrTile">${qrFilm}</div>`)}
      <p class="watch">${link(`${APP_URL}/film`, `<b>${SHORT_URL}/film</b>`)}<br/><span>Click or scan to watch · 0:30 · sound on</span></p>
      <blockquote>“AI wrote this. Looks right. Catch the mistake. Forty percent? It’s fifteen. … AI does the work. You make the call.”</blockquote>
      <p class="hook">The hook for paid social: <b>“Catch what AI gets wrong — before your boss does.”</b></p>
    </div>
  </div>
  <footer><p class="notes left">Made within the same 24 hours: stock footage, a synthetic voice-over, and a product scene built from the product’s own interface.</p></footer>
</section>`;

/** 3 (stage). The film itself. */
const filmSlideLive = `<section class="slide filmLive">
  <video preload="auto" playsinline poster="assets/film-c.jpg">
    <source src="film-full.mp4" type="video/mp4" />
    <source src="../public/film.mp4" type="video/mp4" />
  </video>
</section>`;

const productSlides = [
  slide(
    4,
    "Who we sell to",
    "AI does the work. You get paid for the judgment.",
    `<div class="cols2">
      <div>
        <p class="lede">Overrule is a 5-minute daily drill and a rating for the skill people are now paid for: checking AI’s work — and knowing when to overrule it.</p>
        <p class="eyebrow gap">Who pays</p>
        <ul>
          <li><b>Jess, 34, marketing manager</b> at a 2,000-person company in Ohio. The CEO announced “AI-first”; an AI item appeared in her review form.</li>
          <li>She writes her reports with ChatGPT every day. Last quarter an invented number reached her VP — and he noticed.</li>
          <li>She pays before a performance review, or right after someone else catches an AI mistake in her work.</li>
        </ul>
        <p class="pull">She is not afraid of losing her job. She is afraid of putting her name to a mistake.</p>
      </div>
      <div>
        <div class="grid2 tight">
          ${stat("58%", "of US workers rely on AI output without properly checking it<sup>1</sup>")}
          ${stat("57%", "have made mistakes in their work because of AI<sup>1</sup>")}
          ${stat("≈ 22M", "US workers aged 25–44 who use AI at work a few times a week or more<sup>2</sup> — our estimate")}
          ${stat("Reviews", "Meta now formally assesses employees on how they use AI<sup>3</sup>")}
        </div>
        <blockquote class="aside">“It should be the tech that you don’t trust that much.”<cite>Sam Altman, CEO of OpenAI, on ChatGPT<sup>4</sup></cite></blockquote>
      </div>
    </div>`,
    "Illustrative persona, not a real person · 1 KPMG US, Trust in AI, Apr 2025 (n = 1,019) · 2 73.3M employed aged 25–44 (BLS, CPS 2025) × 30% (Gallup AI indicator, May 2026) · 3 eWeek, Feb 2026 · 4 OpenAI Podcast, June 2025, as reported in the press",
  ),

  slide(
    5,
    "What we sell",
    "Discover → Develop → Prove",
    `<div class="cols3 shots">
      ${phone("map-phone", "<b>Discover.</b> Free scan → a personal exposure map built on 19,265 human-labeled tasks across 923 occupations.")}
      ${phone("drill-phone", "<b>Develop.</b> An AI-written document from your job: 3–4 planted mistakes and lines that only look wrong.")}
      ${phone("dashboard-phone", "<b>Prove.</b> A Judgment Score (Elo), a streak, and a record for your self-review.")}
    </div>`,
    "Exposure data: Eloundou et al., “GPTs are GPTs” (2023), human task labels over O*NET · All screenshots are the live product; the dashboard shows the demo profile (a simulated week played through the real engine)",
  ),

  slide(
    6,
    "It works — live",
    "Catch today’s AI mistake — live",
    `<div class="cols3 live">
      <div class="liveLeft">
        <div class="qrBig">${link(APP_URL, qr)}<div><p>${link(APP_URL, `<b>${SHORT_URL}</b>`)}</p><p class="small">No sign-up · 2 minutes · any of 923 occupations</p><p class="small">Code: ${link(REPO_URL, `<b>${SHORT_REPO}</b>`)}</p></div></div>
        <div class="facts">
          <p><b>Generated, then proven.</b> One model call writes the document and its key; deterministic code verifies it. Every number is recomputed by our own evaluator.</p>
          <p><b>Never a dead end.</b> Claude → retry with the verifier’s notes → Gemini → verified pool. If the models fail, you get a pool drill, and the page says so.</p>
          <p><b>Calibration, not suspicion.</b> Misses cost points — and so do false alarms.</p>
        </div>
      </div>
      ${phone("sheet-phone", "Tap a line, name the mistake, say why.")}
      ${phone("review-phone", "Every flag is scored by code against an answer key.")}
    </div>`,
    `Launch pool: ${pool.totals.accepted} verified drills — ${drafts - pool.totals.rejectedByVerify} kept from ${drafts} model drafts (${pool.totals.rejectedByVerify} rejected by the verifier) + ${pool.totals.accepted - (drafts - pool.totals.rejectedByVerify)} written during the build · ${crossCheckedShare} ${pool.totals.accepted} passed a blind cross-check: a second model had to find at least half of the planted mistakes`,
  ),

  slide(
    7,
    "What we sell · why they come back tomorrow",
    "Why they come back tomorrow",
    `<div class="cols2 wideRight">
      <ul class="big">
        <li><b>Free — the habit.</b> Daily Catch: one shared drill per profession per day; miss it and it is gone. A streak, a Judgment Score, a shareable Wordle-style grid.</li>
        <li><b>Paid — $99.99 a year</b> (7-day trial) or $19.99 a month. Personal drills from your own tasks, weak-spot training, a Weekly Debrief, a Review Report for your self-review.</li>
        <li><b>The trigger.</b> The streak resets at midnight ET; a daily calendar reminder is one tap. No email or push yet — the next thing to build.</li>
        <li><b>Measured in production:</b> next-day return, Daily Catch completions, shares.</li>
        <li><b>The metric that matters: renewal.</b> Only ~8% of monthly app subscriptions survive a year<sup>1</sup> — so annual is the default plan.</li>
      </ul>
      <figure class="desktop"><img src="shots/dashboard-desktop.png" alt="" /></figure>
    </div>`,
    "1 RevenueCat, State of Subscription Apps 2026 · Dashboard: demo profile, simulated week",
  ),

  slide(
    8,
    "Why it makes money",
    "Hypothesis: CAC ≈ $48, paid back on the first payment",
    `<div class="cols3 money">
      <div>
        <p class="eyebrow">Funnel hypothesis · per 1,000 clicks at $1</p>
        <table>
          <tr><td>Start the scan</td><td>600 · 60%</td></tr>
          <tr><td>See their map</td><td>420 · 70%</td></tr>
          <tr><td>Finish the first drill</td><td>290 · 69%</td></tr>
          <tr><td>Start a trial or a monthly plan</td><td>60 · 21%</td></tr>
          <tr><td><b>Pay</b></td><td><b>21 · 35% → CAC ≈ $48</b></td></tr>
        </table>
        <p class="small">Untested: there are no outside users yet. The test is $300–500 of paid social with the film on slide 3 as the first creative. Fewer than 3 trial starts per 100 clicks would mean LTV &lt; CAC.</p>
      </div>
      <div>
        <p class="eyebrow">Price and lifetime value · estimate</p>
        <table>
          <tr><td>Annual (default, 7-day trial)</td><td>$99.99</td></tr>
          <tr><td>Monthly</td><td>$19.99</td></tr>
          <tr><td>Average first payment</td><td>≈ $60</td></tr>
          <tr><td><b>Blended LTV, after fees and refunds</b></td><td><b>≈ $95</b></td></tr>
        </table>
        <p class="small">Assumes half choose annual. Monthly: 3.5 payments ≈ $70. Annual: $99.99 + 30% first renewal<sup>1</sup> ≈ $130. Blend ≈ $100, before model costs: a live drill costs about $0.06 (measured). LTV/CAC ≈ 2 on these assumptions; target 3. Checkout in this build is a demo: no payment is taken.</p>
      </div>
      <div>
        <p class="eyebrow">Path to $100M ARR</p>
        ${stat("1M × $100", "paying members × revenue a year — about 4.5% of the ≈ 22M frequent AI users aged 25–44 (estimate)")}
        <ul class="channels">
          <li><b>923 SEO pages, live today:</b> “Will AI replace {job}?” — each ends in the scan.</li>
          <li><b>The shareable grid:</b> every Daily Catch result is a post.</li>
          <li><b>Quiz-funnel ads:</b> scan → personal map → first catch → paywall.</li>
        </ul>
      </div>
    </div>`,
    "1 RevenueCat 2026: first renewal of annual plans is 23–40% by category · Unit economics and market size are hypotheses, labeled as such",
  ),

  slide(
    9,
    "Why it is new",
    "Why now, and why it is new",
    `<div class="cols2">
      <div>
        <p class="eyebrow">Alternatives</p>
        <table class="compact">
          <tr><td>Lacuna</td><td>free hallucination-spotting trainer, mostly for lawyers</td></tr>
          <tr><td>Slopcheck</td><td>daily “AI photo or real?” game</td></tr>
          <tr><td>Hallucination Lab</td><td>learning games</td></tr>
          <tr><td>HumanEdge AI</td><td>workshops for executives</td></tr>
        </table>
        <p class="small"><b>Not an alternative: Coursiv</b> teaches people to use AI tools. The same people then answer for what AI produces — that is our user.</p>
        <p class="pull">Overrule: drills built from <i>your own</i> tasks, on public labor data · blind drills with decoys, scored for calibration · a consumer subscription.</p>
        <p class="small">Why now: in the most AI-exposed occupations, relative employment of 22–25-year-olds fell 13%, while workers aged 30+ gained 6–12%<sup>1</sup>. The authors’ explanation: AI substitutes for codified “book” knowledge more than for experience.</p>
      </div>
      <div>
        <p class="eyebrow">Built solo in 24 hours — and live</p>
        <div class="grid2 tight">
          ${stat("923", "occupations, 19,265 tasks; published scores reproduced exactly — as a unit test")}
          ${stat(String(pool.totals.accepted), `verified drills in the launch pool; ${crossCheckedShare} also passed a blind cross-check`)}
          ${stat(String(UNIT_TESTS), "automated tests, plus end-to-end runs on phone and desktop")}
          ${stat("No login", "the whole path, from scan to dashboard, works for the jury right now")}
        </div>
        ${liveBox()}
      </div>
    </div>`,
    "1 Brynjolfsson, Chandar, Chen, “Canaries in the Coal Mine?”, Stanford Digital Economy Lab, Aug 2025; TIME on the same study · Alternatives: learnwithlacuna.com, slopcheck.co, hallucinationlab.app, humanedgeai.com",
  ),
];

/** 10. The two logos, side by side: what the founder built first, and what he built because of it. */
const closingSlide = `<section class="slide closing">
  <header>${eyebrow(10)}<h1>${CLOSING.proverb}</h1><p class="origin">${CLOSING.origin}</p></header>
  <div class="body closeBody">
    <div class="closeLeft">
      <p class="halves">${CLOSING.halves}</p>
      <p class="whole">${CLOSING.whole}</p>
      <p class="callback">${CLOSING.callback}</p>
    </div>
    <div class="closeRight">
      ${link(APP_URL, `<div class="qrTile">${qr}</div>`)}
      <p class="watch">${link(APP_URL, `<b>${SHORT_URL}</b>`)}<br/><span>${CLOSING.ask}</span><br/><span>Code: ${link(REPO_URL, SHORT_REPO)}</span></p>
    </div>
  </div>
  <footer>
    <span class="pair"><img src="assets/kalyp-logo.png" alt="Kalyp" /><span class="arrow">→</span>${LOGO_ON_DARK}</span>
    <p class="notes">AI does the work. You make the call.</p>
  </footer>
</section>`;

const printSlides = [kalypSlide(true), turnSlide, filmSlidePrint, ...productSlides, closingSlide];
const liveSlides = [kalypSlide(false), turnSlide, filmSlideLive, ...productSlides, closingSlide];
for (const html of printSlides) {
  if (html.includes("TODO-")) throw new Error("The opening or the closing still has a placeholder: fill LAYOFFS and CLOSING");
}

// ───────────────────────────── Documents ─────────────────────────────

const STYLE = `
@font-face { font-family: "Fraunces"; src: url("${font("fraunces", "fraunces-latin-opsz-normal.woff2")}") format("woff2"); font-weight: 100 900; }
@font-face { font-family: "Geist"; src: url("${font("geist", "geist-latin-wght-normal.woff2")}") format("woff2"); font-weight: 100 900; }
@page { size: 1280px 720px; margin: 0; }
* { box-sizing: border-box; margin: 0; }
body { background: #FAF7F2; color: #14120F; font: 19px/1.45 "Geist", sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.slide { width: 1280px; height: 720px; padding: 44px 60px 34px; display: flex; flex-direction: column; overflow: hidden; page-break-after: always; position: relative; background: #FAF7F2; }
h1 { font: 500 46px/1.06 "Fraunces", serif; letter-spacing: -0.02em; font-variation-settings: "opsz" 144; max-width: 1040px; }
.eyebrow { font-size: 12.5px; font-weight: 600; letter-spacing: 0.09em; text-transform: uppercase; color: #6B655A; margin-bottom: 8px; }
.eyebrow.gap { margin-top: 20px; }
header { margin-bottom: 24px; }
.body { flex: 1; min-height: 0; }
footer { display: flex; align-items: flex-end; justify-content: space-between; gap: 32px; padding-top: 12px; }
.logo { display: inline-flex; align-items: center; gap: 9px; font: 500 21px/1 "Fraunces", serif; letter-spacing: -0.02em; flex-shrink: 0; }
.notes { font-size: 11.5px; line-height: 1.4; color: #6B655A; text-align: right; max-width: 880px; }
.notes.left { text-align: left; max-width: 1100px; }
.small { font-size: 13.5px; color: #6B655A; line-height: 1.4; }
sup { font-size: 0.6em; color: #6B655A; }
b { font-weight: 600; }
ul { padding-left: 20px; } li { margin-bottom: 9px; }
ul.big li { margin-bottom: 15px; font-size: 19.5px; }
.lede { font-size: 22px; line-height: 1.38; color: #48433B; }
.cols2 { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; height: 100%; }
.cols2.wideRight { grid-template-columns: 5fr 6fr; }
.cols3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 36px; height: 100%; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; align-content: start; }
.grid2.tight { gap: 22px 28px; }
.stat { border-top: 1.5px solid #14120F; padding-top: 12px; }
.stat .figure { font: 500 54px/1 "Fraunces", serif; letter-spacing: -0.02em; margin-bottom: 8px; font-variation-settings: "opsz" 144; }
.stat p:last-child { font-size: 16.5px; line-height: 1.35; color: #48433B; }
.tight .stat .figure { font-size: 46px; } .tight .stat p:last-child { font-size: 15px; }
blockquote { font: 400 35px/1.22 "Fraunces", serif; letter-spacing: -0.01em; max-width: 1080px; }
cite { display: block; font: 400 15px "Geist", sans-serif; color: #6B655A; margin-top: 12px; font-style: normal; }
.pull { font: 500 23px/1.25 "Fraunces", serif; letter-spacing: -0.01em; margin: 18px 0 14px; padding-left: 14px; border-left: 3px solid #D93A2B; }
table { width: 100%; border-collapse: collapse; margin: 4px 0 10px; font-size: 17.5px; }
td { padding: 8px 0; border-bottom: 1px solid #E2DBCE; } td:last-child { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; padding-left: 16px; }
table.compact td { padding: 7px 0; font-size: 16px; } table.compact td:last-child { text-align: left; white-space: normal; color: #48433B; }
table.compact td:first-child { font-weight: 600; white-space: nowrap; }
.box { margin-top: 16px; border: 1px solid #C9C0B0; border-radius: 12px; padding: 12px 16px; background: #FFFDF9; font-size: 15px; line-height: 1.45; }
.box .eyebrow { margin-bottom: 4px; }
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
.qrBig svg { width: 168px; height: 168px; flex-shrink: 0; display: block; } .qrBig b { font-size: 16.5px; white-space: nowrap; } .qrBig p { margin-bottom: 4px; }
.qrBig .small b { font-size: 13.5px; }
.money { gap: 40px; } .money table { font-size: 16.5px; } .money .stat .figure { font-size: 44px; } .money .stat p:last-child { font-size: 14.5px; }
.channels { margin-top: 14px; font-size: 15px; line-height: 1.4; color: #48433B; } .channels b { color: #14120F; } .channels li { margin-bottom: 7px; }

/* The opening: the dark of the Kalyp logo. */
.kalyp { background: #070718; padding: 0; align-items: center; justify-content: center; }
.kalyp img { height: 600px; -webkit-mask-image: radial-gradient(closest-side, #000 72%, transparent 100%); mask-image: radial-gradient(closest-side, #000 72%, transparent 100%); }
.tag { position: absolute; left: 60px; bottom: 34px; font-size: 12.5px; font-weight: 600; letter-spacing: 0.09em; text-transform: uppercase; color: #77749A; }
.tag.right { left: auto; right: 60px; }
.kalyp.captioned { justify-content: flex-start; padding-top: 26px; }
.kalyp.captioned img { height: 470px; }
.caption { width: 920px; margin-top: 2px; text-align: center; color: #C7C4DE; font-size: 17px; line-height: 1.5; }
.caption p + p { margin-top: 8px; } .caption b { color: #F3F1FA; }
a { color: inherit; text-decoration: none; }
.night { background: #070718; color: #F3F1FA; }
.night .eyebrow { color: #9390B4; } .night .notes { color: #77749A; } .night sup { color: #9390B4; }
.night h1 { max-width: 1100px; }
.night header { margin-bottom: 16px; }
.turn { display: grid; grid-template-columns: 1fr 1.25fr; gap: 64px; margin-top: 6px; }
.turn .stat { border-top-color: #4B4870; padding-top: 14px; }
.turn .stat .figure { font-size: 104px; line-height: 0.95; margin-bottom: 10px; background: linear-gradient(100deg, #F3F1FA 20%, #A78BFA 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
.turn .stat p:last-child { font-size: 19px; line-height: 1.4; color: #C7C4DE; max-width: 520px; }
.night .pull { border-left-color: #8B5CF6; font-size: 24px; margin: 22px 0 0; max-width: 1040px; }
.loud { margin-top: 20px; font-size: 21px; line-height: 1.3; color: #C7C4DE; max-width: 980px; }
.loud cite { color: #9390B4; font-size: 14px; margin-top: 8px; }
.aside { margin-top: 30px; font-size: 27px; line-height: 1.25; padding-left: 14px; border-left: 3px solid #D93A2B; }
.aside cite { font-size: 14px; margin-top: 10px; }

/* The film. */
.cinema { background: #0E0D0B; color: #FAF7F2; }
.cinema .eyebrow { color: #9A948A; } .cinema .notes { color: #8A8479; }
.filmBody { display: grid; grid-template-columns: 1.62fr 1fr; gap: 44px; align-items: start; }
.strip { position: relative; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; color: inherit; }
.strip img { width: 100%; display: block; border-radius: 6px; }
.play { position: absolute; left: 50%; top: 50%; width: 84px; height: 84px; margin: -42px 0 0 -42px; border-radius: 50%; background: #FAF7F2; display: flex; align-items: center; justify-content: center; box-shadow: 0 10px 30px rgba(0,0,0,.5); }
.play svg { margin-left: 4px; }
.filmSide { display: flex; flex-direction: column; }
.qrTile { background: #FAF7F2; border-radius: 14px; padding: 14px; width: 176px; height: 176px; }
.qrTile svg { width: 100%; height: 100%; display: block; }
.watch { margin-top: 12px; font-size: 16px; line-height: 1.4; } .watch span { color: #9A948A; font-size: 14px; }
.cinema blockquote { font-size: 23px; line-height: 1.3; margin-top: 22px; }
.hook { margin-top: 18px; font-size: 15px; line-height: 1.45; color: #B5AFA4; } .hook b { color: #FAF7F2; }
.filmLive { padding: 0; background: #000; }
.filmLive video { width: 100%; height: 100%; object-fit: contain; display: block; }

/* The closing: the ink of Overrule. */
.closing { background: #14120F; color: #FAF7F2; }
.closing .eyebrow { color: #9A948A; }
.closing .notes { font: 500 22px/1.2 "Fraunces", serif; letter-spacing: -0.01em; color: #FAF7F2; }
.closing header { margin-bottom: 30px; }
.closing h1 { font-size: 96px; line-height: 1; max-width: 1160px; }
.origin { margin-top: 14px; font-size: 14.5px; line-height: 1.4; color: #9A948A; max-width: 760px; }
.closeBody { display: grid; grid-template-columns: 1.9fr 1fr; gap: 56px; align-items: start; }
.halves { font-size: 27px; line-height: 1.4; color: #D8D2C6; } .halves b { color: #FAF7F2; }
.whole { margin-top: 12px; font: 500 34px/1.15 "Fraunces", serif; letter-spacing: -0.01em; color: #FAF7F2; padding-left: 16px; border-left: 3px solid #D93A2B; }
.callback { margin-top: 28px; font-size: 16.5px; line-height: 1.45; color: #B5AFA4; max-width: 640px; }
.closeRight { display: flex; flex-direction: column; align-items: flex-start; }
.pair { display: inline-flex; align-items: center; gap: 14px; }
.pair img { height: 44px; border-radius: 9px; }
.pair .arrow { color: #9A948A; font-size: 22px; }
`;

const printHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>Overrule — Business Cup 2.0</title>
<style>${STYLE}</style></head>
<body>
${printSlides.join("\n")}
</body></html>`;

/** The stage version: one slide at a time, scaled to the window, driven by a clicker or the keyboard. */
const liveHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>Overrule — pitch</title>
<style>${STYLE}
html, body { height: 100%; overflow: hidden; background: #000; }
#stage { position: fixed; left: 50%; top: 50%; width: 1280px; height: 720px; transform-origin: center; }
#stage .slide { display: none; position: absolute; inset: 0; }
#stage .slide.active { display: flex; }
</style></head>
<body>
<div id="stage">
${liveSlides.join("\n")}
</div>
<script>
// Next: Right, Page Down, Space, Enter or a click. Back: Left, Page Up, Backspace or a click on the left edge.
// F toggles full screen. P pauses or resumes the film. The film starts when its slide opens.
(() => {
  const slides = [...document.querySelectorAll("#stage .slide")];
  const stage = document.getElementById("stage");
  let index = Math.min(slides.length - 1, Math.max(0, (parseInt(location.hash.slice(1), 10) || 1) - 1));
  const fit = () => {
    stage.style.transform = "translate(-50%, -50%) scale(" + Math.min(innerWidth / 1280, innerHeight / 720) + ")";
  };
  const show = (next) => {
    index = Math.min(slides.length - 1, Math.max(0, next));
    slides.forEach((slide, i) => slide.classList.toggle("active", i === index));
    history.replaceState(null, "", "#" + (index + 1));
    for (const video of document.querySelectorAll("video")) {
      if (slides[index].contains(video)) {
        video.currentTime = 0;
        video.play().catch(() => { video.controls = true; });
      } else video.pause();
    }
  };
  addEventListener("resize", fit);
  addEventListener("keydown", (event) => {
    const key = event.key;
    if (["ArrowRight", "PageDown", " ", "Enter"].includes(key)) { event.preventDefault(); show(index + 1); }
    else if (["ArrowLeft", "PageUp", "Backspace"].includes(key)) { event.preventDefault(); show(index - 1); }
    else if (key === "Home") show(0);
    else if (key === "End") show(slides.length - 1);
    else if (key === "f" || key === "F") {
      if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen();
    } else if (key === "p" || key === "P") {
      const video = slides[index].querySelector("video");
      if (video) { if (video.paused) video.play(); else video.pause(); }
    }
  });
  addEventListener("click", (event) => {
    if (event.target.closest("video[controls]")) return;
    show(index + (event.clientX < innerWidth * 0.25 ? -1 : 1));
  });
  fit();
  show(index);
})();
</script>
</body></html>`;

mkdirSync(join(DECK, "out"), { recursive: true });
const htmlPath = join(DECK, "deck.html");
await Bun.write(htmlPath, printHtml);
await Bun.write(join(DECK, "pitch.html"), liveHtml);

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
console.log(`deck: ${count} slides → deck/Overrule_BusinessCup2.pdf and deck/pitch.html${metrics ? " (live metrics included)" : " (no metrics token: live numbers omitted)"}`);
console.log(overflow.length ? `OVERFLOW on slides: ${overflow.join(", ")}` : "no overflow");
if (count > 10) throw new Error("The deck must not exceed 10 slides");
