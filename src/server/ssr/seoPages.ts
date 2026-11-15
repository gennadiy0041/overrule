/**
 * Server-rendered SEO pages: one "Will AI replace {occupation}?" page for each of
 * the 923 occupations, built from the same data as the product, plus an index,
 * a sitemap and robots.txt. Pure functions — the routes add caching and analytics.
 */
import { labelShares, taskTypeWeight, type ExposureLabel } from "../../engine/exposure";
import type { Occupation, OccupationTask } from "../../engine/occupations";
import { html, raw, type SafeHtml } from "./html";
import { renderDocument, siteFooter, siteHeader, type LayoutContext } from "./layout";

export interface SeoStats {
  medianBeta: number;
  occupationCount: number;
}

const LABELS: ReadonlyArray<{
  label: ExposureLabel;
  title: string;
  blurb: string;
  bar: string;
  dot: string;
}> = [
  {
    label: "E1",
    title: "AI drafts it — a person reviews",
    blurb: "AI alone can cut the time for these tasks at least in half. The human job becomes checking the result.",
    bar: "bg-overrule",
    dot: "bg-overrule",
  },
  {
    label: "E2",
    title: "AI + tools",
    blurb: "Twice as fast once AI is built into the software people already use.",
    bar: "bg-partial",
    dot: "bg-partial",
  },
  {
    label: "E0",
    title: "The human edge",
    blurb: "AI does not meaningfully speed these up. This is where the occupation is hardest to replace.",
    bar: "bg-caught",
    dot: "bg-caught",
  },
];

function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

function exposureSentence(occupation: Occupation, stats: SeoStats): string {
  const beta = pct(occupation.beta);
  const rank = Math.round(occupation.percentile);
  return occupation.beta >= stats.medianBeta
    ? `Short answer: not the job — but AI can already speed up about ${beta} of the work. That is more than ${rank}% of the ${stats.occupationCount} US occupations we track.`
    : `Short answer: not the job. AI can speed up about ${beta} of the work — less than ${100 - rank}% of the ${stats.occupationCount} US occupations we track.`;
}

/** Occupations from the same SOC minor group (e.g. "11-20"), closest in exposure first. */
export function relatedOccupations(occupation: Occupation, all: ReadonlyArray<Occupation>, limit = 6): Occupation[] {
  const group = occupation.soc.slice(0, 5);
  return all
    .filter((other) => other.soc !== occupation.soc && other.soc.startsWith(group))
    .sort((a, b) => Math.abs(a.beta - occupation.beta) - Math.abs(b.beta - occupation.beta))
    .slice(0, limit);
}

function scanLink(occupation: Occupation): string {
  return `/scan?soc=${encodeURIComponent(occupation.soc)}&from=seo`;
}

function taskList(tasks: ReadonlyArray<OccupationTask>): SafeHtml {
  return html`<ul class="mt-3 divide-y divide-line border-y hairline">
    ${tasks.map(
      (task) => html`<li class="flex gap-3 py-3 text-[0.95rem] leading-relaxed">
        <span class="flex-1">${task.text}</span>
        ${task.type === "Core" ? html`<span class="eyebrow shrink-0 pt-1">core</span>` : ""}
      </li>`,
    )}
  </ul>`;
}

function faq(occupation: Occupation, stats: SeoStats): Array<{ question: string; answer: string }> {
  const drafted = occupation.tasks.filter((task) => task.label === "E1");
  const human = occupation.tasks.filter((task) => task.label === "E0");
  const entries = [{ question: `Will AI replace ${occupation.title}?`, answer: exposureSentence(occupation, stats) }];
  if (drafted[0]) {
    entries.push({
      question: `Which ${occupation.title} tasks can AI already do?`,
      answer: `${drafted.length} of ${occupation.tasks.length} tasks are rated as ones AI alone can speed up at least twofold, for example: ${drafted[0].text}`,
    });
  }
  if (human[0]) {
    entries.push({
      question: `Which ${occupation.title} tasks are hardest for AI?`,
      answer: `${human.length} of ${occupation.tasks.length} tasks show no meaningful AI speed-up, for example: ${human[0].text}`,
    });
  }
  return entries;
}

/** `/will-ai-replace/:slug` */
export function renderSeoOccupation(
  occupation: Occupation,
  related: ReadonlyArray<Occupation>,
  stats: SeoStats,
  context: LayoutContext,
): string {
  const shares = labelShares(occupation.tasks.map((task) => ({ label: task.label, weight: taskTypeWeight(task.type) })));
  const beta = pct(occupation.beta);
  const questions = faq(occupation, stats);

  const body = html`${siteHeader(html`<a href="/will-ai-replace" class="underline-offset-4 hover:underline">All jobs</a>`)}
    <main class="mx-auto w-full max-w-3xl flex-1 px-5 pb-20">
      <p class="eyebrow mt-6">AI exposure by job · O*NET ${occupation.soc}</p>
      <h1 class="mt-2 text-4xl leading-[1.08] sm:text-5xl">Will AI replace ${occupation.title}? A task-by-task look</h1>
      <p class="mt-4 text-lg leading-relaxed text-ink-2">${exposureSentence(occupation, stats)}</p>

      <section class="mt-8 rounded-card border hairline bg-card p-5 shadow-card sm:p-6">
        <p class="tabular font-serif text-7xl leading-none">${beta}</p>
        <p class="mt-2 text-ink-2">
          of the work of ${occupation.title} is AI-exposed, weighted by how central each task is. The median across
          ${stats.occupationCount} occupations is ${pct(stats.medianBeta)}.
        </p>
        <div class="mt-5 flex h-3 w-full overflow-hidden rounded-full bg-paper-2" role="img"
          aria-label="Share of work by exposure: ${pct(shares.E1)} AI drafts, ${pct(shares.E2)} AI with tools, ${pct(shares.E0)} human edge">
          ${LABELS.map((entry) => html`<div class="${entry.bar} h-full" style="width:${(shares[entry.label] * 100).toFixed(2)}%"></div>`)}
        </div>
        <ul class="mt-4 grid gap-2 text-sm sm:grid-cols-3">
          ${LABELS.map(
            (entry) => html`<li class="flex items-center gap-2">
              <span class="${entry.dot} size-2.5 shrink-0 rounded-full"></span>
              <span>${entry.title} · <span class="tabular font-medium">${pct(shares[entry.label])}</span></span>
            </li>`,
          )}
        </ul>
      </section>

      ${LABELS.map((entry) => {
        const tasks = occupation.tasks.filter((task) => task.label === entry.label);
        if (tasks.length === 0) return "";
        return html`<section class="mt-10">
          <h2 class="flex items-center gap-3 text-2xl">
            <span class="${entry.dot} size-3 shrink-0 rounded-full"></span>${entry.title}
            <span class="tabular text-base text-ink-3">${tasks.length}</span>
          </h2>
          <p class="mt-1 text-ink-2">${entry.blurb}</p>
          ${taskList(tasks)}
        </section>`;
      })}

      <section class="mt-10">
        <h2 class="text-2xl">What this means</h2>
        <p class="mt-2 leading-relaxed text-ink-2">
          For ${occupation.title}, value is moving from doing to judging. Where AI drafts the document, the scarce
          skill is no longer producing it — it is catching what is wrong with it before it goes out, and answering
          for the result.
        </p>
      </section>

      <section class="mt-8 rounded-card border border-line-strong bg-card p-5 sm:p-6">
        <h2 class="text-2xl">See your own number</h2>
        <p class="mt-2 text-ink-2">
          It depends on which of these tasks you actually do, and how often. The scan takes two minutes and needs no
          sign-up.
        </p>
        <div class="mt-4 flex flex-wrap gap-3">
          <a href="${scanLink(occupation)}"
            class="inline-flex min-h-12 items-center justify-center rounded-full bg-overrule px-6 font-medium text-white hover:bg-overrule-deep">
            Scan my job — free
          </a>
          <a href="${scanLink(occupation)}"
            class="inline-flex min-h-12 items-center justify-center rounded-full border border-line-strong bg-card px-6 font-medium hover:border-ink">
            Try a 5-minute AI-review drill
          </a>
        </div>
      </section>

      ${related.length > 0
        ? html`<section class="mt-10">
            <h2 class="text-2xl">Related occupations</h2>
            <ul class="mt-3 grid gap-x-6 sm:grid-cols-2">
              ${related.map(
                (other) => html`<li class="flex items-baseline justify-between gap-3 border-b hairline py-2.5">
                  <a href="/will-ai-replace/${other.slug}" class="underline-offset-4 hover:underline">${other.title}</a>
                  <span class="tabular text-ink-3">${pct(other.beta)}</span>
                </li>`,
              )}
            </ul>
          </section>`
        : ""}

      <p class="mt-10 text-sm leading-relaxed text-ink-3">
        Exposure means AI can speed up a task — not that a job disappears. Labels come from human annotators in
        Eloundou et al., “GPTs are GPTs” (2023), over O*NET task statements.
        <a href="/about#method" class="underline underline-offset-4">How we calculate this</a>.
      </p>
    </main>
    ${siteFooter()}`;

  const fullTitle = `Will AI replace ${occupation.title}? ${beta} of tasks are AI-exposed | Overrule`;
  return renderDocument(
    {
      title: fullTitle.length <= 70 ? fullTitle : `Will AI replace ${occupation.title}? | Overrule`,
      description: `${beta} of the work of ${occupation.title} is AI-exposed — a task-by-task breakdown of ${occupation.tasks.length} tasks from US labor data, and what it means for the people who do the job.`,
      path: `/will-ai-replace/${occupation.slug}`,
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: questions.map((entry) => ({
          "@type": "Question",
          name: entry.question,
          acceptedAnswer: { "@type": "Answer", text: entry.answer },
        })),
      },
    },
    body,
    context,
  );
}

/** Progressive enhancement: filter the list as you type. The page is complete without it. */
const FILTER_SCRIPT = raw(`<script>
(() => {
  const input = document.getElementById("job-filter");
  const items = Array.from(document.querySelectorAll("[data-job]"));
  const empty = document.getElementById("job-empty");
  input?.addEventListener("input", () => {
    const query = input.value.trim().toLowerCase();
    let shown = 0;
    for (const item of items) {
      const match = item.dataset.job.includes(query);
      item.hidden = !match;
      if (match) shown++;
    }
    if (empty) empty.hidden = shown > 0;
  });
})();
</script>`);

/** `/will-ai-replace` — every occupation, alphabetically, with its exposure. */
export function renderSeoIndex(occupations: ReadonlyArray<Occupation>, stats: SeoStats, context: LayoutContext): string {
  const sorted = [...occupations].sort((a, b) => a.title.localeCompare(b.title));
  const body = html`${siteHeader()}
    <main class="mx-auto w-full max-w-3xl flex-1 px-5 pb-20">
      <p class="eyebrow mt-6">AI exposure by job</p>
      <h1 class="mt-2 text-4xl leading-[1.08] sm:text-5xl">
        Will AI replace your job? ${stats.occupationCount} occupations, task by task
      </h1>
      <p class="mt-4 text-lg leading-relaxed text-ink-2">
        For every occupation: the share of its work that AI can already speed up at least twofold, from task-level
        labels by human annotators (“GPTs are GPTs”, 2023) over U.S. Department of Labor task data. The median job
        is ${pct(stats.medianBeta)} exposed. Exposure is not replacement — it shows where the work shifts from doing
        to judging.
      </p>
      <div class="mt-5 flex flex-wrap items-center gap-3">
        <a href="/scan"
          class="inline-flex min-h-12 items-center justify-center rounded-full bg-overrule px-6 font-medium text-white hover:bg-overrule-deep">
          Scan my job — free
        </a>
        <span class="text-sm text-ink-3">Your own number depends on the tasks you actually do.</span>
      </div>

      <label for="job-filter" class="eyebrow mt-10 block">Find a job</label>
      <input id="job-filter" type="search" autocomplete="off" placeholder="e.g. accountant, nurse, project manager"
        class="mt-2 min-h-12 w-full rounded-xl border border-line-strong bg-card px-4 text-base placeholder:text-ink-3" />
      <p id="job-empty" hidden class="mt-4 text-ink-2">No occupation matches. Try a simpler title.</p>

      <ul class="mt-4 grid gap-x-8 sm:grid-cols-2">
        ${sorted.map(
          (occupation) => html`<li data-job="${occupation.title.toLowerCase()}"
            class="flex items-baseline justify-between gap-3 border-b hairline py-2.5">
            <a href="/will-ai-replace/${occupation.slug}" class="underline-offset-4 hover:underline">${occupation.title}</a>
            <span class="tabular text-ink-3">${pct(occupation.beta)}</span>
          </li>`,
        )}
      </ul>
    </main>
    ${siteFooter()}${FILTER_SCRIPT}`;

  return renderDocument(
    {
      title: `Will AI replace your job? ${stats.occupationCount} occupations, task by task | Overrule`,
      description: `How much of each job can AI already do? A task-by-task look at ${stats.occupationCount} US occupations, built on public labor data.`,
      path: "/will-ai-replace",
    },
    body,
    context,
  );
}

function xmlEscape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderSitemap(occupations: ReadonlyArray<Occupation>, appUrl: string): string {
  const paths = ["/", "/about", "/survey", "/will-ai-replace", ...occupations.map((o) => `/will-ai-replace/${o.slug}`)];
  const urls = paths.map((path) => `  <url><loc>${xmlEscape(`${appUrl}${path}`)}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function renderRobots(appUrl: string): string {
  return ["User-agent: *", "Allow: /", "Disallow: /api/", "Disallow: /metrics", "Disallow: /r/", "", `Sitemap: ${appUrl}/sitemap.xml`, ""].join("\n");
}
