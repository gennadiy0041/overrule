/**
 * "Add a daily 5-minute reminder to my calendar": a single recurring event as an
 * iCalendar file. Times are floating (no time zone), so 9:00 means 9:00 wherever
 * the person's calendar is.
 */

const REMINDER_HOUR = 9;
const LINE_LIMIT = 75;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** RFC 5545 text escaping. */
function escapeText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** RFC 5545 line folding: continuation lines start with a space. */
function fold(line: string): string {
  if (line.length <= LINE_LIMIT) return line;
  const chunks: string[] = [line.slice(0, LINE_LIMIT)];
  for (let i = LINE_LIMIT; i < line.length; i += LINE_LIMIT - 1) chunks.push(` ${line.slice(i, i + LINE_LIMIT - 1)}`);
  return chunks.join("\r\n");
}

function utcStamp(at: Date): string {
  return (
    `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}` +
    `T${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}Z`
  );
}

export function buildDailyReminderIcs(appUrl: string, now: Date): string {
  // Starts tomorrow (by UTC date — close enough for a reminder that repeats daily).
  const start = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const startDate = `${start.getUTCFullYear()}${pad(start.getUTCMonth() + 1)}${pad(start.getUTCDate())}`;
  const link = `${appUrl}/daily`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Overrule//Daily Catch//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:daily-catch-${utcStamp(now)}@overrule`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART:${startDate}T${pad(REMINDER_HOUR)}0000`,
    "DURATION:PT5M",
    "RRULE:FREQ=DAILY",
    `SUMMARY:${escapeText("Overrule — Daily Catch (5 min)")}`,
    `DESCRIPTION:${escapeText(`One AI-written document, 3–4 hidden mistakes. Catch them: ${link}`)}`,
    `URL:${link}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeText("Daily Catch — 5 minutes")}`,
    "TRIGGER:PT0M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
