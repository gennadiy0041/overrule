import { PLAN_FEATURES, PRICING } from "../../../shared/pricing";
import { cx } from "../../ui";
import { ScanCta } from "./ScanCta";
import { Section } from "./Section";

const { perMonth, trialDays } = PRICING.annual;

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="mt-1 shrink-0">
      <path d="M3 8.5l3.2 3.2L13 4.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface PlanProps {
  name: string;
  price: string;
  /** Unit after the price, e.g. "/mo". */
  per?: string;
  terms: string;
  /** Line that introduces the list, e.g. "Everything in Free, plus". */
  lead?: string;
  features: readonly string[];
  featured?: boolean;
}

function Plan({ name, price, per, terms, lead, features, featured }: PlanProps) {
  return (
    <div className={cx("rounded-card border p-6", featured ? "border-line-strong bg-card shadow-card" : "hairline")}>
      <h3 className="text-2xl">{name}</h3>
      <p className="mt-4 flex items-baseline gap-1">
        <span className="tabular font-serif text-[2.75rem] leading-none">{price}</span>
        {per && <span className="text-ink-2">{per}</span>}
      </p>
      <p className="mt-2 text-sm text-ink-3">{terms}</p>
      <div className="mt-6 border-t hairline pt-5">
        {lead && <p className="mb-3 text-sm text-ink-3">{lead}</p>}
        <ul className="space-y-2.5">
          {features.map((feature) => (
            <li key={feature} className="flex gap-2.5">
              <CheckIcon />
              {feature}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * Both lists and the price come from the constants the paywall uses, so the
 * landing page cannot promise a plan the product does not sell. The page keeps
 * a single action: the way into Pro is through the free scan.
 */
export function Plans() {
  return (
    <Section title="Free vs Pro" lede="The scan and the Daily Catch are free. Pro makes the practice personal.">
      <div className="grid gap-4 sm:grid-cols-2">
        <Plan name="Free" price="$0" terms="No sign-up, no card" features={PLAN_FEATURES.free} />
        <Plan
          name="Pro"
          price={`$${perMonth.toFixed(2)}`}
          per="/mo"
          terms={`billed annually · ${trialDays} days free`}
          lead="Everything in Free, plus"
          features={PLAN_FEATURES.pro}
          featured
        />
      </div>
      <ScanCta className="mt-8 w-full sm:w-auto" />
    </Section>
  );
}
