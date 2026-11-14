import { SourceLink } from "./SourceLink";

const SOURCE_URL =
  "https://www.vktr.com/employee-experience/how-managers-weigh-employee-ai-use-in-performance-reviews/";

/**
 * The one outside voice on the page: a researcher naming the skill we train.
 * A real, linked quotation stands where a testimonial would otherwise go; we
 * have no testimonials yet and will not invent one.
 */
export function PullQuote() {
  return (
    <figure className="py-16 sm:py-24 lg:py-28">
      <blockquote cite={SOURCE_URL}>
        {/* The negative indent hangs the opening mark in the margin, so the words align with the page's left edge. */}
        <p className="max-w-[54rem] -indent-[0.42em] font-serif text-[1.75rem] leading-[1.22] tracking-[-0.01em] sm:text-[2.5rem] sm:leading-[1.16] lg:text-[2.875rem]">
          “The real challenge is not whether people use AI, but whether they know when to rely on it, when to question
          it and when to override it.”
        </p>
      </blockquote>
      <figcaption className="mt-5 flex flex-wrap items-center gap-x-3 text-sm text-ink-2">
        <span aria-hidden="true" className="h-px w-8 bg-ink" />
        <span>
          <span className="font-medium text-ink">Shuhua Sun</span>, Tulane University
        </span>
        <SourceLink href={SOURCE_URL}>VKTR, 2026</SourceLink>
      </figcaption>
    </figure>
  );
}
