// The scrollable day strip on the Training tab. Days are local "YYYY-MM-DD"
// keys; workouts outside what Today already loaded are fetched a month at a time.

import { shiftDay } from "./progressWindow";

/** How far the strip reaches either side of today. */
export const STRIP_DAYS_BACK = 180;
export const STRIP_DAYS_AHEAD = 180;

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function parts(key: string): [number, number, number] {
  const [y, m, d] = key.split("-").map(Number);
  return [y, m || 1, d || 1];
}

/** Every day from STRIP_DAYS_BACK before today to STRIP_DAYS_AHEAD after, oldest first. */
export function stripDates(today: string, back = STRIP_DAYS_BACK, ahead = STRIP_DAYS_AHEAD): string[] {
  const out: string[] = [];
  for (let day = shiftDay(today, -back), i = 0; i <= back + ahead; i += 1, day = shiftDay(day, 1)) out.push(day);
  return out;
}

export function weekdayShort(key: string): string {
  const [y, m, d] = parts(key);
  return WEEKDAYS[new Date(y, m - 1, d).getDay()];
}

export function dayOfMonth(key: string): number {
  return parts(key)[2];
}

/** "October 2026". */
export function monthLabel(key: string): string {
  const [y, m] = parts(key);
  return `${MONTHS[m - 1]} ${y}`;
}

/** "2026-10" for a day key. */
export function monthKey(key: string): string {
  return key.slice(0, 7);
}

/** First and last day of a "YYYY-MM" month. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

/** The month of `key` and the ones either side of it. */
export function monthsAround(key: string): string[] {
  const [y, m] = parts(key);
  return [-1, 0, 1].map((offset) => {
    const date = new Date(y, m - 1 + offset, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  });
}

/** Index of the first day to show so `index` sits in the middle of `visible` days. */
export function centeredStart(index: number, visible: number, total: number): number {
  const start = index - Math.floor(visible / 2);
  return Math.max(0, Math.min(start, Math.max(0, total - visible)));
}
