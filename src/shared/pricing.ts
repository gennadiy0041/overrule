/** Pricing shown on the paywall. The hackathon build runs a demo checkout: no payment is collected. */
export const PRICING = {
  annual: { price: 99.99, perMonth: 8.33, label: "Annual", trialDays: 7 },
  monthly: { price: 19.99, perMonth: 19.99, label: "Monthly", trialDays: 7 },
} as const;

export type PlanChoice = keyof typeof PRICING;

export const TRIAL_DAYS = 7;

/** Personal practice drills a Pro member can generate per ET day. */
export const PRACTICE_DAILY_LIMIT = 10;

/**
 * "Defend your work" is sold apart from the subscription, by the pack: it answers a
 * one-off need before a deadline, not a daily habit. The first rehearsal is free.
 *
 * Not at a loss: the card fee (2.9% + $0.30) and the model calls (about $0.06 a
 * rehearsal, the measured cost of a live drill) take about $0.74 of a pack.
 */
export const REHEARSAL_PACK = { size: 5, price: 4.99 } as const;
export const FREE_REHEARSALS = 1;

/** Free vs Pro, as shown on the landing page and the paywall. */
export const PLAN_FEATURES = {
  free: ["Your AI exposure map", "Daily Catch — one shared drill a day", "Streak and Judgment Score"],
  pro: [
    "Personal drills built from your own tasks",
    "Weak-spot training: more of what you miss",
    "Weekly Debrief",
    "Review Report for your self-review",
    "Full history",
  ],
} as const;
