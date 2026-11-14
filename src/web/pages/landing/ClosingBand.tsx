import { ScanCta } from "./ScanCta";

/** The last thing on the page: the promise in five words and the one action again. */
export function ClosingBand() {
  return (
    <section aria-labelledby="closing-title" className="rounded-card bg-ink px-6 py-14 text-center text-paper sm:py-20">
      <h2 id="closing-title" className="mx-auto max-w-2xl text-[2.25rem] leading-[1.08] sm:text-5xl lg:text-[3.5rem]">
        Know when to overrule AI.
      </h2>
      <p className="mx-auto mt-4 max-w-sm text-paper-2">Start with a free scan of your job. No sign-up, about two minutes.</p>
      {/* The global focus ring is ink, which disappears on this band. */}
      <ScanCta className="mt-8 w-full focus-visible:outline-paper sm:w-auto" />
    </section>
  );
}
