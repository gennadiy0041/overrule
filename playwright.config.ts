import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests run against a deployed instance — production by default:
 *   bun run e2e                                  (production)
 *   BASE_URL=http://localhost:3000 bun run e2e   (local)
 * Playwright's user agent marks the traffic as internal, so it never reaches the product metrics.
 */
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.e2e.ts",
  // Live drill generation can take up to a minute before the pool takes over.
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env["BASE_URL"] ?? "https://overrule-production.up.railway.app",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "phone", use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
    { name: "desktop", use: { viewport: { width: 1280, height: 900 } } },
  ],
});
