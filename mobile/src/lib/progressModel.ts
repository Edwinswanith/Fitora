// What the Progress tab says, computed without React so it can be tested.
// Every number shown on Progress comes from here, together with the counts
// behind it ("11 of 14 workouts"), so a percentage is never shown without
// its basis.

import { eligibleDays, judgeRate, shiftDay, windowStart, type JudgedTone } from "./progressWindow";
import { average, finiteValues, halvesDelta, halvesPercentDelta } from "./progressStats";

export type ProgressRange = "7D" | "4W" | "3M";
export type ProgressArea = "training" | "nutrition" | "recovery";

export const RANGE_DAYS: Record<ProgressRange, number> = { "7D": 7, "4W": 28, "3M": 90 };

/** One bar or point on a chart, with the text shown when it's tapped. */
export type ChartPoint = { label: string; value: number; detail: string };

export type DayFormatter = { weekday: (day: string) => string; date: (day: string) => string };

function toDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export const localDayFormatter: DayFormatter = {
  weekday: (day) => toDate(day).toLocaleDateString(undefined, { weekday: "short" }).slice(0, 3),
  date: (day) => toDate(day).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
};

export function rangeStart(range: ProgressRange, today: string): string {
  return shiftDay(today, -(RANGE_DAYS[range] - 1));
}

/** "Sep 10 – Oct 7": the exact days a range covers. */
export function rangeDatesLabel(range: ProgressRange, today: string, fmt: DayFormatter = localDayFormatter): string {
  return `${fmt.date(rangeStart(range, today))} – ${fmt.date(today)}`;
}

type Bucket = { start: string; end: string; label: string; detailLabel: string };

/** 7D: one per day. 4W: one per week. 3M: six two-week blocks. */
export function rangeBuckets(range: ProgressRange, today: string, fmt: DayFormatter = localDayFormatter): Bucket[] {
  const days = RANGE_DAYS[range];
  const count = range === "7D" ? 7 : range === "4W" ? 4 : 6;
  const size = days / count;
  const first = rangeStart(range, today);
  return Array.from({ length: count }, (_, i) => {
    const start = shiftDay(first, i * size);
    const end = i === count - 1 ? today : shiftDay(start, size - 1);
    const label = range === "7D" ? fmt.weekday(start) : fmt.date(start);
    const detailLabel = range === "7D" ? fmt.date(start) : `${fmt.date(start)} – ${fmt.date(end)}`;
    return { start, end, label, detailLabel };
  });
}

function bucketOf(buckets: Bucket[], day: string): number {
  return buckets.findIndex((b) => day >= b.start && day <= b.end);
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

// ── Training ──

export type WorkoutLike = { id?: string; scheduledDate: string; status: string };

export type TrainingSummary = {
  total: number;
  completed: number;
  rate: number | null;
  tone: JudgedTone;
  basis: string;
  series: ChartPoint[];
};

const isDone = (w: WorkoutLike) => w.status.toLowerCase() === "completed";

export function trainingSummary(workouts: readonly WorkoutLike[], range: ProgressRange, today: string, fmt?: DayFormatter): TrainingSummary {
  const from = rangeStart(range, today);
  const inRange = workouts.filter((w) => {
    const day = w.scheduledDate.slice(0, 10);
    return day >= from && day <= today;
  });
  const total = inRange.length;
  const completed = inRange.filter(isDone).length;
  const rate = total ? completed / total : null;
  const buckets = rangeBuckets(range, today, fmt).map((b) => ({ ...b, total: 0, done: 0 }));
  for (const w of inRange) {
    const i = bucketOf(buckets, w.scheduledDate.slice(0, 10));
    if (i < 0) continue;
    buckets[i].total += 1;
    if (isDone(w)) buckets[i].done += 1;
  }
  return {
    total,
    completed,
    rate,
    tone: judgeRate(rate, total),
    basis: total ? `${completed} of ${plural(total, "workout")} done` : "No workouts scheduled",
    // Nothing scheduled (a rest day or week) is not 0%: leave it out.
    series: buckets
      .filter((b) => b.total > 0)
      .map((b) => ({ label: b.label, value: Math.round((b.done / b.total) * 100), detail: `${b.detailLabel}: ${b.done} of ${b.total} done` })),
  };
}

// ── Nutrition ──

export type NutritionDayLike = { date: string; loggedMeals: number; calories: number };

export type NutritionSummary = {
  loggedDays: number;
  totalDays: number;
  rate: number | null;
  tone: JudgedTone;
  basis: string;
  avgCalories: number | null;
  series: ChartPoint[];
};

export function nutritionSummary(
  days: readonly NutritionDayLike[],
  range: ProgressRange,
  today: string,
  joinedDay: string | null,
  fmt?: DayFormatter
): NutritionSummary {
  // A day before the account existed can't be a missed day.
  const from = windowStart(today, joinedDay, RANGE_DAYS[range]);
  const totalDays = eligibleDays(today, joinedDay, RANGE_DAYS[range]);
  const logged = days.filter((d) => d.date >= from && d.date <= today && d.loggedMeals > 0);
  const rate = logged.length / totalDays;
  const calories = logged.map((d) => d.calories).filter((c) => c > 0);
  const buckets = rangeBuckets(range, today, fmt).map((b) => ({ ...b, values: [] as number[] }));
  for (const d of logged) {
    const i = bucketOf(buckets, d.date);
    if (i >= 0 && d.calories > 0) buckets[i].values.push(d.calories);
  }
  const avg = average(calories);
  return {
    loggedDays: logged.length,
    totalDays,
    rate,
    tone: judgeRate(rate, totalDays),
    basis: `Meals logged on ${logged.length} of ${plural(totalDays, "day")}`,
    avgCalories: avg == null ? null : Math.round(avg),
    series: buckets
      .filter((b) => b.values.length > 0)
      .map((b) => {
        const value = Math.round(average(b.values) ?? 0);
        const detail = range === "7D" ? `${b.detailLabel}: ${value.toLocaleString()} kcal` : `${b.detailLabel}: ${value.toLocaleString()} kcal avg, ${plural(b.values.length, "day")} logged`;
        return { label: b.label, value, detail };
      }),
  };
}

// ── Recovery ──

export type TrendLike = { date: string; readiness?: number | null; sleepHours?: number | null; load?: number | null };

export type ReadinessTone = "success" | "warning" | "danger" | "neutral";

export function readinessTone(score: number | null | undefined): ReadinessTone {
  if (score == null) return "neutral";
  if (score >= 75) return "success";
  if (score >= 60) return "warning";
  return "danger";
}

export const LOW_READINESS = 60;

export type RecoverySummary = {
  checkIns: number;
  avgReadiness: number | null;
  avgTone: ReadinessTone;
  delta: number | null;
  lowDays: number;
  avgSleep: number | null;
  loadDeltaPct: number | null;
  avgLoad: number | null;
  /**
   * True when today is in the red, or low days are a real share of the last
   * week's check-ins. Older low days (already recovered from) don't count.
   */
  problem: boolean;
  redToday: boolean;
  recentLowDays: number;
  recentCheckIns: number;
  basis: string;
  series: ChartPoint[];
};

/**
 * "Recover now" is about the present: low days from weeks ago (already
 * recovered from) must not raise it, so only the last 7 days count.
 */
function recentRecovery(trends: readonly TrendLike[], today: string, currentScore: number | null) {
  const weekStart = shiftDay(today, -6);
  const recent = finiteValues(trends.filter((t) => t.date.slice(0, 10) >= weekStart).map((t) => t.readiness));
  const low = recent.filter((v) => v < LOW_READINESS).length;
  const redToday = readinessTone(currentScore) === "danger";
  return { recentLowDays: low, recentCheckIns: recent.length, redToday, problem: redToday || (low >= 2 && low / recent.length >= 0.3) };
}

export function recoverySummary(
  trends: readonly TrendLike[],
  range: ProgressRange,
  today: string,
  currentScore: number | null,
  fmt?: DayFormatter
): RecoverySummary {
  const from = rangeStart(range, today);
  const inRange = trends.filter((t) => t.date.slice(0, 10) >= from && t.date.slice(0, 10) <= today).sort((a, b) => a.date.localeCompare(b.date));
  const readiness = finiteValues(inRange.map((t) => t.readiness));
  const loads = finiteValues(inRange.map((t) => t.load));
  const lowDays = readiness.filter((v) => v < LOW_READINESS).length;
  const avg = average(readiness);
  const delta = halvesDelta(readiness);
  const buckets = rangeBuckets(range, today, fmt).map((b) => ({ ...b, values: [] as number[] }));
  for (const t of inRange) {
    const i = bucketOf(buckets, t.date.slice(0, 10));
    if (i >= 0 && typeof t.readiness === "number" && Number.isFinite(t.readiness)) buckets[i].values.push(t.readiness);
  }
  return {
    checkIns: readiness.length,
    avgReadiness: avg == null ? null : Math.round(avg),
    avgTone: readinessTone(avg),
    delta,
    lowDays,
    avgSleep: average(finiteValues(inRange.map((t) => t.sleepHours))),
    loadDeltaPct: halvesPercentDelta(loads),
    avgLoad: average(loads),
    ...recentRecovery(inRange, today, currentScore),
    basis: readiness.length
      ? delta == null
        ? `From ${plural(readiness.length, "check-in")}`
        : `${delta > 0 ? "+" : ""}${delta} pts vs. the first half, ${plural(readiness.length, "check-in")}`
      : "No check-ins yet",
    series: buckets
      .filter((b) => b.values.length > 0)
      .map((b) => {
        const value = Math.round(average(b.values) ?? 0);
        const detail = range === "7D" ? `${b.detailLabel}: readiness ${value}` : `${b.detailLabel}: avg readiness ${value}, ${plural(b.values.length, "check-in")}`;
        return { label: b.label, value, detail };
      }),
  };
}

// ── Headline ──

export type ProgressHeadline = {
  hasData: boolean;
  status: "strong" | "steady" | "mixed" | "attention" | "none";
  title: string;
  body: string;
  /** The one area to act on, if any. */
  focus: ProgressArea | null;
};

/**
 * One verdict for the period. The body always names the area and the
 * numbers that caused it, so the headline never has to be taken on trust.
 */
export function progressHeadline(training: TrainingSummary, nutrition: NutritionSummary, recovery: RecoverySummary): ProgressHeadline {
  const hasData = training.total > 0 || nutrition.loggedDays > 0 || recovery.checkIns > 0;
  if (!hasData) return { hasData, status: "none", title: "Your trends start here", body: "Log a few days of check-ins, workouts or meals.", focus: null };

  const readinessDown = recovery.delta != null && recovery.delta <= -8;
  const explain: Record<ProgressArea, string> = {
    training: `${training.basis}.`,
    nutrition: `${nutrition.basis}.`,
    recovery: readinessDown
      ? `Readiness is down ${Math.abs(recovery.delta ?? 0)} pts vs. the first half.`
      : recovery.redToday
        ? "Today's readiness is under 60."
        : `${plural(recovery.recentLowDays, "low-readiness day")} in your last ${plural(recovery.recentCheckIns, "check-in")}.`,
  };

  // Recovery first: pushing training while run down is the costly mistake.
  if (recovery.problem || readinessDown) return { hasData, status: "attention", title: "Recover before pushing", body: explain.recovery, focus: "recovery" };
  if (training.tone === "danger") return { hasData, status: "attention", title: "Training needs attention", body: explain.training, focus: "training" };
  if (nutrition.tone === "danger") return { hasData, status: "attention", title: "Meals need attention", body: explain.nutrition, focus: "nutrition" };
  if (training.tone === "warning") return { hasData, status: "mixed", title: "Training is slipping", body: explain.training, focus: "training" };
  if (nutrition.tone === "warning") return { hasData, status: "mixed", title: "Log more meals", body: explain.nutrition, focus: "nutrition" };

  const trainingGood = training.total === 0 || training.tone === "success";
  const nutritionGood = nutrition.tone === "success";
  const readinessOk = recovery.delta == null || recovery.delta >= 0;
  if (trainingGood && nutritionGood && readinessOk && (training.total > 0 || recovery.checkIns > 0)) {
    return { hasData, status: "strong", title: "Strong progress", body: "Training, meals and recovery are all on track.", focus: null };
  }
  return { hasData, status: "steady", title: "Steady progress", body: "No red flags. Keep the routine going.", focus: null };
}

// ── This week ──

export type WeeklyCounts = {
  workoutDone: number;
  workoutTotal: number;
  mealDays: number;
  checkIns: number;
  days: number;
};

export function weeklyCounts(
  workouts: readonly WorkoutLike[],
  nutritionDays: readonly NutritionDayLike[],
  trends: readonly TrendLike[],
  today: string,
  joinedDay: string | null
): WeeklyCounts {
  const from = windowStart(today, joinedDay, 7);
  const inWeek = (day: string) => day.slice(0, 10) >= from && day.slice(0, 10) <= today;
  const weekWorkouts = workouts.filter((w) => inWeek(w.scheduledDate));
  return {
    workoutDone: weekWorkouts.filter(isDone).length,
    workoutTotal: weekWorkouts.length,
    mealDays: nutritionDays.filter((d) => inWeek(d.date) && d.loggedMeals > 0).length,
    checkIns: trends.filter((t) => inWeek(t.date) && typeof t.readiness === "number" && Number.isFinite(t.readiness)).length,
    days: eligibleDays(today, joinedDay, 7),
  };
}

/** Consecutive check-in days ending today, and the longest run in `trends`. */
export function checkInStreak(trends: readonly TrendLike[], today: string): { current: number; longest: number } {
  const checked = new Set(trends.filter((t) => typeof t.readiness === "number" && Number.isFinite(t.readiness)).map((t) => t.date.slice(0, 10)));
  let longest = 0;
  let running = 0;
  let previous: string | null = null;
  for (const day of [...checked].sort()) {
    running = previous && shiftDay(previous, 1) === day ? running + 1 : 1;
    longest = Math.max(longest, running);
    previous = day;
  }
  let current = 0;
  for (let day = today; checked.has(day); day = shiftDay(day, -1)) current += 1;
  return { current, longest };
}
