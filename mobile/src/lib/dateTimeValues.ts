// Pure date/time value helpers shared by DateField/TimeField and the screens
// that use them. The app passes dates around as local calendar strings
// ("YYYY-MM-DD") and times as 24h "HH:MM". Everything here reads/writes the
// LOCAL calendar fields (getFullYear/getMonth/getDate/getHours...), never
// toISOString() slices, which silently switch to UTC and give the wrong day
// or hour anywhere off UTC (e.g. India, UTC+5:30).

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** True for a real calendar date in "YYYY-MM-DD" form (rejects 2025-02-30). */
export function isValidDateString(value: string): boolean {
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  // Day 0 of the next month is the last day of this month.
  const daysInMonth = new Date(year, month, 0).getDate();
  return day <= daysInMonth;
}

/** True for a 24h "HH:MM" time. */
export function isValidTimeString(value: string): boolean {
  const match = TIME_RE.exec(value);
  if (!match) return false;
  return Number(match[1]) <= 23 && Number(match[2]) <= 59;
}

/** Local calendar date of a Date as "YYYY-MM-DD". */
export function formatLocalDate(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, "0")}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Local wall-clock time of a Date as "HH:MM" (24h). */
export function formatLocalTime(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/**
 * "YYYY-MM-DD" -> a Date at local noon of that calendar day (null if invalid).
 * Noon rather than midnight so a DST jump at midnight (some zones do this)
 * can never roll the value onto the previous/next day.
 */
export function parseLocalDate(value: string): Date | null {
  if (!isValidDateString(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  // new Date(y, ...) maps years 0-99 to 1900-1999; pin the real year.
  date.setFullYear(year);
  return date;
}

/** "HH:MM" -> minutes after midnight (null if invalid). */
export function timeToMinutes(value: string): number | null {
  if (!isValidTimeString(value)) return null;
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

/** Minutes after midnight -> "HH:MM". 1440 (end of day) renders as "24:00". */
export function minutesToTime(minutes: number): string {
  const safe = Math.max(0, Math.min(1440, Math.round(minutes)));
  return `${pad2(Math.floor(safe / 60))}:${pad2(safe % 60)}`;
}

/**
 * A Date carrying today's date (local) with the given "HH:MM" time — what the
 * native time picker needs as its `value`. Null if the time is invalid.
 */
export function timeToPickerDate(value: string, base: Date): Date | null {
  const minutes = timeToMinutes(value);
  if (minutes == null) return null;
  const date = new Date(base.getTime());
  date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return date;
}

/**
 * Local date + local time -> the absolute instant (null if either is invalid).
 * Built from numeric fields, not by parsing "YYYY-MM-DDTHH:MM", so it never
 * depends on how a JS engine interprets a zone-less ISO string.
 */
export function combineLocalDateTime(date: string, time: string): Date | null {
  const day = parseLocalDate(date);
  const minutes = timeToMinutes(time);
  if (!day || minutes == null) return null;
  day.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return day;
}

/** An ISO instant -> its LOCAL calendar date and time ({date:"", time:""} if invalid). */
export function isoToLocalParts(iso: string): { date: string; time: string } {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { date: "", time: "" };
  return { date: formatLocalDate(date), time: formatLocalTime(date) };
}

/** Whether an instant is strictly after `now` (for event handlers; keeps clock reads out of components). */
export function isInFuture(date: Date, now: number = Date.now()): boolean {
  return date.getTime() > now;
}

/** Today's local calendar date as "YYYY-MM-DD". */
export function todayLocalDate(now: Date = new Date()): string {
  return formatLocalDate(now);
}

/** The local calendar date `years` years before `now` (Feb 29 -> Feb 28 when needed). */
export function yearsAgoLocalDate(years: number, now: Date = new Date()): string {
  const year = now.getFullYear() - years;
  const month = now.getMonth();
  const lastDay = new Date(year, month + 1, 0).getDate();
  const day = Math.min(now.getDate(), lastDay);
  return formatLocalDate(new Date(year, month, day, 12));
}

/** Clamp a "YYYY-MM-DD" into [min, max] (string compare is safe for this format). */
export function clampDateString(value: string, min?: string, max?: string): string {
  if (min && value < min) return min;
  if (max && value > max) return max;
  return value;
}

/**
 * The device's IANA timezone, falling back to `fallback` (e.g. a zone already
 * saved on the server) and then "UTC" when the runtime can't tell us.
 */
export function deviceTimeZone(fallback?: string | null): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof zone === "string" && zone.length > 0) return zone;
  } catch {
    // fall through
  }
  return fallback || "UTC";
}

/** Whether the user's locale prefers a 24-hour clock (defaults to false if unknown). */
export function prefers24HourClock(): boolean {
  try {
    // Typed loosely: hourCycle isn't in every TS lib target this file builds under.
    const options = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions() as { hourCycle?: string; hour12?: boolean };
    if (options.hourCycle) return options.hourCycle === "h23" || options.hourCycle === "h24";
    if (typeof options.hour12 === "boolean") return !options.hour12;
  } catch {
    // fall through
  }
  return false;
}

/** "YYYY-MM-DD" -> e.g. "14 Mar 2026" / "Mar 14, 2026" in the user's locale. */
export function displayDate(value: string, locale?: string): string {
  const date = parseLocalDate(value);
  if (!date) return value;
  try {
    return date.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return value;
  }
}

/** "HH:MM" -> e.g. "6:30 PM" / "18:30" in the user's locale. */
export function displayTime(value: string, locale?: string): string {
  const minutes = timeToMinutes(value);
  if (minutes == null) return value;
  const date = new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60);
  try {
    return date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  } catch {
    return value;
  }
}
