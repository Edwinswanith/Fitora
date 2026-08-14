import { Types } from "mongoose";
import { Attendance } from "../models/Attendance";
import { Wellness, type WellnessDoc } from "../models/Wellness";
import { TrainingSession } from "../models/TrainingSession";
import { Performance } from "../models/Performance";
import { RpeMonitoring } from "../models/RpeMonitoring";
import { Injury } from "../models/Injury";
import { AthleteNote } from "../models/AthleteNote";
import { CoachComment } from "../models/CoachComment";
import { AthleteProfile } from "../models/AthleteProfile";
import { WaterIntake } from "../models/WaterIntake";
import { User } from "../models/User";
import { computeReadiness, dayRange } from "./dashboard";

/**
 * Analytics series builders. Same windowing/gap-fill philosophy as
 * services/trends.ts: query the trailing `days` window once, group by UTC day
 * in memory, and emit one point per calendar day (oldest→newest) with null for
 * missing days so charts render gaps rather than implying zero. Readiness is
 * always computed via the canonical computeReadiness() to avoid divergence.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

function windowRange(days: number, today: Date): { start: Date; end: Date } {
  return {
    start: new Date(today.getTime() - (days - 1) * DAY_MS),
    end: new Date(today.getTime() + DAY_MS), // exclusive
  };
}

function eachDay(days: number, today: Date): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) out.push(isoDay(new Date(today.getTime() - i * DAY_MS)));
  return out;
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}

const avg = (xs: number[]): number | null =>
  xs.length ? Math.round(xs.reduce((s, n) => s + n, 0) / xs.length) : null;

// ── Per-athlete series ──────────────────────────────────────────────────────

export type WellnessPoint = {
  date: string;
  sleepHours: number | null;
  sleepQuality: number | null;
  mood: number | null;
  stress: number | null;
  soreness: number | null;
  fatigue: number | null;
  wakeHr: number | null;
  bedHr: number | null;
  /** Day's water intake as a percentage of the athlete's hydration goal. */
  waterPct: number | null;
};

export async function buildWellnessSeries(
  athleteId: Types.ObjectId,
  days: number,
  today: Date = dayRange(undefined).start
): Promise<WellnessPoint[]> {
  const { start, end } = windowRange(days, today);
  const [rows, water, profile] = await Promise.all([
    Wellness.find({ athleteId, date: { $gte: start, $lt: end } }).lean(),
    WaterIntake.find({ athleteId, date: { $gte: start, $lt: end } }).select("date amountMl").lean(),
    AthleteProfile.findById(athleteId).select("hydrationGoalMl").lean(),
  ]);
  const goalMl = (profile?.hydrationGoalMl as number | undefined) ?? 3000;
  const byDay = new Map<string, (typeof rows)[number]>();
  for (const w of rows) byDay.set(isoDay(w.date as Date), w);
  const waterByDay = new Map<string, number>();
  for (const r of water) {
    const k = isoDay(r.date as Date);
    waterByDay.set(k, (waterByDay.get(k) ?? 0) + (r.amountMl as number));
  }
  return eachDay(days, today).map((date) => {
    const w = byDay.get(date);
    const wml = waterByDay.get(date);
    return {
      date,
      sleepHours: (w?.sleepHours as number | undefined) ?? null,
      sleepQuality: (w?.sleepQuality as number | undefined) ?? null,
      mood: (w?.mood as number | undefined) ?? null,
      stress: (w?.stress as number | undefined) ?? null,
      soreness: (w?.soreness as number | undefined) ?? null,
      fatigue: (w?.fatigue as number | undefined) ?? null,
      wakeHr: (w?.wakeHrBpm as number | undefined) ?? null,
      bedHr: (w?.bedHrBpm as number | undefined) ?? null,
      waterPct: wml === undefined ? null : Math.round((wml / goalMl) * 100),
    };
  });
}

export type WaterPoint = { date: string; totalMl: number | null };

/** Daily hydration totals (ml) over the window, plus the athlete's goal. */
export async function buildWaterSeries(
  athleteId: Types.ObjectId,
  days: number,
  today: Date = dayRange(undefined).start
): Promise<{ goalMl: number; series: WaterPoint[] }> {
  const { start, end } = windowRange(days, today);
  const [rows, profile] = await Promise.all([
    WaterIntake.find({ athleteId, date: { $gte: start, $lt: end } })
      .select("date amountMl")
      .lean(),
    AthleteProfile.findById(athleteId).select("hydrationGoalMl").lean(),
  ]);
  const totals = new Map<string, number>();
  for (const r of rows) {
    const k = isoDay(r.date as Date);
    totals.set(k, (totals.get(k) ?? 0) + (r.amountMl as number));
  }
  return {
    goalMl: (profile?.hydrationGoalMl as number | undefined) ?? 3000,
    series: eachDay(days, today).map((date) => ({
      date,
      totalMl: totals.has(date) ? (totals.get(date) as number) : null,
    })),
  };
}

export type AttendancePoint = { date: string; status: string | null };

export async function buildAttendanceSeries(
  athleteId: Types.ObjectId,
  days: number,
  today: Date = dayRange(undefined).start
): Promise<{ series: AttendancePoint[]; presentRate: number | null }> {
  const { start, end } = windowRange(days, today);
  const rows = await Attendance.find({ athleteId, date: { $gte: start, $lt: end } })
    .select("date status")
    .lean();
  const byDay = new Map<string, string>();
  for (const r of rows) byDay.set(isoDay(r.date as Date), r.status as string);
  const series = eachDay(days, today).map((date) => ({ date, status: byDay.get(date) ?? null }));
  const present = rows.filter((r) => r.status === "present").length;
  const presentRate = rows.length ? Math.round((present / rows.length) * 100) : null;
  return { series, presentRate };
}

export type SessionPoint = {
  date: string;
  planned: number;
  completed: number;
  skipped: number;
  completionRate: number | null;
};

export async function buildSessionSeries(
  athleteId: Types.ObjectId,
  days: number,
  today: Date = dayRange(undefined).start
): Promise<SessionPoint[]> {
  const { start, end } = windowRange(days, today);
  const rows = await TrainingSession.find({ athleteId, date: { $gte: start, $lt: end } })
    .select("date status")
    .lean();
  const map = new Map<string, { planned: number; completed: number; skipped: number }>();
  for (const r of rows) {
    const k = isoDay(r.date as Date);
    const c = map.get(k) ?? { planned: 0, completed: 0, skipped: 0 };
    if (r.status === "completed") c.completed++;
    else if (r.status === "skipped") c.skipped++;
    else c.planned++; // planned | in_progress
    map.set(k, c);
  }
  return eachDay(days, today).map((date) => {
    const c = map.get(date);
    if (!c) return { date, planned: 0, completed: 0, skipped: 0, completionRate: null };
    const denom = c.completed + c.skipped + c.planned;
    return {
      date,
      planned: c.planned,
      completed: c.completed,
      skipped: c.skipped,
      completionRate: denom ? Math.round((c.completed / denom) * 100) : null,
    };
  });
}

export type PerformancePoint = { date: string; value: number; metric: string; unit: string };

export async function buildPerformanceSeries(
  athleteId: Types.ObjectId,
  metric: string | undefined,
  days: number,
  today: Date = dayRange(undefined).start
): Promise<{ metrics: string[]; series: PerformancePoint[] }> {
  const { start, end } = windowRange(days, today);
  const baseFilter = { athleteId, date: { $gte: start, $lt: end } };
  const metrics = (await Performance.distinct("metric", baseFilter)) as string[];
  const filter = metric ? { ...baseFilter, metric } : baseFilter;
  const rows = await Performance.find(filter).select("date value metric unit").sort({ date: 1 }).lean();
  return {
    metrics: metrics.sort(),
    series: rows.map((r) => ({
      date: isoDay(r.date as Date),
      value: r.value as number,
      metric: r.metric as string,
      unit: r.unit as string,
    })),
  };
}

// ── Multi-athlete rollups (coach squad / academy) ───────────────────────────

export type SquadPoint = {
  date: string;
  avgReadiness: number | null;
  attendanceRate: number | null;
  avgLoad: number | null;
  redFlags: number;
  athleteCount: number;
};

export async function buildSquadSeries(
  athleteIds: Types.ObjectId[],
  days: number,
  today: Date = dayRange(undefined).start
): Promise<SquadPoint[]> {
  if (athleteIds.length === 0) {
    return eachDay(days, today).map((date) => ({
      date,
      avgReadiness: null,
      attendanceRate: null,
      avgLoad: null,
      redFlags: 0,
      athleteCount: 0,
    }));
  }
  const { start, end } = windowRange(days, today);
  const [wellness, attendance, rpe] = await Promise.all([
    Wellness.find({ athleteId: { $in: athleteIds }, date: { $gte: start, $lt: end } }).lean(),
    Attendance.find({ athleteId: { $in: athleteIds }, date: { $gte: start, $lt: end } })
      .select("date status")
      .lean(),
    RpeMonitoring.find({ athleteId: { $in: athleteIds }, date: { $gte: start, $lt: end } })
      .select("date athleteId calculatedTrainingLoad riskFlag")
      .lean(),
  ]);

  const readinessByDay = new Map<string, number[]>();
  for (const w of wellness) {
    const r = computeReadiness(w as WellnessDoc);
    if (r !== null) push(readinessByDay, isoDay(w.date as Date), r);
  }
  const attByDay = new Map<string, { present: number; total: number }>();
  for (const a of attendance) {
    const k = isoDay(a.date as Date);
    const c = attByDay.get(k) ?? { present: 0, total: 0 };
    c.total++;
    if (a.status === "present") c.present++;
    attByDay.set(k, c);
  }
  // load per athlete-day (sum AM+PM), then average across athletes for the day
  const loadByDay = new Map<string, Map<string, number>>();
  const redByDay = new Map<string, number>();
  for (const r of rpe) {
    const k = isoDay(r.date as Date);
    const perAthlete = loadByDay.get(k) ?? new Map<string, number>();
    const aid = String(r.athleteId);
    perAthlete.set(aid, (perAthlete.get(aid) ?? 0) + ((r.calculatedTrainingLoad as number) ?? 0));
    loadByDay.set(k, perAthlete);
    if (r.riskFlag === "red") redByDay.set(k, (redByDay.get(k) ?? 0) + 1);
  }

  return eachDay(days, today).map((date) => {
    const att = attByDay.get(date);
    const loadMap = loadByDay.get(date);
    const loads = loadMap ? [...loadMap.values()] : [];
    return {
      date,
      avgReadiness: avg(readinessByDay.get(date) ?? []),
      attendanceRate: att && att.total ? Math.round((att.present / att.total) * 100) : null,
      avgLoad: avg(loads),
      redFlags: redByDay.get(date) ?? 0,
      athleteCount: loadMap ? loadMap.size : 0,
    };
  });
}

export type AcademyInsights = {
  trend: SquadPoint[];
  injuriesByBodyPart: { bodyPart: string; count: number }[];
  loadDistribution: { band: "green" | "amber" | "red"; count: number }[];
  rosterSize: number;
};

export async function buildAcademyInsights(
  athleteIds: Types.ObjectId[],
  days: number,
  today: Date = dayRange(undefined).start
): Promise<AcademyInsights> {
  const trend = await buildSquadSeries(athleteIds, days, today);
  const { start, end } = windowRange(days, today);
  const [injuries, rpe] = await Promise.all([
    Injury.find({ athleteId: { $in: athleteIds }, status: { $in: ["active", "monitoring"] } })
      .select("bodyPart")
      .lean(),
    RpeMonitoring.find({ athleteId: { $in: athleteIds }, date: { $gte: start, $lt: end } })
      .select("riskFlag")
      .lean(),
  ]);
  const ibp = new Map<string, number>();
  for (const i of injuries) {
    const b = (i.bodyPart as string | undefined) ?? "unknown";
    ibp.set(b, (ibp.get(b) ?? 0) + 1);
  }
  const dist = new Map<"green" | "amber" | "red", number>([
    ["green", 0],
    ["amber", 0],
    ["red", 0],
  ]);
  for (const r of rpe) {
    const band = r.riskFlag as "green" | "amber" | "red";
    dist.set(band, (dist.get(band) ?? 0) + 1);
  }
  return {
    trend,
    injuriesByBodyPart: [...ibp.entries()]
      .map(([bodyPart, count]) => ({ bodyPart, count }))
      .sort((a, b) => b.count - a.count),
    loadDistribution: [...dist.entries()].map(([band, count]) => ({ band, count })),
    rosterSize: athleteIds.length,
  };
}

// ── Coach notes inbox (athlete → coach communication) ───────────────────────

export type CoachNote = {
  noteId: string;
  athleteId: string;
  athleteName: string;
  date: string;
  body: string;
  /** True when no coach feedback exists for this athlete on/after the note's date. */
  needsReply: boolean;
};

/**
 * Recent athlete notes across a coach's roster, newest first, each flagged
 * `needsReply` when the coach hasn't responded (no CoachComment for that
 * athlete dated on/after the note). `openCount` drives the dashboard badge so
 * notes surface instead of being buried in each athlete's activity timeline.
 */
export async function buildCoachNotesInbox(
  athleteIds: Types.ObjectId[],
  days: number,
  today: Date = dayRange(undefined).start
): Promise<{ notes: CoachNote[]; openCount: number }> {
  if (athleteIds.length === 0) return { notes: [], openCount: 0 };
  const { start, end } = windowRange(days, today);
  const [notes, comments, profiles] = await Promise.all([
    AthleteNote.find({ athleteId: { $in: athleteIds }, date: { $gte: start, $lt: end } })
      .sort({ date: -1, createdAt: -1 })
      .lean(),
    CoachComment.find({ athleteId: { $in: athleteIds }, date: { $gte: start, $lt: end } })
      .select("athleteId date")
      .lean(),
    AthleteProfile.find({ _id: { $in: athleteIds } }).select("userId").lean(),
  ]);

  // Resolve display names (profile → user).
  const users = await User.find({ _id: { $in: profiles.map((p) => p.userId) } })
    .select("name")
    .lean();
  const userName = new Map(users.map((u) => [String(u._id), (u.name as string) ?? "Athlete"]));
  const nameByProfile = new Map(
    profiles.map((p) => [String(p._id), userName.get(String(p.userId)) ?? "Athlete"])
  );

  // Latest coach reply per athlete (ms).
  const lastReply = new Map<string, number>();
  for (const c of comments) {
    const k = String(c.athleteId);
    const t = new Date(c.date as Date).getTime();
    if (t > (lastReply.get(k) ?? -Infinity)) lastReply.set(k, t);
  }

  const out: CoachNote[] = notes.map((n) => {
    const aId = String(n.athleteId);
    const noteT = new Date(n.date as Date).getTime();
    return {
      noteId: String(n._id),
      athleteId: aId,
      athleteName: nameByProfile.get(aId) ?? "Athlete",
      date: isoDay(n.date as Date),
      body: (n.body as string) ?? "",
      needsReply: (lastReply.get(aId) ?? -Infinity) < noteT,
    };
  });
  return { notes: out, openCount: out.filter((n) => n.needsReply).length };
}
