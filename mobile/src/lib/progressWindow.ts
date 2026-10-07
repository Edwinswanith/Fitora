// "How am I doing?" maths that is fair to new users. A week-long window used
// to divide by 7 even on someone's first day, so a perfect first day showed
// "1 / 7 days" and 14% in red. Rates only count days since the account was
// created, and nothing is judged red/amber until there is enough history.

export type JudgedTone = "success" | "warning" | "danger" | "neutral";

/** Minimum days (or items) before a low rate is shown as a warning/problem. */
export const MIN_SAMPLE_FOR_JUDGEMENT = 3;

function shiftDay(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  date.setDate(date.getDate() + days);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${mm}-${dd}`;
}

/** Local calendar day ("YYYY-MM-DD") of an ISO timestamp, or null. */
export function localDayOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${mm}-${dd}`;
}

/**
 * First day of a `windowDays`-long window ending on `today`, moved later if
 * the user joined inside the window. Unknown join date: the full window.
 */
export function windowStart(today: string, joinedDay: string | null, windowDays: number): string {
  const full = shiftDay(today, -(windowDays - 1));
  if (!joinedDay) return full;
  if (joinedDay > today) return today;
  return joinedDay > full ? joinedDay : full;
}

/** Number of days in the window (1..windowDays) the user has actually had an account. */
export function eligibleDays(today: string, joinedDay: string | null, windowDays: number): number {
  const start = windowStart(today, joinedDay, windowDays);
  let count = 1;
  let day = start;
  while (day < today && count < windowDays) {
    day = shiftDay(day, 1);
    count += 1;
  }
  return count;
}

/**
 * Tone for a completion rate. With a small sample, never red/amber: a new
 * user who hasn't done much yet is starting, not failing.
 */
export function judgeRate(rate: number | null, sampleSize: number): JudgedTone {
  if (rate == null) return "neutral";
  if (rate >= 0.8) return "success";
  if (sampleSize < MIN_SAMPLE_FOR_JUDGEMENT) return rate > 0 ? "success" : "neutral";
  if (rate >= 0.5) return "warning";
  return "danger";
}
