/**
 * The paywall opens with the person's own result. These are the sentences a first-time
 * player can see, so each case is spelled out.
 */
import { describe, expect, test } from "bun:test";
import { ERROR_TYPES, type ErrorType } from "../../src/engine/drillSchema";
import type { MeResponse } from "../../src/shared/api";
import { paywallLead } from "../../src/web/lib/paywallLead";

function byType(entries: Partial<Record<ErrorType, [appeared: number, caught: number]>>): MeResponse["byType"] {
  return Object.fromEntries(
    ERROR_TYPES.map((type) => {
      const [appeared, caught] = entries[type] ?? [0, 0];
      return [type, { appeared, caught }];
    }),
  ) as MeResponse["byType"];
}

describe("paywall lead", () => {
  test("names the one kind of mistake that got through", () => {
    const lead = paywallLead(byType({ numbers: [1, 1], logic: [1, 1], risk: [1, 0] }));
    expect(lead).toBe(
      "You caught 2 of 3 planted mistakes so far — and let a risk mistake through. Pro builds new drafts from your own tasks whenever you want, and drills exactly what you miss.",
    );
  });

  test("uses the right article and joins several kinds", () => {
    expect(paywallLead(byType({ numbers: [1, 1], audience: [1, 0] }))).toContain("let an audience mistake through");
    expect(paywallLead(byType({ numbers: [1, 0], facts: [1, 0], risk: [1, 0] }))).toContain(
      "let numbers, facts and risk mistakes through",
    );
  });

  test("a clean catch is offered harder drafts, not a miss it did not make", () => {
    const lead = paywallLead(byType({ numbers: [1, 1], facts: [1, 1], logic: [1, 1] }));
    expect(lead).toStartWith("You caught all 3 planted mistakes so far.");
    expect(lead).not.toContain("through");
  });

  test("without an attempt yet, the generic sentence is shown", () => {
    expect(paywallLead(undefined)).toStartWith("You just reviewed one AI draft.");
    expect(paywallLead(byType({}))).toStartWith("You just reviewed one AI draft.");
  });
});
