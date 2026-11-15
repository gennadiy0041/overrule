import { useEffect, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { ERROR_TYPE_INFO, ERROR_TYPES } from "../../engine/drillSchema";
import { ButtonLink, Eyebrow, Shell } from "../ui";

const SECTIONS: ReadonlyArray<[id: string, title: string]> = [
  ["what", "What Overrule is — and is not"],
  ["method", "The exposure map"],
  ["drills", "How a drill is made and checked"],
  ["scoring", "Scoring and the Judgment Score"],
  ["limits", "Limitations"],
  ["sources", "Sources"],
  ["licences", "Licenses and attribution"],
];

const SOURCES: ReadonlyArray<{ name: string; claim: string; href: string }> = [
  {
    name: "KPMG US, Trust in AI (Apr 2025, n = 1,019)",
    claim: "58% rely on AI output without properly checking it; 57% have made mistakes in their work because of AI.",
    href: "https://kpmg.com/us/en/media/news/trust-in-ai-2025.html",
  },
  {
    name: "Gallup, AI indicator (May 2026)",
    claim: "30% of US employees use AI at work a few times a week or more, up from 11% in May 2023; 15% daily.",
    href: "https://www.gallup.com/699797/indicator-artificial-intelligence.aspx",
  },
  {
    name: "Pew Research Center (Feb 2025, n = 5,273)",
    claim: "52% of US workers are worried about the future impact of AI at work.",
    href: "https://www.pewresearch.org/social-trends/2025/02/25/u-s-workers-are-more-worried-than-hopeful-about-future-ai-use-in-the-workplace/",
  },
  {
    name: "Stanford Digital Economy Lab, “Canaries in the Coal Mine?” (Aug 2025)",
    claim: "A 13% relative employment decline for 22–25-year-olds in the most AI-exposed occupations.",
    href: "https://digitaleconomy.stanford.edu/publications/canaries-in-the-coal-mine/",
  },
  {
    name: "VKTR (Mar 2026)",
    claim: "Managers treat accepting AI output without checking it as a performance problem; the Shuhua Sun quote.",
    href: "https://www.vktr.com/employee-experience/how-managers-weigh-employee-ai-use-in-performance-reviews/",
  },
  {
    name: "eWeek (Feb 2026)",
    claim: "Meta formally assesses employees on their use of AI.",
    href: "https://www.eweek.com/news/meta-ai-performance-reviews/",
  },
  {
    name: "The Register on Stanford Social Media Lab × BetterUp Labs (Sep 2025)",
    claim: "40% of US workers received “workslop” in the past month; 42% trusted the sender less.",
    href: "https://www.theregister.com/2025/09/26/ai_workslop_productivity/",
  },
  {
    name: "BLS, Current Population Survey 2025",
    claim: "73.3 million employed people aged 25–44 in the US.",
    href: "https://www.bls.gov/cps/cpsaat03.htm",
  },
  {
    name: "RevenueCat, State of Subscription Apps 2026",
    claim: "About 8% of monthly subscriptions survive a year; first renewal of annual plans is 23–40%.",
    href: "https://www.revenuecat.com/sosa-2026-insights-part-2",
  },
];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 border-t hairline py-10">
      <h2 className="text-3xl">{title}</h2>
      <div className="mt-4 space-y-4 leading-relaxed text-ink-2">{children}</div>
    </section>
  );
}

function Formula({ children }: { children: ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-xl border hairline bg-card px-4 py-3 font-mono text-[0.82rem] leading-relaxed text-ink">
      {children}
    </pre>
  );
}

function External({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-ink underline underline-offset-4">
      {children}
    </a>
  );
}

/** About & method: everything a sceptical reader needs to trust the numbers, in about three minutes. */
export default function About() {
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);

  return (
    <Shell>
      <article className="pt-4 pb-6">
        <Eyebrow>About &amp; method</Eyebrow>
        <h1 className="mt-2 text-[2.5rem] leading-[1.05] sm:text-5xl">How Overrule works, and what it can’t tell you</h1>
        <nav aria-label="On this page" className="mt-6 mb-8">
          <ol className="space-y-1.5">
            {SECTIONS.map(([id, title], index) => (
              <li key={id} className="flex gap-3">
                <span className="tabular text-ink-3">{String(index + 1).padStart(2, "0")}</span>
                <a href={`#${id}`} className="underline underline-offset-4">
                  {title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <Section id="what" title="What Overrule is — and is not">
          <p>
            Overrule is practice for one skill: reviewing work an AI produced and answering for the result. Each drill
            is a realistic document from your profession with a few planted mistakes and a few lines that only look
            wrong. You flag what is actually wrong; code scores you against an answer key.
          </p>
          <p>
            It is not a course about AI tools, not a promise that your job is safe, and not an employer certification.
          </p>
        </Section>

        <Section id="method" title="The exposure map">
          <p>
            The map uses the task-level labels from Eloundou, Manning, Mishkin and Rock,{" "}
            <External href="https://arxiv.org/abs/2303.10130">“GPTs are GPTs”</External> (
            <External href="https://github.com/openai/GPTs-are-GPTs">dataset, MIT License</External>): 19,265 task
            statements across 923 occupations, each rated by human annotators.
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong className="text-ink">E1</strong> — an AI model alone can cut the time for the task at least in
              half at the same quality.
            </li>
            <li>
              <strong className="text-ink">E2</strong> — the same, but only with additional software built on the model.
            </li>
            <li>
              <strong className="text-ink">E0</strong> — no meaningful speed-up.
            </li>
          </ul>
          <Formula>{`β = Σ wᵢ·vᵢ / Σ wᵢ          v(E1) = 1   v(E2) = 0.5   v(E0) = 0

occupation:  w = 2 for Core tasks, 1 otherwise
you:         w = 3 often, 2 sometimes, 1 rarely   (at least 3 tasks)`}</Formula>
          <p>
            The percentile is the share of the 923 occupations with a strictly lower β. The median occupation has
            β = 0.306.
          </p>
          <p className="text-ink">
            Our engine reproduces the published human-rated β for all 923 occupations with zero difference — it is a
            unit test in the repository.
          </p>
          <p className="text-sm">
            A footnote on ties: the published CSV stores one occupation (Pharmacists) as 0.39999999999999997 instead
            of 0.4, which would shift a neighbouring percentile by 0.1. We rank on β recomputed from the task labels.
          </p>
        </Section>

        <Section id="drills" title="How a drill is made and checked">
          <ol className="list-decimal space-y-2.5 pl-5">
            <li>
              A language model drafts the document and its answer key in one structured call, for a task from your job
              (only tasks AI can speed up).
            </li>
            <li>
              <strong className="text-ink">Deterministic code verifies it</strong>: the structure, that every
              referenced line exists, that look-alike lines never overlap mistakes, at least three kinds of mistake,
              the level’s length limits — and every number is recomputed by our own arithmetic evaluator. A planted
              numbers mistake must really be wrong; every other figure must really be right.
            </li>
            <li>
              For the pre-built pool, a second model solves the drill blind. We keep the drill only if it finds at
              least half of the mistakes.
            </li>
            <li>
              If a draft fails: one retry with the verifier’s findings, then a second provider, then a drill from the
              verified pool. You never see a provider error.
            </li>
          </ol>
          <p>Companies and people in drills are fictional. The answer key never reaches your browser before you submit.</p>
        </Section>

        <Section id="scoring" title="Scoring and the Judgment Score">
          <p>Whether you caught a mistake is decided by code against the key — not by a model’s opinion.</p>
          <Formula>{`points = Σ caught (10·severity + 5 if the type is right + up to 6 for your reasoning)
         − 5 per false alarm − 8 per flagged look-alike
p      = points / maximum, clamped to 0…1`}</Formula>
          <p>
            Over-flagging costs points on purpose: the skill is calibration, not suspicion. A model grades only the
            optional one-line “why” (0–2); if it is slow, a keyword match takes over.
          </p>
          <Formula>{`Judgment Score (Elo):  start 1000
level difficulty D:    800 · 950 · 1100 · 1250 · 1400
expected E = 1 / (1 + 10^((D − R) / 400))
new R = R + K·(p − E)      K = 40 for your first 10 drills, then 24`}</Formula>
          <p>The five kinds of mistake:</p>
          <ul className="space-y-1.5">
            {ERROR_TYPES.map((type) => (
              <li key={type}>
                <strong className="text-ink">{ERROR_TYPE_INFO[type].label}</strong> — {ERROR_TYPE_INFO[type].hint}.
              </li>
            ))}
          </ul>
        </Section>

        <Section id="limits" title="Limitations">
          <ul className="list-disc space-y-2 pl-5">
            <li>Exposure labels date from 2023 and measure potential speed-up of a task, not job loss.</li>
            <li>O*NET describes a typical job, not yours — which is why you pick your own tasks.</li>
            <li>
              Drills are AI-generated. Verification proves structure and arithmetic; it cannot prove that a logic or
              audience mistake is beyond argument.
            </li>
            <li>The Judgment Score is a practice record, not a credential.</li>
            <li>Percentiles are shown only once there are 20 real players.</li>
            <li>This build runs a demo checkout and collects no payment.</li>
          </ul>
        </Section>

        <Section id="sources" title="Sources">
          <ul className="space-y-3">
            {SOURCES.map((source) => (
              <li key={source.href}>
                <External href={source.href}>{source.name}</External>
                <span className="block text-sm">{source.claim}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="licences" title="Licenses and attribution">
          <p>
            Overrule’s code is open source under the MIT License (
            <External href="https://github.com/gennadiy0041/overrule">GitHub</External>). The exposure dataset is
            published under the MIT License.
          </p>
          <p>
            This site includes information from the O*NET 27.2 Database (task statements, via the dataset above) and
            the O*NET 30.0 Database (alternate titles) by the U.S. Department of Labor, Employment and Training
            Administration (USDOL/ETA). Used under the{" "}
            <External href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</External> license. O*NET® is a
            trademark of USDOL/ETA. Overrule has modified all or some of this information. USDOL/ETA has not approved,
            endorsed, or tested these modifications.
          </p>
        </Section>

        <div className="border-t hairline pt-8">
          <ButtonLink to="/scan" size="lg">
            Scan my job — free
          </ButtonLink>
        </div>
      </article>
    </Shell>
  );
}
