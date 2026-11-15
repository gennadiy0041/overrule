import type { MetricsSnapshot, Tally } from "../services/metrics";
import { html, type SafeHtml } from "./html";
import { renderDocument, siteHeader, type LayoutContext } from "./layout";

function pct(share: number | null): string {
  return share === null ? "—" : `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`;
}

function usd(amount: number): string {
  return `$${amount.toFixed(amount < 1 ? 4 : 2)}`;
}

function tallyLine(tally: Tally, order: ReadonlyArray<string>): string {
  const total = Object.values(tally).reduce((n, v) => n + v, 0);
  if (total === 0) return "no answers yet";
  return order
    .filter((key) => tally[key])
    .map((key) => `${key.replace(/_/g, " ")} ${tally[key]} (${Math.round((tally[key]! / total) * 100)}%)`)
    .join(" · ");
}

function section(title: string, content: SafeHtml): SafeHtml {
  return html`<section class="mt-10">
    <h2 class="text-2xl">${title}</h2>
    <div class="mt-3">${content}</div>
  </section>`;
}

function table(head: ReadonlyArray<string>, rows: ReadonlyArray<ReadonlyArray<string | number>>): SafeHtml {
  return html`<div class="overflow-x-auto rounded-card border hairline bg-card">
    <table class="tabular w-full text-left text-sm">
      <thead>
        <tr class="border-b hairline text-ink-3">
          ${head.map((h) => html`<th class="px-3 py-2 font-medium">${h}</th>`)}
        </tr>
      </thead>
      <tbody>
        ${rows.map(
          (row) => html`<tr class="border-b hairline last:border-0">
            ${row.map((cell) => html`<td class="px-3 py-2">${cell}</td>`)}
          </tr>`,
        )}
      </tbody>
    </table>
  </div>`;
}

const YES_NO = ["yes", "not_sure", "maybe", "no"];

/** `/metrics?token=…` — the live numbers behind the pitch. Token-protected, never indexed. */
export function renderMetricsPage(m: MetricsSnapshot, context: LayoutContext): string {
  const body = html`${siteHeader(html`<span>Metrics</span>`)}
    <main class="mx-auto w-full max-w-3xl flex-1 px-5 pb-16">
      <p class="eyebrow mt-6">Live product metrics</p>
      <h1 class="mt-2 text-4xl">What the data says</h1>
      <p class="mt-2 text-sm text-ink-3">
        Generated ${m.generatedAt}. Demo profiles are excluded.
        ${m.includeInternal ? "Internal traffic is INCLUDED (all=1)." : "Internal traffic (team browsers, automated tests) is excluded."}
        Numbers are small and honest: N is shown everywhere.
      </p>

      ${section(
        "Sessions",
        table(
          ["Sessions", "With a scan", "With a scored drill", "Trials started"],
          [[m.sessions.total, m.sessions.withScan, m.sessions.withAttempt, m.sessions.trials]],
        ),
      )}

      ${section(
        "Funnel (unique sessions)",
        table(
          ["Step", "Sessions", "From previous", "From first"],
          m.funnel.map((step) => [step.label, step.sessions, pct(step.fromPrevious), pct(step.fromFirst)]),
        ),
      )}

      ${section(
        "Retention and habit",
        table(
          ["Metric", "Value"],
          [
            ["Sessions at least a day old", m.retention.eligible],
            [
              "…that returned on a later day (D1+)",
              `${m.retention.returned} (${pct(m.retention.eligible ? m.retention.returned / m.retention.eligible : null)})`,
            ],
            ["Daily Catch completions", m.daily.completions],
            ["Daily Catch players", m.daily.players],
            ["Result shares", m.daily.shares],
            ["Calendar reminders added", m.counters["calendar_add"] ?? 0],
            ["Review reports created", m.counters["report_create"] ?? 0],
            ["SEO page views", m.counters["seo_page_view"] ?? 0],
            ["SEO → scan clicks", m.counters["seo_cta_click"] ?? 0],
          ],
        ),
      )}

      ${section(
        "Surveys",
        table(
          ["Question", "N", "Answers"],
          [
            ["After first result: sent work with an AI mistake?", m.microSurvey.n, tallyLine(m.microSurvey.shippedAiError, YES_NO)],
            ["After first result: would pay $8/month?", m.microSurvey.n, tallyLine(m.microSurvey.wouldPay, YES_NO)],
            ["/survey: lives in the US", m.fullSurvey.n, tallyLine(m.fullSurvey.answers["inUs"] ?? {}, YES_NO)],
            ["/survey: age", m.fullSurvey.n, tallyLine(m.fullSurvey.answers["age"] ?? {}, ["25-34", "35-45", "other"])],
            ["/survey: uses AI at work weekly", m.fullSurvey.n, tallyLine(m.fullSurvey.answers["aiWeekly"] ?? {}, YES_NO)],
            ["/survey: an AI mistake ended up in their work", m.fullSurvey.n, tallyLine(m.fullSurvey.answers["hadAiError"] ?? {}, YES_NO)],
            ["/survey: would pay $8/month", m.fullSurvey.n, tallyLine(m.fullSurvey.answers["wouldPay"] ?? {}, YES_NO)],
          ],
        ),
      )}

      ${section(
        "Model calls",
        html`${table(
            ["Purpose", "Provider", "Model", "Calls", "OK", "p50 ms", "Tokens in", "Tokens out"],
            m.llm.groups.map((g) => [g.purpose, g.provider, g.model, g.calls, g.ok, g.p50Ms, g.inputTokens, g.outputTokens]),
          )}
          <p class="mt-3 text-sm text-ink-2">
            Drill drafts accepted by the verifier: ${m.llm.draftsAccepted}. Rejected (failed verification or provider
            error): ${m.llm.draftsRejected}. A rejected draft is never shown to a user.
            ${m.llm.rejections.length === 0
              ? ""
              : `Reasons: ${m.llm.rejections.map((r) => `${r.reason} ×${r.count}`).join("; ")}.`}
          </p>`,
      )}

      ${section(
        "Model spend (estimate)",
        html`${table(
            ["Model", "Calls", "Tokens in", "Tokens out", "Est. cost"],
            m.llm.spend.lines.map((line) => [line.model, line.calls, line.inputTokens, line.outputTokens, usd(line.usd)]),
          )}
          <p class="mt-3 text-sm text-ink-2">
            Estimated spend: ${usd(m.llm.spend.usd)} of the ${usd(m.llm.spend.budgetUsd)} ceiling
            (${usd(m.llm.spend.remainingUsd)} left). Token counts at list prices, with timed-out calls counted at
            their ceiling: an estimate that errs high, not an invoice. At the ceiling the product stops calling
            models and serves the verified pool.
          </p>`,
      )}
    </main>`;

  return renderDocument(
    { title: "Metrics | Overrule", description: "Live product metrics.", path: "/metrics", noindex: true },
    body,
    context,
  );
}
