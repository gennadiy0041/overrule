import { expect, test, type Page } from "@playwright/test";

/** Collect console errors and uncaught exceptions; every test ends by asserting there were none. */
function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

/** Optional screenshots for the deck and for visual review: SHOTS=dir bun run e2e */
async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env["SHOTS"];
  if (dir) await page.screenshot({ path: `${dir}/${test.info().project.name}-${name}.png`, fullPage: true });
}

test("the whole path: landing → scan → map → drill → result → paywall → demo checkout → dashboard", async ({ page }) => {
  const errors = watchConsole(page);

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("AI does the work. You get paid for the judgment.");
  await shot(page, "01-landing");
  await page.getByRole("link", { name: "Scan my job — free" }).first().click();

  // Scan: job title → tasks → four one-tap questions.
  await page.getByRole("combobox").fill("marketing manager");
  await page.getByRole("option", { name: /Marketing Managers/ }).first().click();
  await expect(page.getByRole("heading", { name: "Which of these do you actually do?" })).toBeVisible();
  await shot(page, "02-scan-tasks");
  await page.getByRole("button", { name: "Continue" }).click();
  for (const [question, answer] of [
    ["How often do you use AI at work?", "Daily"],
    ["Is AI part of how your work is reviewed?", "Yes"],
    ["Have you ever sent work with an AI mistake in it?", "Yes"],
    ["What worries you most?", "Looking careless"],
  ] as const) {
    await expect(page.getByRole("heading", { name: question })).toBeVisible();
    await page.getByRole("radio", { name: answer, exact: true }).click();
  }

  // The personal exposure map.
  await expect(page).toHaveURL(/\/map$/);
  await expect(page.getByText("of your work is AI-exposed")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your value is moving from doing to judging." })).toBeVisible();
  await shot(page, "03-map");
  await page.getByRole("link", { name: "Catch your first AI mistake (2 min)" }).click();

  // The drill arrives (live generation, or the verified pool after the wait budget).
  await expect(page).toHaveURL(/\/drill\//, { timeout: 120_000 });
  await expect(page.getByText("Overrule only what’s actually wrong.")).toBeVisible();
  const targets = page.locator("[data-target-id]");
  expect(await targets.count()).toBeGreaterThan(4);
  await targets.nth(2).click();
  await page.getByRole("radio", { name: "Numbers" }).click();
  await page.getByLabel("Why? (optional)").fill("the numbers in this line do not add up");
  await shot(page, "04-drill-flag-sheet");
  await page.getByRole("button", { name: "Flag it" }).click();
  await expect(page.getByText(/1 of \d flags/)).toBeVisible();
  await shot(page, "05-drill");
  await page.getByRole("button", { name: "Submit review" }).click();

  // The annotated result and the score.
  await expect(page).toHaveURL(/\/result\//, { timeout: 45_000 });
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/You caught \d of \d|Clean catch/);
  await expect(page.getByText("Judgment Score")).toBeVisible();
  await expect(page.getByRole("heading", { name: "What to watch for" })).toBeVisible();
  await shot(page, "06-result");
  await page.getByRole("link", { name: "Continue" }).click();

  // Soft paywall → demo checkout (no card fields) → dashboard with Pro.
  await expect(page).toHaveURL(/\/pro$/);
  await expect(page.getByRole("link", { name: "Continue with free plan" })).toBeVisible();
  await shot(page, "07-paywall");
  await page.getByRole("link", { name: "Start my 7-day free trial" }).click();
  await expect(page.getByText("Demo checkout — no payment is collected in this hackathon build")).toBeVisible();
  await expect(page.locator("input")).toHaveCount(0);
  await shot(page, "08-checkout");
  await page.getByRole("button", { name: "Start my free trial" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: /Daily Catch #\d+/ })).toBeVisible();
  await expect(page.getByText(/over 1 drill/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Start a practice drill" })).toBeVisible();
  await shot(page, "09-dashboard");

  expect(errors).toEqual([]);
});

test("the demo profile shows a simulated week and lets you play today's Daily Catch", async ({ page }) => {
  const errors = watchConsole(page);

  await page.goto("/demo");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText("Demo profile — simulated week.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
  await shot(page, "10-demo-dashboard");

  await page.getByRole("link", { name: "Play today’s catch" }).click();
  await expect(page).toHaveURL(/\/drill\//, { timeout: 60_000 });
  await expect(page.getByText(/Daily Catch #\d+/)).toBeVisible();
  await shot(page, "11-daily-drill");

  expect(errors).toEqual([]);
});

test("an SEO page is server-rendered and leads into the scan", async ({ page }) => {
  const errors = watchConsole(page);

  await page.goto("/will-ai-replace/accountants-and-auditors");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Will AI replace Accountants and Auditors? A task-by-task look");
  await shot(page, "12-seo");
  await page.getByRole("link", { name: "Scan my job — free" }).click();
  await expect(page.getByRole("heading", { name: "Which of these do you actually do?" })).toBeVisible();

  expect(errors).toEqual([]);
});

test("/metrics is closed without the token", async ({ request }) => {
  expect((await request.get("/metrics")).status()).toBe(401);
  expect((await request.get("/metrics?token=wrong")).status()).toBe(401);
});

test("the API never returns the answer key before submission", async ({ request }) => {
  const daily = await request.post("/api/demo");
  expect(daily.ok()).toBe(true);
  const status = (await (await request.get("/api/daily")).json()) as { drillId?: string };
  test.skip(!status.drillId, "no pooled Daily Catch for the demo occupation yet");
  const body = await (await request.get(`/api/drills/${status.drillId}`)).text();
  for (const secret of ["explanation", "correction", "numericChecks", "decoys", "fineBecause"]) {
    expect(body).not.toContain(secret);
  }
});
