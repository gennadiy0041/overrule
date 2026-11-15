import { useEffect } from "react";
import { Link } from "react-router-dom";
import { track } from "../lib/api";
import { ButtonLink, Eyebrow, Shell } from "../ui";
import { ClosingBand } from "./landing/ClosingBand";
import { DefendBand } from "./landing/DefendBand";
import { FactStrip } from "./landing/FactStrip";
import { Faq } from "./landing/Faq";
import { HowItWorks } from "./landing/HowItWorks";
import { Plans } from "./landing/Plans";
import { PullQuote } from "./landing/PullQuote";
import { ReviewedDraft } from "./landing/ReviewedDraft";
import { ScanCta } from "./landing/ScanCta";

function Hero() {
  return (
    <section className="grid items-center gap-12 pt-6 pb-14 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-14 lg:pt-12 lg:pb-20">
      <div className="animate-rise">
        <Eyebrow>For professionals who use AI at work</Eyebrow>
        <h1 className="mt-4 text-[2.75rem] leading-[1.02] sm:text-6xl lg:text-[4.25rem]">
          AI does the work. You get paid for the judgment.
        </h1>
        <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-2">
          A 5-minute daily drill: catch the mistakes AI hides in real documents from your job — and build the skill
          your next review will ask about.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <ScanCta className="w-full sm:w-auto" />
          <ButtonLink to="/demo" variant="outline" size="lg" className="w-full sm:w-auto">
            See a 7-day demo profile
          </ButtonLink>
        </div>
        <p className="mt-4 text-sm text-ink-3">
          No sign-up. 2 minutes. Built on public labor data for 923 occupations.
        </p>
      </div>
      <ReviewedDraft />
    </section>
  );
}

export default function Landing() {
  useEffect(() => {
    track("landing_view");
  }, []);

  return (
    <Shell
      width="wide"
      headerRight={
        <Link to="/demo" className="underline-offset-4 hover:underline">
          Demo profile
        </Link>
      }
    >
      <Hero />
      <FactStrip />
      <PullQuote />
      <HowItWorks />
      <DefendBand />
      <Plans />
      <Faq />
      <div className="pt-4">
        <ClosingBand />
      </div>
    </Shell>
  );
}
