import { describe, expect, test } from "bun:test";
import {
  DAILY_EPOCH,
  DAILY_TIME_ZONE,
  addDays,
  currentStreak,
  dailyNumber,
  daysBetween,
  etDay,
  nextEtMidnight,
  pickDailyIndex,
} from "../../src/engine/daily";

const HOUR = 3_600_000;

const at = (iso: string): Date => new Date(iso);

/** New York wall-clock time, read without going through the code under test. */
const etClock = new Intl.DateTimeFormat("en-US", {
  timeZone: DAILY_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

describe("etDay", () => {
  test("winter (EST, UTC−5): the day starts at 05:00 UTC", () => {
    expect(etDay(at("2026-11-15T04:59:59Z"))).toBe("2026-11-14");
    expect(etDay(at("2026-11-15T05:00:00Z"))).toBe("2026-11-15");
  });

  test("summer (EDT, UTC−4): the day starts at 04:00 UTC", () => {
    expect(etDay(at("2026-07-04T03:59:59Z"))).toBe("2026-07-03");
    expect(etDay(at("2026-07-04T04:00:00Z"))).toBe("2026-07-04");
  });

  test("New Year arrives five hours after UTC's", () => {
    expect(etDay(at("2027-01-01T04:59:59.999Z"))).toBe("2026-12-31");
    expect(etDay(at("2027-01-01T05:00:00Z"))).toBe("2027-01-01");
  });
});

describe("nextEtMidnight", () => {
  test("an ordinary winter day ends at 05:00 UTC", () => {
    expect(nextEtMidnight(at("2026-11-14T15:00:00Z"))).toEqual(at("2026-11-15T05:00:00Z"));
  });

  test("an ordinary summer day ends at 04:00 UTC", () => {
    expect(nextEtMidnight(at("2026-07-04T15:00:00Z"))).toEqual(at("2026-07-05T04:00:00Z"));
  });

  test("is strictly in the future: at midnight it returns the following midnight", () => {
    expect(nextEtMidnight(at("2026-11-15T04:59:59.999Z"))).toEqual(at("2026-11-15T05:00:00Z"));
    expect(nextEtMidnight(at("2026-11-15T05:00:00Z"))).toEqual(at("2026-11-16T05:00:00Z"));
  });

  test("spring forward: 2026-03-08 starts in EST and lasts 23 hours", () => {
    const start = nextEtMidnight(at("2026-03-07T12:00:00Z"));
    const end = nextEtMidnight(start);
    expect(start).toEqual(at("2026-03-08T05:00:00Z"));
    expect(end).toEqual(at("2026-03-09T04:00:00Z"));
    expect(end.getTime() - start.getTime()).toBe(23 * HOUR);
  });

  test("fall back: 2026-11-01 starts in EDT and lasts 25 hours", () => {
    const start = nextEtMidnight(at("2026-10-31T12:00:00Z"));
    const end = nextEtMidnight(start);
    expect(start).toEqual(at("2026-11-01T04:00:00Z"));
    expect(end).toEqual(at("2026-11-02T05:00:00Z"));
    expect(end.getTime() - start.getTime()).toBe(25 * HOUR);
  });

  test("always lands on 00:00:00 New York time, the first instant of the next day", () => {
    const step = 7 * HOUR + 13 * 60_000; // drifts through every hour of the day over the year
    for (let ms = Date.UTC(2026, 0, 1); ms < Date.UTC(2027, 0, 1); ms += step) {
      const now = new Date(ms);
      const midnight = nextEtMidnight(now);
      expect(etClock.format(midnight)).toBe("00:00:00");
      expect(etDay(midnight)).toBe(addDays(etDay(now), 1));
      expect(etDay(new Date(midnight.getTime() - 1))).toBe(etDay(now));
    }
  });
});

describe("addDays and daysBetween", () => {
  test("cross month ends, year ends and leap days", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-11-14", 0)).toBe("2026-11-14");
  });

  test("a clock change does not stretch or shrink a calendar day", () => {
    expect(addDays("2026-03-07", 2)).toBe("2026-03-09");
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
  });

  test("daysBetween is signed", () => {
    expect(daysBetween("2026-11-14", "2026-11-14")).toBe(0);
    expect(daysBetween("2026-11-14", "2026-11-10")).toBe(-4);
    expect(daysBetween("2026-11-14", "2027-11-14")).toBe(365);
  });

  test.each(["2026-02-30", "2026-11-14T05:00:00Z", "14.11.2026", "2026-1-5", ""])(
    "%p is not a calendar day",
    (malformed) => {
      expect(() => addDays(malformed, 1)).toThrow(RangeError);
      expect(() => daysBetween(DAILY_EPOCH, malformed)).toThrow(RangeError);
    },
  );
});

describe("dailyNumber", () => {
  test("2026-11-14 is Daily Catch #1", () => {
    expect(DAILY_EPOCH).toBe("2026-11-14");
    expect(dailyNumber("2026-11-14")).toBe(1);
    expect(dailyNumber("2026-11-15")).toBe(2);
    expect(dailyNumber("2027-11-14")).toBe(366);
  });

  test("ticks over at New York midnight, not UTC midnight", () => {
    expect(dailyNumber(etDay(at("2026-11-15T00:00:00Z")))).toBe(1);
    expect(dailyNumber(etDay(at("2026-11-15T04:59:59Z")))).toBe(1);
    expect(dailyNumber(etDay(at("2026-11-15T05:00:00Z")))).toBe(2);
  });

  test("days before the epoch count down from zero", () => {
    expect(dailyNumber("2026-11-13")).toBe(0);
    expect(dailyNumber("2026-11-12")).toBe(-1);
  });
});

describe("currentStreak", () => {
  const today = "2026-11-14";

  test("counts back from today when today has an attempt", () => {
    expect(currentStreak(["2026-11-12", "2026-11-13", "2026-11-14"], today)).toBe(3);
  });

  test("survives until midnight when today has no attempt yet", () => {
    expect(currentStreak(["2026-11-12", "2026-11-13"], today)).toBe(2);
  });

  test("is broken by a whole day without an attempt", () => {
    expect(currentStreak(["2026-11-11", "2026-11-12"], today)).toBe(0);
  });

  test("stops at the first gap", () => {
    expect(currentStreak(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-13", "2026-11-14"], today)).toBe(2);
  });

  test("no attempts, no streak", () => {
    expect(currentStreak([], today)).toBe(0);
  });

  test("tolerates duplicates and any order", () => {
    expect(currentStreak(["2026-11-14", "2026-11-12", "2026-11-14", "2026-11-13", "2026-11-12"], today)).toBe(3);
  });

  test("runs across month ends", () => {
    expect(currentStreak(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"], "2026-11-02")).toBe(4);
  });

  test("ignores days after today", () => {
    expect(currentStreak(["2026-11-14", "2026-11-15", "2026-11-16"], today)).toBe(1);
  });
});

describe("pickDailyIndex", () => {
  test("walks the whole pool, one drill per day, before repeating", () => {
    const days = Array.from({ length: 10 }, (_, offset) => addDays(DAILY_EPOCH, offset));
    expect(days.map((day) => pickDailyIndex(day, 10))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(pickDailyIndex(addDays(DAILY_EPOCH, 10), 10)).toBe(0);
    expect(pickDailyIndex(addDays(DAILY_EPOCH, 23), 10)).toBe(3);
  });

  test("a pool of one always serves its only drill", () => {
    expect(pickDailyIndex("2026-11-14", 1)).toBe(0);
    expect(pickDailyIndex("2027-03-01", 1)).toBe(0);
  });

  test("days before the epoch still land inside the pool", () => {
    expect(pickDailyIndex("2026-11-13", 10)).toBe(9);
    expect(pickDailyIndex("2026-11-04", 10)).toBe(0);
    expect(pickDailyIndex("2026-11-03", 10)).toBe(9);
  });

  test.each([0, -3, 2.5, Number.NaN])("a pool of size %p is rejected", (poolSize) => {
    expect(() => pickDailyIndex("2026-11-14", poolSize)).toThrow(RangeError);
  });
});
