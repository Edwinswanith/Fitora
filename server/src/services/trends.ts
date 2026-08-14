import { Types } from "mongoose";
import { Wellness, type WellnessDoc } from "../models/Wellness";
import { Recovery } from "../models/Recovery";
import { RpeMonitoring } from "../models/RpeMonitoring";
import { computeReadiness, dayRange } from "./dashboard";

export type TrendPoint = {
  date: string; // YYYY-MM-DD (UTC)
  readiness: number | null;
  load: number | null; // total RPE training load that day (AM + PM)
  sleepHours: number | null;
  recoveryScore: number | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function clampDays(input: unknown, fallback = 7, max = 30): number {
  const n = Number(input);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), 1), max);
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Builds a per-day series for the trailing `days` window ending today (UTC),
 * inclusive. Days with no data are emitted with null fields so the chart can
 * render gaps rather than implying zero.
 */
export async function buildTrendSeries(
  athleteId: Types.ObjectId,
  days: number,
  today: Date = dayRange(undefined).start
): Promise<TrendPoint[]> {
  const end = new Date(today.getTime() + DAY_MS); // exclusive upper bound
  const start = new Date(today.getTime() - (days - 1) * DAY_MS);

  const [wellness, recovery, rpe] = await Promise.all([
    Wellness.find({ athleteId, date: { $gte: start, $lt: end } }).lean(),
    Recovery.find({ athleteId, date: { $gte: start, $lt: end } }).lean(),
    RpeMonitoring.find({ athleteId, date: { $gte: start, $lt: end } })
      .select("date calculatedTrainingLoad")
      .lean(),
  ]);

  const wellnessByDay = new Map<string, (typeof wellness)[number]>();
  for (const w of wellness) wellnessByDay.set(isoDay(w.date as Date), w);

  const recoveryByDay = new Map<string, (typeof recovery)[number]>();
  for (const r of recovery) recoveryByDay.set(isoDay(r.date as Date), r);

  const loadByDay = new Map<string, number>();
  for (const r of rpe) {
    const key = isoDay(r.date as Date);
    loadByDay.set(key, (loadByDay.get(key) ?? 0) + ((r.calculatedTrainingLoad as number) ?? 0));
  }

  const series: TrendPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * DAY_MS);
    const key = isoDay(d);
    const w = wellnessByDay.get(key);
    const rec = recoveryByDay.get(key);
    series.push({
      date: key,
      readiness: computeReadiness((w as WellnessDoc | undefined) ?? null),
      load: loadByDay.has(key) ? (loadByDay.get(key) as number) : null,
      sleepHours: (w?.sleepHours as number | undefined) ?? null,
      recoveryScore: (rec?.recoveryScore as number | undefined) ?? null,
    });
  }
  return series;
}
