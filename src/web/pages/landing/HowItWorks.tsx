import { Section } from "./Section";

const STEPS = [
  {
    name: "Discover",
    text: "Scan your job. See, task by task, how much of your work AI can already draft.",
  },
  {
    name: "Develop",
    text: "Daily Catch: one AI-written document from your field, 3–4 hidden mistakes, lines that only look wrong. Five minutes.",
  },
  {
    name: "Prove",
    text: "Your Judgment Score rises as you catch more and over-flag less. Export a report for your next review.",
  },
] as const;

/** The loop as a numbered sequence, set like a table of contents: the order is the message. */
export function HowItWorks() {
  return (
    <Section title="How it works">
      <ol>
        {STEPS.map((step, index) => (
          <li
            key={step.name}
            className="grid grid-cols-[3.25rem_1fr] gap-x-3 border-t hairline py-6 first:border-t-0 first:pt-0 last:pb-0 sm:grid-cols-[4.5rem_9.5rem_1fr] sm:gap-x-6 sm:py-8"
          >
            {/* Decorative: the <ol> already tells assistive tech which step this is. */}
            <span
              aria-hidden="true"
              className="tabular font-serif text-[1.75rem] leading-8 text-ink-3 sm:text-[2.25rem] sm:leading-9"
            >
              {String(index + 1).padStart(2, "0")}
            </span>
            <h3 className="text-2xl leading-8 sm:leading-9">{step.name}</h3>
            <p className="col-start-2 mt-1 text-ink-2 sm:col-start-3 sm:mt-1.5">{step.text}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}
