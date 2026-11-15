/**
 * The services around the engine: calendar reminder, weekly debrief, review report,
 * pool fallback and the demo profile. The demo week doubles as realistic input —
 * it is produced by the real engine from the committed pool.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { addDays, etDay } from "../../src/engine/daily";
import type { Drill } from "../../src/engine/drillSchema";
import { buildContext } from "../../src/server/bootstrap";
import type { AppContext } from "../../src/server/context";
import { loadEnv } from "../../src/server/env";
import { buildDailyReminderIcs } from "../../src/server/services/calendar";
import { buildWeeklyDebrief } from "../../src/server/services/debrief";
import { createDemoSession, DEMO_SOC, DEMO_TEMPLATE_ID, seedDemoTemplate } from "../../src/server/services/demo";
import { DrillPool, rankPoolDrills } from "../../src/server/services/pool";
import { buildReportSnapshot, newPublicId } from "../../src/server/services/report";
import type { AttemptResult } from "../../src/shared/api";

const NOW = new Date("2026-11-15T15:00:00Z"); // 10:00 in New York
let ctx: AppContext;
let week: AttemptResult[];

beforeAll(async () => {
  ctx = await buildContext(loadEnv({ NODE_ENV: "test", DB_PATH: ":memory:", APP_URL: "https://overrule.test" }), {
    now: () => NOW,
    providers: {},
  });
  await seedDemoTemplate(ctx);
  week = ctx.attempts.list(DEMO_TEMPLATE_ID);
});

describe("occupation short names", () => {
  test("launch occupations have a short label; other titles lose their exclusion clause", () => {
    expect(ctx.occupations.shortName("11-2021.00")).toBe("Marketing");
    expect(ctx.occupations.get("25-2031.00")?.title).toBe(
      "Secondary School Teachers, Except Special and Career/Technical Education",
    );
    expect(ctx.occupations.shortName("25-2031.00")).toBe("Secondary School Teachers");
    expect(ctx.occupations.shortName("29-1141.00")).toBe("Registered Nurses");
    expect(ctx.occupations.shortName("00-0000.00")).toBe("My job");
  });
});

describe("calendar reminder", () => {
  const ics = buildDailyReminderIcs("https://overrule.test", NOW);

  test("is one daily recurring 5-minute event starting tomorrow at 9:00 local time", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("RRULE:FREQ=DAILY");
    expect(ics).toContain("DURATION:PT5M");
    expect(ics).toContain("DTSTART:20261116T090000\r\n"); // floating time: no zone, no Z
    expect(ics).toContain("https://overrule.test/daily");
  });

  test("uses CRLF line endings and folds lines at 75 characters", () => {
    expect(ics.replace(/\r\n/g, "")).not.toContain("\n");
    for (const line of ics.split("\r\n")) expect(line.length).toBeLessThanOrEqual(75);
  });
});

describe("demo profile", () => {
  test("is played through the real engine and is deterministic", async () => {
    expect(week.length).toBeGreaterThanOrEqual(5);
    const other = await buildContext(loadEnv({ NODE_ENV: "test", DB_PATH: ":memory:" }), { now: () => NOW, providers: {} });
    await seedDemoTemplate(other);
    const ratings = (attempts: AttemptResult[]) => attempts.map((a) => a.rating.after);
    expect(ratings(other.attempts.list(DEMO_TEMPLATE_ID))).toEqual(ratings(week));
  });

  test("each attempt continues from the previous score, and the week ends higher than it starts", () => {
    for (let i = 1; i < week.length; i++) expect(week[i]!.rating.before).toBe(week[i - 1]!.rating.after);
    expect(week[0]!.rating.before).toBe(1000);
    expect(week[week.length - 1]!.rating.after).toBeGreaterThan(1000);
  });

  test("a visitor gets a private copy that ends yesterday and can still play today's Daily Catch", () => {
    const today = etDay(NOW);
    const visitor = createDemoSession(ctx, { userAgent: "test", isInternal: false });
    const copy = ctx.attempts.list(visitor.id);
    expect(visitor.isDemo).toBe(true);
    expect(copy.length).toBe(week.length);
    expect(copy[copy.length - 1]!.day).toBe(addDays(today, -1));
    expect(visitor.rating).toBe(week[week.length - 1]!.rating.after);

    const daily = ctx.drillService.dailyStatus(visitor);
    expect(daily.state).toBe("available");
    expect(copy.map((a) => a.drillId)).not.toContain(daily.drillId);

    const again = createDemoSession(ctx, { userAgent: "test", isInternal: false });
    expect(again.id).not.toBe(visitor.id);
  });
});

describe("weekly debrief", () => {
  test("summarises the last seven ET days from the attempt records", () => {
    const today = etDay(NOW);
    const debrief = buildWeeklyDebrief(week, today, true)!;
    const inWindow = week.filter((a) => a.day >= addDays(today, -6));
    expect(debrief.drills).toBe(inWindow.length);
    expect(debrief.caught).toBe(inWindow.reduce((n, a) => n + a.caught, 0));
    expect(debrief.headline).toContain(`${debrief.caught} of ${debrief.total} planted mistakes`);
    expect(debrief.lines.length).toBeGreaterThanOrEqual(2);
    expect(debrief.lines.at(-1)).toContain("Judgment Score");
  });

  test("keeps the detail for Pro and returns nothing when there was no drill this week", () => {
    expect(buildWeeklyDebrief(week, etDay(NOW), false)!.lines).toEqual([]);
    expect(buildWeeklyDebrief(week, "2027-03-01", true)).toBeNull();
    expect(buildWeeklyDebrief([], etDay(NOW), true)).toBeNull();
  });
});

describe("review report", () => {
  test("freezes totals that add up, a score series and a paste-ready summary", () => {
    const report = buildReportSnapshot("Marketing Managers", week, NOW)!;
    expect(report.drills).toBe(week.length);
    expect(report.caught).toBe(week.reduce((n, a) => n + a.caught, 0));
    expect(report.flags).toBe(report.caught + report.falseFlags);
    expect(report.ratingStart).toBe(1000);
    expect(report.ratingEnd).toBe(week[week.length - 1]!.rating.after);
    expect(report.ratingSeries.at(-1)?.rating).toBe(report.ratingEnd);
    expect(report.bestCatches.length).toBeLessThanOrEqual(3);
    expect(report.summary).toContain(`I caught ${report.caught} of ${report.total} planted mistakes`);
    expect(report.summary.split(". ").length).toBeGreaterThanOrEqual(3);
  });

  test("there is no report without attempts, and public ids are unguessable", () => {
    expect(buildReportSnapshot("Marketing Managers", [], NOW)).toBeNull();
    const ids = new Set(Array.from({ length: 200 }, () => newPublicId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[a-z2-9]{12}$/);
  });
});

describe("pool fallback", () => {
  const drill = (id: string, soc: string, taskId: number, level: Drill["level"]): Drill =>
    ({ ...ctx.pool.for(DEMO_SOC)[0]!, id, soc, taskId, level }) as Drill;

  test("the closest pooled occupation is itself, then the longest shared SOC prefix, then the nearest exposure", () => {
    const pool = new DrillPool([drill("a", "11-2021.00", 1, 2), drill("b", "13-2011.00", 2, 2), drill("c", "13-1071.00", 3, 2)]);
    const beta: Record<string, number> = { "11-2021.00": 0.58, "13-2011.00": 0.52, "13-1071.00": 0.59 };
    const betaOf = (soc: string) => beta[soc];
    expect(pool.nearestSoc({ soc: "13-2011.00", beta: 0.1 }, betaOf)).toBe("13-2011.00");
    expect(pool.nearestSoc({ soc: "11-2022.00", beta: 0.1 }, betaOf)).toBe("11-2021.00");
    expect(pool.nearestSoc({ soc: "29-1141.00", beta: 0.6 }, betaOf)).toBe("13-1071.00");
    expect(new DrillPool([]).nearestSoc({ soc: "29-1141.00", beta: 0.6 }, betaOf)).toBeNull();
  });

  test("candidates are ranked by the person's own tasks first, then by distance from the wanted level", () => {
    const candidates = [drill("x", DEMO_SOC, 10, 3), drill("y", DEMO_SOC, 20, 2), drill("z", DEMO_SOC, 20, 4)];
    const ranked = rankPoolDrills(candidates, { taskIds: new Set([20]), level: 2 });
    expect(ranked.map((d) => d.id)).toEqual(["y", "z", "x"]);
  });

  test("every committed pool drill still passes the verifier at boot", () => {
    expect(ctx.pool.rejected).toEqual([]);
    expect(ctx.pool.size).toBeGreaterThanOrEqual(50);
    expect(ctx.pool.occupations.length).toBe(6);
  });
});
