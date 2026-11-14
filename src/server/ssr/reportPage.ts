import { ERROR_TYPE_INFO, ERROR_TYPES } from "../../engine/drillSchema";
import type { ReportSnapshot } from "../services/report";
import { bar, lineChart } from "./charts";
import { html, raw, type SafeHtml } from "./html";
import { renderDocument, siteFooter, siteHeader, type LayoutContext } from "./layout";

function formatDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, date!)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function percent(part: number, whole: number): string {
  return whole === 0 ? "—" : `${Math.round((part / whole) * 100)}%`;
}

function stat(label: string, value: string, note: string): SafeHtml {
  return html`<div class="border-t hairline pt-3">
    <p class="eyebrow">${label}</p>
    <p class="tabular mt-1 font-serif text-3xl leading-none">${value}</p>
    <p class="mt-1 text-sm text-ink-3">${note}</p>
  </div>`;
}

/** Copies the self-review summary. The only script on the page; the text is read from the DOM. */
const COPY_SCRIPT = raw(`<script>
document.getElementById("copy-summary")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const text = document.getElementById("summary-text")?.textContent ?? "";
  try { await navigator.clipboard.writeText(text.trim()); button.textContent = "Copied"; }
  catch { button.textContent = "Select the text and copy"; }
});
</script>`);

/** `/r/:publicId` — a public, printable practice record. */
export function renderReportPage(report: ReportSnapshot, publicId: string, context: LayoutContext): string {
  const period = report.from === report.to ? formatDay(report.from) : `${formatDay(report.from)} – ${formatDay(report.to)}`;
  const delta = report.ratingEnd - report.ratingStart;
  const series = [report.ratingStart, ...report.ratingSeries.map((point) => point.rating)];

  const body = html`${siteHeader(html`<span class="print:hidden">Review Report</span>`)}
    <main class="mx-auto w-full max-w-3xl flex-1 px-5 pb-16">
      <p class="eyebrow mt-6">AI-review practice record · ${report.occupation}</p>
      <h1 class="mt-2 text-4xl leading-tight sm:text-5xl">Judgment under review</h1>
      <p class="mt-3 text-ink-2">
        ${period} · ${report.drills} ${report.drills === 1 ? "drill" : "drills"}. Each drill is an AI-drafted work
        document with planted mistakes and lines that only look wrong; the reviewer flags what is actually wrong.
        Scoring is done by code against an answer key.
      </p>

      <section class="mt-8 grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
        ${stat("Mistakes caught", percent(report.caught, report.total), `${report.caught} of ${report.total} planted`)}
        ${stat("False alarms", percent(report.falseFlags, report.flags), `${report.falseFlags} of ${report.flags} flags`)}
        ${stat("Judgment Score", report.ratingEnd.toLocaleString("en-US"), `${delta < 0 ? "−" : "+"}${Math.abs(delta)} from ${report.ratingStart.toLocaleString("en-US")}`)}
        ${stat("Drills", String(report.drills), period)}
      </section>

      ${series.length >= 2
        ? html`<section class="mt-10">
            <h2 class="text-2xl">Score over time</h2>
            <div class="mt-3 rounded-card border hairline bg-card p-4">
              ${lineChart(series, `Judgment Score from ${report.ratingStart} to ${report.ratingEnd}`)}
            </div>
          </section>`
        : ""}

      <section class="mt-10">
        <h2 class="text-2xl">Catch rate by mistake type</h2>
        <div class="mt-4 space-y-4">
          ${ERROR_TYPES.map((type) => {
            const s = report.byType[type];
            return html`<div>
              <div class="flex items-baseline justify-between gap-3 text-sm">
                <span><span class="font-medium">${ERROR_TYPE_INFO[type].label}</span>
                  <span class="text-ink-3"> · ${ERROR_TYPE_INFO[type].hint}</span></span>
                <span class="tabular shrink-0 text-ink-2">${s.appeared === 0 ? "not seen" : `${s.caught}/${s.appeared}`}</span>
              </div>
              <div class="mt-1.5">${bar(s.appeared === 0 ? 0 : s.caught / s.appeared, "bg-caught")}</div>
            </div>`;
          })}
        </div>
      </section>

      ${report.bestCatches.length > 0
        ? html`<section class="mt-10">
            <h2 class="text-2xl">Best catches</h2>
            <ul class="mt-4 space-y-3">
              ${report.bestCatches.map(
                (c) => html`<li class="rounded-card border hairline bg-card p-4">
                  <p class="eyebrow text-caught-deep">${ERROR_TYPE_INFO[c.type].label} · severity ${c.severity} of 3</p>
                  <p class="mt-1">${c.what}</p>
                  <p class="mt-1 text-sm text-ink-3">In: ${c.document}</p>
                </li>`,
              )}
            </ul>
          </section>`
        : ""}

      <section class="mt-10 rounded-card border border-line-strong bg-card p-5">
        <h2 class="text-2xl">For your self-review</h2>
        <p id="summary-text" class="mt-3 leading-relaxed text-ink-2">${report.summary}</p>
        <button id="copy-summary" type="button"
          class="mt-4 inline-flex min-h-11 items-center justify-center rounded-full bg-ink px-5 text-[0.95rem] font-medium text-paper print:hidden">
          Copy summary for my self-review
        </button>
      </section>

      <p class="mt-8 text-sm text-ink-3">
        Practice record generated by Overrule. Not an employer certification.
        Report ${publicId} · created ${formatDay(report.createdAt.slice(0, 10))}.
      </p>
      <p class="mt-6 print:hidden">
        <a href="/" class="font-medium underline underline-offset-4">Build your own record — scan your job, free</a>
      </p>
    </main>
    <div class="print:hidden">${siteFooter()}</div>
    ${COPY_SCRIPT}`;

  return renderDocument(
    {
      title: `AI-review practice record · ${report.occupation} | Overrule`,
      description: `${report.caught} of ${report.total} planted AI mistakes caught across ${report.drills} drills. Practice record generated by Overrule.`,
      path: `/r/${publicId}`,
      noindex: true,
    },
    body,
    context,
  );
}
