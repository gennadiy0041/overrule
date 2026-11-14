import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { CheckoutResponse } from "../../shared/api";
import { PRICING, TRIAL_DAYS, type PlanChoice } from "../../shared/pricing";
import { api, track } from "../lib/api";
import { Button, ButtonLink, Card, Eyebrow, Shell } from "../ui";

const DAY_MS = 24 * 60 * 60 * 1000;
const REDIRECT_AFTER_MS = 900;

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <dt className="text-ink-2">{label}</dt>
      <dd className="tabular text-right font-medium">{value}</dd>
    </div>
  );
}

/**
 * Demo checkout: no card fields and no payment. It starts a real 7-day Pro trial
 * on this session so the rest of the product behaves as it would after paying.
 */
export default function Checkout() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const plan: PlanChoice = params.get("plan") === "monthly" ? "monthly" : "annual";
  const pricing = PRICING[plan];
  const [state, setState] = useState<"idle" | "pending" | "done" | "failed">("idle");

  useEffect(() => {
    track("checkout_start", { plan });
  }, [plan]);
  useEffect(() => {
    if (state !== "done") return;
    const timer = window.setTimeout(() => navigate("/dashboard", { replace: true }), REDIRECT_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [state, navigate]);

  async function start() {
    if (state === "pending") return;
    setState("pending");
    try {
      await api.post<CheckoutResponse>("/api/checkout", { plan });
      setState("done");
    } catch {
      setState("failed");
    }
  }

  const firstCharge = new Date(Date.now() + TRIAL_DAYS * DAY_MS).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  if (state === "done") {
    return (
      <Shell footer={false}>
        <div className="flex min-h-[60dvh] animate-rise flex-col items-start justify-center gap-4">
          <Eyebrow>Overrule Pro</Eyebrow>
          <h1 className="text-4xl">You’re in. Pro is on for {TRIAL_DAYS} days.</h1>
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
        <p className="rounded-xl border border-partial/40 bg-partial-soft px-4 py-3 text-sm font-medium text-partial-deep" role="note">
          Demo checkout — no payment is collected in this hackathon build
        </p>
        <h1 className="mt-6 text-4xl">Start your free trial</h1>

        <Card className="mt-6 px-5">
          <dl className="divide-y divide-line">
            <Row label="Plan" value={`Overrule Pro · ${pricing.label}`} />
            <Row label="Free trial" value={`${TRIAL_DAYS} days`} />
            <Row label="Due today" value="$0.00" />
            <Row
              label={`From ${firstCharge}`}
              value={`$${pricing.price.toFixed(2)} per ${plan === "annual" ? "year" : "month"}`}
            />
          </dl>
        </Card>
        <p className="mt-3 text-sm text-ink-3">Cancel anytime before the trial ends and you won’t be charged.</p>

        {state === "failed" && (
          <p className="mt-4 text-overrule-deep" role="alert">
            That didn’t go through. Check your connection and try again.
          </p>
        )}
        <Button size="lg" full className="mt-6" onClick={start} disabled={state === "pending"}>
          {state === "pending" ? "Starting…" : "Start my free trial"}
        </Button>
        <p className="mt-4 text-center">
          <Link to="/pro" className="inline-flex min-h-11 items-center text-ink-2 underline underline-offset-4">
            Change plan
          </Link>
        </p>
      </div>
    </Shell>
  );
}
