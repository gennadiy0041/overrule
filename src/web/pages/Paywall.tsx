import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { MeResponse } from "../../shared/api";
import { PLAN_FEATURES, PRICING, type PlanChoice } from "../../shared/pricing";
import { track, useApi } from "../lib/api";
import { ButtonLink, cx, Eyebrow, PageLoading, Shell } from "../ui";

const PLANS: ReadonlyArray<{ id: PlanChoice; title: string; price: string; detail: string; note: string }> = [
  {
    id: "annual",
    title: PRICING.annual.label,
    price: `$${PRICING.annual.perMonth.toFixed(2)}/mo`,
    detail: `$${PRICING.annual.price.toFixed(2)} billed yearly`,
    note: `${PRICING.annual.trialDays} days free`,
  },
  {
    id: "monthly",
    title: PRICING.monthly.label,
    price: `$${PRICING.monthly.price.toFixed(2)}/mo`,
    detail: "Billed monthly",
    note: `${PRICING.monthly.trialDays} days free`,
  },
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

function Check() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true" className="mt-0.5 shrink-0">
      <path d="M4 9.5l3.5 3.5L14 6" stroke="var(--color-caught)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The soft paywall after the first result. "Continue with free plan" is always one tap away. */
export default function Paywall() {
  const { data: me, loading } = useApi<MeResponse>("/api/me");
  const [plan, setPlan] = useState<PlanChoice>("annual");
  useEffect(() => {
    track("paywall_view");
  }, []);

  if (loading) return <Shell footer={false}><PageLoading /></Shell>;

  if (me?.isPro && me.trialEndsAt) {
    return (
      <Shell footer={false}>
        <div className="flex min-h-[60dvh] flex-col items-start justify-center gap-4">
          <Eyebrow>Overrule Pro</Eyebrow>
          <h1 className="text-4xl">You’re on the Pro trial until {formatDate(me.trialEndsAt)}.</h1>
          <ButtonLink to="/dashboard" variant="dark" size="lg">
            Go to my dashboard
          </ButtonLink>
        </div>
      </Shell>
    );
  }

  return (
    <Shell footer={false}>
      <div className="animate-rise pt-4 pb-12">
        <Eyebrow>Overrule Pro</Eyebrow>
        <h1 className="mt-2 text-[2.25rem] leading-[1.08] sm:text-5xl">Train on your own work, 5 minutes a day</h1>
        <p className="mt-4 text-lg leading-relaxed text-ink-2">
          You just caught mistakes in one AI draft. Pro builds a new one from your own tasks whenever you want — and
          trains the mistakes you miss most.
        </p>

        <ul className="mt-6 space-y-2.5">
          {PLAN_FEATURES.pro.map((feature) => (
            <li key={feature} className="flex gap-3">
              <Check />
              {feature}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-ink-3">Free keeps: {PLAN_FEATURES.free.join(" · ")}.</p>

        <div role="radiogroup" aria-label="Plan" className="mt-8 grid gap-3">
          {PLANS.map((option) => {
            const selected = plan === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setPlan(option.id)}
                className={cx(
                  "flex min-h-20 items-center justify-between gap-4 rounded-2xl border-2 bg-card px-5 py-3 text-left transition-colors",
                  selected ? "border-ink" : "border-line hover:border-line-strong",
                )}
              >
                <span>
                  <span className="flex items-center gap-2 font-medium">
                    {option.title}
                    <span className="rounded-full bg-caught-soft px-2 py-0.5 text-xs font-semibold text-caught-deep">
                      {option.note}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-sm text-ink-3">{option.detail}</span>
                </span>
                <span className="tabular font-serif text-2xl">{option.price}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-sm text-ink-3">
          Skills take weeks, not days — the annual plan costs less than five months of monthly.
        </p>

        <ButtonLink to={`/checkout?plan=${plan}`} size="lg" full className="mt-6">
          Start my 7-day free trial
        </ButtonLink>
        <p className="mt-3 text-center text-sm text-ink-3">Cancel anytime.</p>
        <p className="mt-5 text-center">
          <Link to="/dashboard" className="inline-flex min-h-11 items-center font-medium underline underline-offset-4">
            Continue with free plan
          </Link>
        </p>
      </div>
    </Shell>
  );
}
