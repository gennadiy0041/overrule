/**
 * The Daily Catch calendar.
 *
 * Everyone in an occupation gets the same drill on the same day, and "day" means the calendar
 * day in New York: the product is for US office workers, so the drill rolls over while they
 * sleep. A UTC day would swap it at 7 or 8 in the evening, New York time.
 *
 * A day is a plain "YYYY-MM-DD" string. It sorts, compares and stores as text and carries no time
 * zone to get wrong. Arithmetic on days is done at UTC midnight, where every day has 24 hours;
 * only `etDay` and `nextEtMidnight` know about New York and its daylight-saving changes.
 */

export const DAILY_TIME_ZONE = "America/New_York";

/** Daily Catch #1. */
export const DAILY_EPOCH = "2026-11-14";

const MS_PER_DAY = 86_400_000;

const ET_CALENDAR = new Intl.DateTimeFormat("en-US", {
  timeZone: DAILY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The calendar day in New York at instant `at`. Read from named parts, so no locale's date order leaks in. */
export function etDay(at: Date): string {
  const parts: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const { type, value } of ET_CALENDAR.formatToParts(at)) parts[type] = value;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * UTC midnight of a calendar day. The round trip rejects anything that is not a real day in
 * canonical form — a full timestamp, or "2026-02-30", which some engines quietly roll over into
 * March — so a malformed day fails here instead of turning into NaN in a daily number.
 */
function utcMidnight(day: string): number {
  const ms = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(ms) || utcDay(ms) !== day) throw new RangeError(`Not a calendar day (YYYY-MM-DD): "${day}"`);
  return ms;
}

export function addDays(day: string, days: number): string {
  return utcDay(utcMidnight(day) + days * MS_PER_DAY);
}

/** Whole days from `fromDay` to `toDay`; negative when `toDay` is the earlier one. */
export function daysBetween(fromDay: string, toDay: string): number {
  return (utcMidnight(toDay) - utcMidnight(fromDay)) / MS_PER_DAY;
}

/** The "#N" in "Daily Catch #N": 1 on DAILY_EPOCH, counting up by one per ET day. */
export function dailyNumber(day: string): number {
  return daysBetween(DAILY_EPOCH, day) + 1;
}

/**
 * The instant the next ET day starts — when the daily drill changes and a streak can lapse.
 *
 * New York changes its clocks at 02:00, never at midnight, so local midnight always exists and
 * is 04:00 UTC under daylight time or 05:00 UTC under standard time. Asking `etDay` which of the
 * two already belongs to tomorrow leaves the daylight-saving rules to the tz database.
 */
export function nextEtMidnight(now: Date): Date {
  const tomorrow = addDays(etDay(now), 1);
  const daylightMidnight = new Date(`${tomorrow}T04:00:00Z`);
  return etDay(daylightMidnight) === tomorrow ? daylightMidnight : new Date(`${tomorrow}T05:00:00Z`);
}

/**
 * Consecutive ET days with at least one attempt, ending today — or yesterday. A streak is only
 * broken once a whole day passes without an attempt, so before today's first drill it still
 * counts up to yesterday instead of showing 0 all morning. `days` may repeat and come unsorted.
 */
export function currentStreak(days: ReadonlyArray<string>, today: string): number {
  const played = new Set(days);
  let day = played.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (played.has(day)) {
    streak++;
    day = addDays(day, -1);
  }
  return streak;
}

/**
 * Which drill of a pre-generated pool is today's. A plain rotation by daily number is the same
 * for every server instance and every restart without storing anything, and it walks the whole
 * pool before repeating. JavaScript's % keeps the sign of the dividend, hence the double modulo:
 * days before the epoch must still land inside the pool.
 */
export function pickDailyIndex(day: string, poolSize: number): number {
  if (!Number.isInteger(poolSize) || poolSize <= 0) {
    throw new RangeError(`The daily pool needs a positive whole size, got ${poolSize}`);
  }
  return (((dailyNumber(day) - 1) % poolSize) + poolSize) % poolSize;
}
