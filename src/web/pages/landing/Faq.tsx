import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Section } from "./Section";

interface Question {
  question: string;
  answer: ReactNode;
}

const QUESTIONS: readonly Question[] = [
  {
    question: "Is this a course?",
    answer:
      "No. No videos, no lessons about AI tools. It’s practice: one real-looking document a day, and a score that shows whether your judgment is improving.",
  },
  {
    question: "Will it protect my job?",
    answer:
      "No one can promise that, and we won’t. What we can do is train and measure the part of your work AI doesn’t take over: deciding what’s right.",
  },
  {
    question: "Where does the data come from?",
    answer: (
      <>
        The exposure map uses the task-level labels from “GPTs are GPTs” (Eloundou et al., 2023), built on the U.S.
        Department of Labor’s O*NET task statements: 19,265 tasks across 923 occupations. We reproduce the paper’s
        published scores exactly; the method is on the{" "}
        <Link to="/about" className="text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
          About page
        </Link>
        .
      </>
    ),
  },
  {
    question: "Is the drill real or scripted?",
    answer:
      "Each drill is generated for a task from your job, then checked by code: every number is recomputed and every planted mistake must be provable. Scoring is done by code against the answer key, not by an AI’s opinion.",
  },
];

function PlusIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
      className="shrink-0 text-ink-3 transition-transform duration-200 group-open:rotate-45"
    >
      <path d="M9 3v12M3 9h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Native <details>: keyboard and screen-reader behaviour for free, and the
 * answers stay in the HTML for find-in-page. The first one starts open because
 * "not a course" is the question every visitor arrives with.
 */
export function Faq() {
  return (
    <Section title="Questions">
      <div className="border-t hairline">
        {QUESTIONS.map((item, index) => (
          <details key={item.question} open={index === 0} className="group border-b hairline">
            <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 py-4 [&::-webkit-details-marker]:hidden">
              <h3 className="text-xl sm:text-[1.375rem]">{item.question}</h3>
              <PlusIcon />
            </summary>
            <p className="max-w-[38rem] pr-8 pb-6 text-ink-2">{item.answer}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}
