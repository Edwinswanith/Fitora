import { Types } from "mongoose";
import { Attendance } from "../models/Attendance";
import {
  TrainingSession,
  SESSION_SLOT_ORDER,
  type SessionSlot,
} from "../models/TrainingSession";
import { Wellness, type WellnessDoc } from "../models/Wellness";
import { Recovery } from "../models/Recovery";
import { Injury } from "../models/Injury";
import { RpeMonitoring } from "../models/RpeMonitoring";
import { AthleteProfile } from "../models/AthleteProfile";
import { User } from "../models/User";

export type DayRange = { start: Date; end: Date };

export function dayRange(input?: string | Date): DayRange {
  const base = input ? new Date(input) : new Date();
  const start = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate())
  );
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/**
 * Composite readiness 0-100 derived from wellness check-in.
 * - sleepQuality / mood: higher is better → (x-1)/4 * 100
 * - stress / soreness / fatigue: lower is better → (5-x)/4 * 100
 * Components are averaged across whichever fields are present.
 * Returns null if no inputs.
 */
export function computeReadiness(w: WellnessDoc | null | undefined): number | null {
  if (!w) return null;
  const components: number[] = [];
  const pos = (v: number | undefined) =>
    typeof v === "number" ? ((v - 1) / 4) * 100 : null;
  const neg = (v: number | undefined) =>
    typeof v === "number" ? ((5 - v) / 4) * 100 : null;

  for (const c of [
    pos(w.sleepQuality as number | undefined),
    pos(w.mood as number | undefined),
    neg(w.stress as number | undefined),
    neg(w.soreness as number | undefined),
    neg(w.fatigue as number | undefined),
  ]) {
    if (c !== null) components.push(c);
  }
  if (components.length === 0) return null;
  const avg = components.reduce((s, n) => s + n, 0) / components.length;
  return Math.round(avg);
}

/**
 * Derived recovery 0-100 from the day's wellness check-in — used as a FALLBACK
 * when no measured Recovery record (wearable/coach) exists. Physical-recovery
 * flavoured: sleep quality + duration, low soreness, low fatigue, and a low wake
 * heart rate when present. Deliberately excludes mood/stress (those drive
 * readiness) so recovery isn't a clone of the readiness ring. Each component is
 * normalised to 0–1; the score is their average × 100. Null with no usable input.
 */
export function computeRecovery(
  w: WellnessDoc | null | undefined
): { score: number; status: "green" | "amber" | "red" } | null {
  if (!w) return null;
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  const parts: number[] = [];
  const sq = w.sleepQuality as number | undefined;
  if (typeof sq === "number") parts.push((sq - 1) / 4);
  const sh = w.sleepHours as number | undefined;
  if (typeof sh === "number") parts.push(clamp01(sh / 8)); // 8h+ = fully rested
  const sor = w.soreness as number | undefined;
  if (typeof sor === "number") parts.push((5 - sor) / 4);
  const fat = w.fatigue as number | undefined;
  if (typeof fat === "number") parts.push((5 - fat) / 4);
  const wakeHr = w.wakeHrBpm as number | undefined;
  if (typeof wakeHr === "number") parts.push(clamp01((80 - wakeHr) / 40)); // 40bpm→1, 80→0
  if (parts.length === 0) return null;
  const score = Math.round((parts.reduce((s, n) => s + n, 0) / parts.length) * 100);
  const status = score >= 80 ? "green" : score >= 60 ? "amber" : "red";
  return { score, status };
}

export type AthleteSummary = {
  athleteId: string;
  userId: string;
  name: string;
  sport: string;
  position: string | null;
};

export type SessionPhotoView = {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
};

export type DailyCard = AthleteSummary & {
  date: string;
  isRestDay: boolean;
  attendance: { status: string | null; note: string | null };
  sessions: Record<
    SessionSlot,
    {
      status: string | null;
      type: string | null;
      durationMin: number | null;
      intensityRpe: number | null;
      attended: boolean | null;
      workoutType: string | null;
      sets: number | null;
      reps: string | null;
      actualDurationMin: number | null;
      effortRating: number | null;
      notes: string | null;
      photos: SessionPhotoView[];
    }
  >;
  readinessScore: number | null;
  sleep: { hours: number | null; quality: number | null };
  soreness: number | null;
  heartRate: { wakeHr: number | null; bedHr: number | null };
  recovery: {
    status: string | null;
    score: number | null;
    restingHr: number | null;
    hrv: number | null;
  };
  injury: {
    active: boolean;
    bodyPart: string | null;
    severity: string | null;
    restriction: string | null;
  };
  rpe: DailyRpeSummary | null;
  rpeEntries: Record<SessionSlot, DailyRpeSummary | null>;
};

export type DailyRpeSummary = {
  sessionType: SessionSlot;
  trainingCategory: string;
  plannedIntensityPercent: number;
  rpe: number;
  calculatedTrainingLoad: number;
  fatigue: number;
  muscleSoreness: number;
  sleepQuality: number;
  moodMotivation: number;
  bodyConditionFeedback: string | null;
  riskFlag: "green" | "amber" | "red";
  riskReasons: string[];
  readinessScore: number;
  readinessBand: "green" | "amber" | "red";
};

async function loadAthleteSummaries(
  athleteIds: Types.ObjectId[]
): Promise<Map<string, AthleteSummary>> {
  if (athleteIds.length === 0) return new Map();
  const profiles = await AthleteProfile.find({ _id: { $in: athleteIds } })
    .select("_id userId sport position")
    .lean();
  const userIds = profiles.map((p) => p.userId as Types.ObjectId);
  const users = await User.find({ _id: { $in: userIds } })
    .select("_id name")
    .lean();
  const usersById = new Map(users.map((u) => [u._id.toString(), u.name as string]));
  const out = new Map<string, AthleteSummary>();
  for (const p of profiles) {
    out.set(p._id.toString(), {
      athleteId: p._id.toString(),
      userId: (p.userId as Types.ObjectId).toString(),
      name: usersById.get((p.userId as Types.ObjectId).toString()) ?? "",
      sport: (p.sport as string) ?? "",
      position: (p.position as string | undefined) ?? null,
    });
  }
  return out;
}

export async function buildDailyCardsForAthletes(
  athleteIds: Types.ObjectId[],
  date: Date
): Promise<DailyCard[]> {
  const { start, end } = dayRange(date);
  const summaries = await loadAthleteSummaries(athleteIds);

  const [attendance, sessions, wellness, recovery, injuries, rpes] =
    await Promise.all([
      Attendance.find({
        athleteId: { $in: athleteIds },
        date: { $gte: start, $lt: end },
      }).lean(),
      TrainingSession.find({
        athleteId: { $in: athleteIds },
        date: { $gte: start, $lt: end },
      }).lean(),
      Wellness.find({
        athleteId: { $in: athleteIds },
        date: { $gte: start, $lt: end },
      }).lean(),
      Recovery.find({
        athleteId: { $in: athleteIds },
        date: { $gte: start, $lt: end },
      }).lean(),
      Injury.find({
        athleteId: { $in: athleteIds },
        status: { $in: ["active", "monitoring"] },
      })
        .sort({ startedAt: -1 })
        .lean(),
      RpeMonitoring.find({
        athleteId: { $in: athleteIds },
        date: { $gte: start, $lt: end },
      })
        .sort({ updatedAt: -1 })
        .lean(),
    ]);

  const byId = <T extends { athleteId: unknown }>(rows: T[]) => {
    const m = new Map<string, T>();
    for (const r of rows) {
      const key = (r.athleteId as Types.ObjectId).toString();
      if (!m.has(key)) m.set(key, r);
    }
    return m;
  };

  const attendanceByAthlete = byId(attendance);
  const wellnessByAthlete = byId(wellness);
  const recoveryByAthlete = byId(recovery);

  const sessionsByAthlete = new Map<
    string,
    Partial<Record<SessionSlot, typeof sessions[number]>>
  >();
  for (const s of sessions) {
    const key = (s.athleteId as Types.ObjectId).toString();
    const entry = sessionsByAthlete.get(key) ?? {};
    entry[s.slot as SessionSlot] = s;
    sessionsByAthlete.set(key, entry);
  }

  const injuryByAthlete = new Map<string, typeof injuries[number]>();
  for (const inj of injuries) {
    const key = (inj.athleteId as Types.ObjectId).toString();
    if (!injuryByAthlete.has(key)) injuryByAthlete.set(key, inj);
  }

  // Latest RPE per athlete: the session latest in the day (PM > AFT > AM).
  const rpeByAthlete = new Map<string, typeof rpes[number]>();
  const rpeEntriesByAthlete = new Map<
    string,
    Partial<Record<SessionSlot, typeof rpes[number]>>
  >();
  for (const r of rpes) {
    const key = (r.athleteId as Types.ObjectId).toString();
    const slot = r.sessionType as SessionSlot;
    const entries = rpeEntriesByAthlete.get(key) ?? {};
    entries[slot] = r;
    rpeEntriesByAthlete.set(key, entries);
    const existing = rpeByAthlete.get(key);
    if (
      !existing ||
      SESSION_SLOT_ORDER[slot] >
        SESSION_SLOT_ORDER[existing.sessionType as SessionSlot]
    ) {
      rpeByAthlete.set(key, r);
    }
  }

  const dateIso = start.toISOString().slice(0, 10);
  const serializeSession = (s: typeof sessions[number] | undefined) => ({
    status: (s?.status as string | undefined) ?? null,
    type: (s?.type as string | undefined) ?? null,
    durationMin: (s?.durationMin as number | undefined) ?? null,
    intensityRpe: (s?.intensityRpe as number | undefined) ?? null,
    attended: (s?.attended as boolean | undefined) ?? null,
    workoutType: (s?.workoutType as string | undefined) ?? null,
    sets: (s?.sets as number | undefined) ?? null,
    reps: (s?.reps as string | undefined) ?? null,
    actualDurationMin: (s?.actualDurationMin as number | undefined) ?? null,
    effortRating: (s?.effortRating as number | undefined) ?? null,
    notes: (s?.notes as string | undefined) ?? null,
    photos: (
      (s?.photos as
        | { _id: Types.ObjectId; originalName: string; mimeType: string; sizeBytes: number; uploadedAt: Date }[]
        | undefined) ?? []
    ).map((p) => ({
      id: p._id.toString(),
      originalName: p.originalName,
      mimeType: p.mimeType,
      sizeBytes: p.sizeBytes,
      uploadedAt: (p.uploadedAt ?? new Date()).toISOString(),
    })),
  });
  const serializeRpe = (rpeRow: typeof rpes[number]): DailyRpeSummary => ({
    sessionType: rpeRow.sessionType as SessionSlot,
    trainingCategory: rpeRow.trainingCategory as string,
    plannedIntensityPercent: rpeRow.plannedIntensityPercent as number,
    rpe: rpeRow.rpe as number,
    calculatedTrainingLoad: rpeRow.calculatedTrainingLoad as number,
    fatigue: rpeRow.fatigue as number,
    muscleSoreness: rpeRow.muscleSoreness as number,
    sleepQuality: rpeRow.sleepQuality as number,
    moodMotivation: rpeRow.moodMotivation as number,
    bodyConditionFeedback:
      (rpeRow.bodyConditionFeedback as string | undefined) ?? null,
    riskFlag: rpeRow.riskFlag as "green" | "amber" | "red",
    riskReasons: (rpeRow.riskReasons as string[] | undefined) ?? [],
    readinessScore: (rpeRow.readinessScore as number | undefined) ?? 0,
    readinessBand:
      (rpeRow.readinessBand as "green" | "amber" | "red" | undefined) ??
      "red",
  });

  return athleteIds.map((id) => {
    const key = id.toString();
    const summary =
      summaries.get(key) ?? {
        athleteId: key,
        userId: "",
        name: "",
        sport: "",
        position: null,
      };

    const att = attendanceByAthlete.get(key);
    const slots = sessionsByAthlete.get(key) ?? {};
    const w = wellnessByAthlete.get(key);
    const rec = recoveryByAthlete.get(key);
    const inj = injuryByAthlete.get(key);
    const rpeRow = rpeByAthlete.get(key);
    const rpeSlots = rpeEntriesByAthlete.get(key) ?? {};
    // Fall back to a recovery score derived from today's check-in when there's
    // no measured Recovery record — otherwise the tile is permanently blank.
    const recFallback =
      rec?.recoveryScore == null ? computeRecovery(w as WellnessDoc | undefined) : null;

    // Attendance is derived from the day's log activity — the athlete no longer
    // marks present/late/absent by hand. An explicit record (coach-recorded, or a
    // "rest" day) still wins; otherwise "present" iff they logged/attended a
    // session or logged any RPE for the day.
    const trainedToday =
      [slots.AM, slots.AFT, slots.PM].some(
        (s) => s && (s.attended === true || s.status === "completed" || s.status === "in_progress")
      ) || Object.keys(rpeSlots).length > 0;
    const attendanceStatus = (att?.status as string | undefined) ?? (trainedToday ? "present" : null);

    return {
      ...summary,
      date: dateIso,
      isRestDay: att?.status === "rest",
      attendance: {
        status: attendanceStatus,
        note: (att?.note as string | undefined) ?? null,
      },
      sessions: {
        AM: serializeSession(slots.AM),
        AFT: serializeSession(slots.AFT),
        PM: serializeSession(slots.PM),
      },
      readinessScore: computeReadiness(w as WellnessDoc | null),
      sleep: {
        hours: (w?.sleepHours as number | undefined) ?? null,
        quality: (w?.sleepQuality as number | undefined) ?? null,
      },
      soreness: (w?.soreness as number | undefined) ?? null,
      heartRate: {
        wakeHr: (w?.wakeHrBpm as number | undefined) ?? null,
        bedHr: (w?.bedHrBpm as number | undefined) ?? null,
      },
      recovery: {
        status: (rec?.status as string | undefined) ?? recFallback?.status ?? null,
        score: (rec?.recoveryScore as number | undefined) ?? recFallback?.score ?? null,
        restingHr: (rec?.restingHr as number | undefined) ?? (w?.wakeHrBpm as number | undefined) ?? null,
        hrv: (rec?.hrv as number | undefined) ?? null,
      },
      injury: {
        active: Boolean(inj),
        bodyPart: (inj?.bodyPart as string | undefined) ?? null,
        severity: (inj?.severity as string | undefined) ?? null,
        restriction: (inj?.restriction as string | undefined) ?? null,
      },
      rpe: rpeRow ? serializeRpe(rpeRow) : null,
      rpeEntries: {
        AM: rpeSlots.AM ? serializeRpe(rpeSlots.AM) : null,
        AFT: rpeSlots.AFT ? serializeRpe(rpeSlots.AFT) : null,
        PM: rpeSlots.PM ? serializeRpe(rpeSlots.PM) : null,
      },
    };
  });
}

export async function buildDailyCardForAthlete(
  athleteId: Types.ObjectId,
  date: Date
): Promise<DailyCard | null> {
  const [card] = await buildDailyCardsForAthletes([athleteId], date);
  return card ?? null;
}
