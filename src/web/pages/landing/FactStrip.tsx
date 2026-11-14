import { SourceLink, type Source } from "./SourceLink";

const KPMG: Source = {
  label: "KPMG US, Trust in AI survey, April 2025 (n = 1,019)",
  href: "https://kpmg.com/us/en/media/news/trust-in-ai-2025.html",
};

const GALLUP: Source = {
  label: "Gallup, AI indicator, May 2026",
  href: "https://www.gallup.com/699797/indicator-artificial-intelligence.aspx",
};

interface Fact {
  figure: string;
  claim: string;
  source: Source;
}

/**
 * Each claim stays as close to the source's own sentence as a short line
 * allows. The KPMG figures are self-reported ("admit to"), hence "say they".
 */
const FACTS: readonly Fact[] = [
  {
    figure: "58%",
    claim: "of US workers say they rely on AI output without properly checking it.",
    source: KPMG,
  },
  {
    figure: "57%",
    claim: "say they have made mistakes in their work because of AI.",
    source: KPMG,
  },
  {
    figure: "30%",
    claim: "of US employees use AI at work a few times a week or more — up from 11% in 2023.",
    source: GALLUP,
  },
];

/** Why the skill matters, in three sourced figures: ruled like a table, not boxed like cards. */
export function FactStrip() {
  return (
    <section aria-labelledby="facts-title" className="border-y hairline">
      <h2 id="facts-title" className="sr-only">
        AI at work, in three numbers
      </h2>
      <ul className="divide-y divide-line md:grid md:grid-cols-3 md:divide-x md:divide-y-0">
        {FACTS.map((fact) => (
          <li
            key={fact.figure}
            className="grid grid-cols-[6rem_1fr] gap-x-4 pt-6 pb-3 md:block md:px-8 md:pt-10 md:pb-7 md:first:pl-0 md:last:pr-0"
          >
            <p className="tabular font-serif text-[2.75rem] leading-none md:text-[4.5rem]">{fact.figure}</p>
            <div className="md:mt-4">
              <p className="text-ink-2">{fact.claim}</p>
              <SourceLink href={fact.source.href}>{fact.source.label}</SourceLink>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
