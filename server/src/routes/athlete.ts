import { Router, type Request, type Response } from "express";
import { Types } from "mongoose";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/role";
import { loadScope } from "../middleware/coachAthleteAccess";
import { writeRateLimit } from "../middleware/rateLimit";
import { AthleteProfile } from "../models/AthleteProfile";
import { User } from "../models/User";
import { Wellness } from "../models/Wellness";
import { Attendance, ATTENDANCE_STATUS } from "../models/Attendance";
import {
  TrainingSession,
  SESSION_SLOTS,
  SESSION_STATUS,
  SESSION_SLOT_ORDER,
  type SessionSlot,
} from "../models/TrainingSession";
import { Recovery } from "../models/Recovery";
import { AthleteNote } from "../models/AthleteNote";
import { CoachComment } from "../models/CoachComment";
import { Announcement } from "../models/Announcement";
import { WaterIntake } from "../models/WaterIntake";
import {
  RpeMonitoring,
  RPE_SESSION_TYPES,
  type RpeSessionType,
} from "../models/RpeMonitoring";
import { CoachAthleteAssignment } from "../models/CoachAthleteAssignment";
import {
  TRAINING_CATEGORIES,
  deriveLoadAndRisk,
  dayOfWeek,
  parseDateOrNull,
} from "../lib/trainingCategories";
import { buildDailyCardForAthlete, dayRange } from "../services/dashboard";
import { buildTrendSeries, clampDays } from "../services/trends";
import { buildActivityFeed, clampLimit } from "../services/activity";
import {
  buildAthleteAchievements,
  clampAchievementDays,
} from "../services/achievements";
import {
  buildWellnessSeries,
  buildAttendanceSeries,
  buildSessionSeries,
  buildPerformanceSeries,
  buildWaterSeries,
} from "../services/analytics";
import {
  fetchThread,
  sendMessage,
  messageView,
  markThreadRead,
  buildAthleteThreads,
  athleteTotalUnread,
  clampMsgLimit,
} from "../services/messaging";
import { WorkoutMedia, type WorkoutMediaDoc } from "../models/WorkoutMedia";
import { mediaUpload, mediaFilePath, serializeMedia } from "../services/media";
import { notifyGuardiansOfAthleteUpdate } from "../services/notifications";
import { enrichVoiceIntentResult, getVoiceIntentInterpreter, type VoicePendingIntent } from "../services/voiceIntentInterpreter";
import { withIdempotency } from "../lib/voiceIdempotency";
import { evaluateAndDispatch } from "../services/notificationEligibility";
import { resolveTimezoneForUser } from "../services/timezone";
import { buildReadinessRiskFlag } from "../services/notificationTemplates";
import { notificationPreview } from "../services/notificationCopy";
import multer from "multer";
import fs from "fs";

const router = Router();

/**
 * Fire-and-forget: tell every guardian linked to this athlete that a new
 * Sleep/Water/Attendance data point was logged — the only things a guardian's
 * dashboard shows. Never awaited by callers so it can't slow down the
 * athlete's own response; failures are swallowed by notifyGuardiansOfAthleteUpdate.
 */
function notifyGuardiansWithStandardCopy(
  profileId: Types.ObjectId,
  actorUserId: Types.ObjectId,
  label: string
) {
  User.findById(actorUserId)
    .select("name")
    .lean()
    .then((user) => {
      const name = (user?.name as string | undefined) || "Your athlete";
      return notifyGuardiansOfAthleteUpdate(
        profileId,
        notificationPreview(`${name} logged ${label}`),
        `Open Apex to review the latest ${label.toLowerCase()} update.`
      );
    })
    .catch((err) => console.error("[guardian-notify] failed:", (err as Error).message));
}

router.use(requireAuth, requireRole("athlete"), loadScope);

/**
 * Voice assistant NLU — classifies a spoken transcript into a structured
 * intent only; it never writes to the database (the client performs the
 * actual write via the existing endpoints below, after the athlete
 * confirms), so it sits outside the stricter write-rate-limit below and
 * gets its own more generous limit sized for a multi-turn conversation.
 */
router.post(
  "/voice/interpret",
  writeRateLimit({ windowMs: 60_000, max: 120 }),
  async (req: Request, res: Response) => {
    const transcript = req.body?.transcript;
    if (typeof transcript !== "string" || !transcript.trim() || transcript.length > 2000) {
      res.status(400).json({ error: "invalid_transcript" });
      return;
    }
    const pendingIntent = sanitizePendingIntent(req.body?.pendingIntent);
    const today = new Date().toISOString().slice(0, 10);

    try {
      const interpreted = await getVoiceIntentInterpreter().interpret({ transcript, today, pendingIntent });
      const result = enrichVoiceIntentResult(interpreted, transcript);
      res.json(result);
    } catch {
      res.json({
        intent: "unsupported",
        fields: {},
        missingFields: [],
        requiresConfirmation: false,
        spokenResponse: "Sorry, I couldn't understand that — please try again.",
      });
    }
  }
);

function sanitizePendingIntent(raw: unknown): VoicePendingIntent | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.intent !== "string" || typeof r.collected !== "object" || !Array.isArray(r.missingFields)) {
    return undefined;
  }
  return {
    intent: r.intent as VoicePendingIntent["intent"],
    collected: (r.collected as Record<string, unknown>) ?? {},
    missingFields: r.missingFields.filter((f): f is string => typeof f === "string"),
  };
}

// Throttle daily-submission writes per athlete (reads are unaffected).
router.use(writeRateLimit({ windowMs: 60_000, max: 40 }));

const RECOVERY_MODALITIES = [
  "stretching",
  "ice_bath",
  "mobility",
  "physio",
  "hydration",
] as const;
type RecoveryModality = (typeof RECOVERY_MODALITIES)[number];

function selfAthleteId(req: Request): Types.ObjectId | null {
  return req.actor?.athleteProfileId ?? null;
}

function parseDate(input: unknown): Date {
  const { start } = dayRange(typeof input === "string" ? input : undefined);
  return start;
}

/**
 * Returns the parsed Date or sends 400 invalid_date and returns null.
 * Pass-through (no date supplied) → defaults to today.
 */
function parseDateStrict(
  input: unknown,
  res: Response
): Date | null {
  if (input === undefined || input === null || input === "") {
    return parseDate(undefined);
  }
  const d = parseDateOrNull(input);
  if (!d) {
    res.status(400).json({ error: "invalid_date" });
    return null;
  }
  return d;
}

function strOrUndef(v: unknown): string | undefined {
  if (typeof v !== "string" || !v.trim()) return undefined;
  return v.trim();
}

function trimmedStringInRange(
  v: unknown,
  min: number,
  max: number
): string | false {
  if (typeof v !== "string") return false;
  const trimmed = v.trim();
  if (trimmed.length < min || trimmed.length > max) return false;
  return trimmed;
}

function optionalStringUpdate(v: unknown, max: number): string | null | false {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") return false;
  const trimmed = v.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) return false;
  return trimmed;
}

function optionalNumberUpdate(
  v: unknown,
  lo: number,
  hi: number
): number | null | false {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "number" || Number.isNaN(v) || v < lo || v > hi) return false;
  return v;
}

function optionalStringField(v: unknown, max: number): string | undefined | false {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string") return false;
  const trimmed = v.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > max) return false;
  return trimmed;
}

function serializeSelfProfile(
  profile: Record<string, any>,
  user: { _id: Types.ObjectId; name?: string; email?: string } | null
) {
  return {
    athleteId: profile._id.toString(),
    userId: (profile.userId as Types.ObjectId).toString(),
    name: user?.name ?? "",
    email: user?.email ?? "",
    sport: profile.sport,
    position: profile.position ?? null,
    dob: profile.dob instanceof Date ? profile.dob.toISOString().slice(0, 10) : null,
    heightCm: profile.heightCm ?? null,
    weightKg: profile.weightKg ?? null,
    timezone: profile.timezone ?? "UTC",
    hydrationGoalMl: profile.hydrationGoalMl ?? 3000,
    academyId: profile.academyId
      ? (profile.academyId as Types.ObjectId).toString()
      : null,
  };
}

/**
 * Validates an optional numeric field.
 *  - undefined → not provided (caller should skip it)
 *  - number    → provided and within [lo, hi]
 *  - false     → provided but invalid → caller must respond 400
 *
 * Needed because Mongoose `updateOne({ upsert: true })` does NOT run schema
 * validators by default, so without this an out-of-range wellness value would
 * persist silently and skew readiness math.
 */
function optNumInRange(
  v: unknown,
  lo: number,
  hi: number
): number | undefined | false {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "number" || Number.isNaN(v) || v < lo || v > hi) return false;
  return v;
}

/**
 * GET /api/athlete/me
 */
router.get("/me", async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId || !req.actor) {
    res.status(404).json({ error: "athlete_profile_not_found" });
    return;
  }
  const profile = await AthleteProfile.findById(profileId).lean();
  if (!profile) {
    res.status(404).json({ error: "athlete_profile_not_found" });
    return;
  }
  const user = await User.findById(req.actor.userId).select("name email").lean();
  res.json({ athlete: serializeSelfProfile(profile, user) });
});

/**
 * PATCH /api/athlete/me
 * Self-service profile edit for independent and coach-linked athletes. Athletes
 * may update only personal/profile fields; coach assignment, role, academy, and
 * email ownership stay server-controlled.
 */
router.patch("/me", async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId || !req.actor) {
    res.status(404).json({ error: "athlete_profile_not_found" });
    return;
  }

  const body = req.body ?? {};
  const userSet: Record<string, unknown> = {};
  const profileSet: Record<string, unknown> = {};
  const profileUnset: Record<string, 1> = {};

  if (Object.prototype.hasOwnProperty.call(body, "name")) {
    const name = trimmedStringInRange(body.name, 2, 120);
    if (name === false) {
      res.status(400).json({ error: "invalid_name" });
      return;
    }
    userSet.name = name;
  }

  if (Object.prototype.hasOwnProperty.call(body, "sport")) {
    const sport = trimmedStringInRange(body.sport, 2, 80);
    if (sport === false) {
      res.status(400).json({ error: "invalid_sport" });
      return;
    }
    profileSet.sport = sport;
  }

  if (Object.prototype.hasOwnProperty.call(body, "position")) {
    const position = optionalStringUpdate(body.position, 80);
    if (position === false) {
      res.status(400).json({ error: "invalid_position" });
      return;
    }
    if (position === null) profileUnset.position = 1;
    else profileSet.position = position;
  }

  if (Object.prototype.hasOwnProperty.call(body, "timezone")) {
    const timezone = trimmedStringInRange(body.timezone, 1, 64);
    if (timezone === false) {
      res.status(400).json({ error: "invalid_timezone" });
      return;
    }
    profileSet.timezone = timezone;
  }

  if (Object.prototype.hasOwnProperty.call(body, "heightCm")) {
    const heightCm = optionalNumberUpdate(body.heightCm, 50, 250);
    if (heightCm === false) {
      res.status(400).json({ error: "invalid_heightCm" });
      return;
    }
    if (heightCm === null) profileUnset.heightCm = 1;
    else profileSet.heightCm = heightCm;
  }

  if (Object.prototype.hasOwnProperty.call(body, "weightKg")) {
    const weightKg = optionalNumberUpdate(body.weightKg, 20, 250);
    if (weightKg === false) {
      res.status(400).json({ error: "invalid_weightKg" });
      return;
    }
    if (weightKg === null) profileUnset.weightKg = 1;
    else profileSet.weightKg = weightKg;
  }

  if (Object.prototype.hasOwnProperty.call(body, "hydrationGoalMl")) {
    const hydrationGoalMl = optionalNumberUpdate(body.hydrationGoalMl, 500, 8000);
    if (hydrationGoalMl === false || hydrationGoalMl === null) {
      res.status(400).json({ error: "invalid_hydrationGoalMl" });
      return;
    }
    profileSet.hydrationGoalMl = hydrationGoalMl;
  }

  if (Object.prototype.hasOwnProperty.call(body, "dob")) {
    if (body.dob === undefined || body.dob === null || body.dob === "") {
      profileUnset.dob = 1;
    } else {
      const dob = parseDateOrNull(body.dob);
      if (!dob || dob.getTime() > Date.now()) {
        res.status(400).json({ error: "invalid_dob" });
        return;
      }
      profileSet.dob = dob;
    }
  }

  const profileUpdate: Record<string, unknown> = {};
  if (Object.keys(profileSet).length) profileUpdate.$set = profileSet;
  if (Object.keys(profileUnset).length) profileUpdate.$unset = profileUnset;

  await Promise.all([
    Object.keys(userSet).length
      ? User.updateOne({ _id: req.actor.userId }, { $set: userSet }, { runValidators: true })
      : Promise.resolve(),
    Object.keys(profileUpdate).length
      ? AthleteProfile.updateOne({ _id: profileId }, profileUpdate, { runValidators: true })
      : Promise.resolve(),
  ]);

  const [updatedProfile, user] = await Promise.all([
    AthleteProfile.findById(profileId).lean(),
    User.findById(req.actor.userId).select("name email").lean(),
  ]);
  if (!updatedProfile) {
    res.status(404).json({ error: "athlete_profile_not_found" });
    return;
  }
  res.json({ athlete: serializeSelfProfile(updatedProfile, user) });
});

/**
 * GET /api/athlete/daily?date=YYYY-MM-DD
 */
router.get("/daily", async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId) {
    res.status(404).json({ error: "athlete_profile_not_found" });
    return;
  }
  const date = parseDateStrict(req.query.date, res);
  if (!date) return;
  const card = await buildDailyCardForAthlete(profileId, date);
  if (!card) {
    res.status(404).json({ error: "athlete_not_found" });
    return;
  }
  res.json({ date: date.toISOString().slice(0, 10), card });
});

/**
 * GET /api/athlete/trends?days=7
 * Trailing per-day readiness / load / sleep / recovery series for self.
 */
router.get("/trends", async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId) {
    res.status(404).json({ error: "athlete_profile_not_found" });
    return;
  }
  const days = clampDays(req.query.days);
  const series = await buildTrendSeries(profileId, days);
  res.json({ days, series });
});

/**
 * GET /api/athlete/activity?limit=40
 * Unified recent-activity timeline for self.
 */
router.get("/activity", async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId) {
    res.status(404).json({ error: "athlete_profile_not_found" });
    return;
  }
  const limit = clampLimit(req.query.limit);
  const items = await buildActivityFeed(profileId, limit);
  res.json({ items });
});

/**
 * GET /api/athlete/achievements?days=60
 * Derived achievement goals for self, backed by existing daily logs.
 */
router.get("/achievements", async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId) {
    res.status(404).json({ error: "athlete_profile_not_found" });
    return;
  }
  const days = clampAchievementDays(req.query.days);
  res.json(await buildAthleteAchievements(profileId, days));
});

/**
 * Analytics series for self (drive the dashboard charts).
 *   GET /api/athlete/analytics/wellness?days=30
 *   GET /api/athlete/analytics/attendance?days=30
 *   GET /api/athlete/analytics/sessions?days=30
 *   GET /api/athlete/analytics/performance?metric=&days=90
 */
router.get("/analytics/wellness", async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId) {
    res.status(404).json({ error: "athlete_profile_not_found" });
    return;
  }
  const days = clampDays(req.query.days, 30, 90);
  res.json({ days, series: await buildWellnessSeries(profileId, days) });
});

router.get("/analytics/attendance", async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId) {
    res.status(404).json({ error: "athlete_profile_not_found" });
    return;
  }
  const days = clampDays(req.query.days, 30, 90);
  res.json({ days, ...(await buildAttendanceSeries(profileId, days)) });
});

router.get("/analytics/sessions", async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId) {
    res.status(404).json({ error: "athlete_profile_not_found" });
    return;
  }
  const days = clampDays(req.query.days, 30, 90);
  res.json({ days, series: await buildSessionSeries(profileId, days) });
});

router.get("/analytics/performance", async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId) {
    res.status(404).json({ error: "athlete_profile_not_found" });
    return;
  }
  const days = clampDays(req.query.days, 90, 90);
  const metric = typeof req.query.metric === "string" ? req.query.metric : undefined;
  res.json({ days, ...(await buildPerformanceSeries(profileId, metric, days)) });
});

/**
 * POST /api/athlete/wellness
 * body: { date?, sleepHours?, sleepQuality?, mood?, stress?, soreness?, fatigue?, note? }
 */
router.post("/wellness", async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId) {
    res.status(404).json({ error: "athlete_profile_not_found" });
    return;
  }
  const b = req.body ?? {};
  // Ranges mirror the Wellness schema; validate here so bad input is a clean
  // 400 instead of a silently-persisted value (updateOne skips validators).
  const WELLNESS_RANGES: Record<string, [number, number]> = {
    sleepHours: [0, 14],
    sleepQuality: [1, 5],
    mood: [1, 5],
    stress: [1, 5],
    soreness: [1, 5],
    fatigue: [1, 5],
  };
  const fields: Record<string, number> = {};
  for (const [key, [lo, hi]] of Object.entries(WELLNESS_RANGES)) {
    const parsed = optNumInRange(b[key], lo, hi);
    if (parsed === false) {
      res.status(400).json({ error: `invalid_${key}` });
      return;
    }
    if (parsed !== undefined) fields[key] = parsed;
  }
  const date = parseDateStrict(b.date, res);
  if (!date) return;
  const payload = {
    athleteId: profileId,
    date,
    ...fields,
    note: strOrUndef(b.note),
  };
  await Wellness.updateOne(
    { athleteId: profileId, date },
    { $set: payload },
    { upsert: true, runValidators: true }
  );
  const saved = await Wellness.findOne({ athleteId: profileId, date }).lean();
  if (fields.sleepQuality !== undefined && req.actor) {
    notifyGuardiansWithStandardCopy(profileId, req.actor.userId, "Sleep check-in");
  }
  res.json({ wellness: saved });
});

/**
 * POST /api/athlete/heart-rate
 * body: { date?, wakeHr?, bedHr? } — twice-daily resting HR. Upserts into the
 * day's Wellness doc and stamps each provided measurement with its own time, so
 * the wake (morning) and bed (night) readings keep distinct timestamps even
 * though they share one daily row. Validated 25–220 bpm.
 */
router.post("/heart-rate", async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId) {
    res.status(404).json({ error: "athlete_profile_not_found" });
    return;
  }
  const b = req.body ?? {};
  const wake = optNumInRange(b.wakeHr, 25, 220);
  const bed = optNumInRange(b.bedHr, 25, 220);
  if (wake === false) {
    res.status(400).json({ error: "invalid_wakeHr" });
    return;
  }
  if (bed === false) {
    res.status(400).json({ error: "invalid_bedHr" });
    return;
  }
  if (wake === undefined && bed === undefined) {
    res.status(400).json({ error: "no_values" });
    return;
  }
  const date = parseDateStrict(b.date, res);
  if (!date) return;

  const now = new Date();
  const set: Record<string, unknown> = { athleteId: profileId, date };
  if (wake !== undefined) {
    set.wakeHrBpm = wake;
    set.wakeHrAt = now;
  }
  if (bed !== undefined) {
    set.bedHrBpm = bed;
    set.bedHrAt = now;
  }
  await Wellness.updateOne(
    { athleteId: profileId, date },
    { $set: set },
    { upsert: true, runValidators: true }
  );
  const saved = await Wellness.findOne({ athleteId: profileId, date }).lean();
  res.json({ wellness: saved });
});

// ---------- Water intake ----------

/** A day's hydration: total so far, goal, and individual entries (oldest first). */
async function waterDayResponse(profileId: Types.ObjectId, date: Date) {
  const end = new Date(date.getTime() + 24 * 60 * 60 * 1000);
  const [entries, profile] = await Promise.all([
    WaterIntake.find({ athleteId: profileId, date: { $gte: date, $lt: end } })
      .sort({ loggedAt: 1 })
      .lean(),
    AthleteProfile.findById(profileId).select("hydrationGoalMl").lean(),
  ]);
  const totalMl = entries.reduce((s, e) => s + (e.amountMl as number), 0);
  return {
    date: date.toISOString().slice(0, 10),
    goalMl: (profile?.hydrationGoalMl as number | undefined) ?? 3000,
    totalMl,
    entries: entries.map((e) => ({
      id: e._id.toString(),
      amountMl: e.amountMl as number,
      loggedAt: (e.loggedAt as Date).toISOString(),
    })),
  };
}

/** GET /api/athlete/water?date=YYYY-MM-DD — the day's entries, total, and goal. */
router.get("/water", async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId) {
    res.status(404).json({ error: "athlete_profile_not_found" });
    return;
  }
  const date = parseDateStrict(req.query.date, res);
  if (!date) return;
  res.json(await waterDayResponse(profileId, date));
});

/**
 * POST /api/athlete/water  body: { date?, amountMl, clientActionId? } — append
 * one intake entry. clientActionId is optional (manual-UI callers don't send
 * one, unaffected) but idempotency-guarded when present — this is an
 * append-only write a voice-triggered retry must never double-apply.
 */
router.post("/water", async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId || !req.actor) {
    res.status(404).json({ error: "athlete_profile_not_found" });
    return;
  }
  const amount = optNumInRange(req.body?.amountMl, 1, 4000);
  if (amount === false || amount === undefined) {
    res.status(400).json({ error: "invalid_amountMl" });
    return;
  }
  const date = parseDateStrict(req.body?.date, res);
  if (!date) return;

  const perform = async () => {
    await WaterIntake.create({ athleteId: profileId, date, amountMl: amount, loggedAt: new Date() });
    notifyGuardiansWithStandardCopy(profileId, req.actor!.userId, "Water intake");
    return waterDayResponse(profileId, date);
  };

  const clientActionId = typeof req.body?.clientActionId === "string" ? req.body.clientActionId.trim() : "";
  if (!clientActionId) {
    res.status(201).json(await perform());
    return;
  }
  const outcome = await withIdempotency(req.actor.userId, clientActionId, "athlete/water", perform);
  if (!outcome.result) {
    res.status(202).json({ pending: true });
    return;
  }
  res.status(201).json(outcome.result);
});

/** DELETE /api/athlete/water/:id — remove one of the athlete's own entries (undo). */
router.delete("/water/:id", async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId) {
    res.status(404).json({ error: "athlete_profile_not_found" });
    return;
  }
  if (!Types.ObjectId.isValid(req.params.id)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const deleted = await WaterIntake.findOneAndDelete({
    _id: req.params.id,
    athleteId: profileId,
  }).lean();
  const day = deleted ? dayRange(deleted.date as Date).start : dayRange(undefined).start;
  res.json(await waterDayResponse(profileId, day));
});

/** GET /api/athlete/analytics/water?days=30 — daily intake totals vs goal. */
router.get("/analytics/water", async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId) {
    res.status(404).json({ error: "athlete_profile_not_found" });
    return;
  }
  const days = clampDays(req.query.days, 30, 90);
  res.json({ days, ...(await buildWaterSeries(profileId, days)) });
});

/**
 * POST /api/athlete/attendance
 * body: { date?, status, note? }
 */
router.post("/attendance", async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId || !req.actor) {
    res.status(404).json({ error: "athlete_profile_not_found" });
    return;
  }
  const status = req.body?.status;
  if (!ATTENDANCE_STATUS.includes(status)) {
    res.status(400).json({ error: "invalid_status" });
    return;
  }
  const date = parseDateStrict(req.body?.date, res);
  if (!date) return;
  const payload = {
    athleteId: profileId,
    date,
    status,
    note: strOrUndef(req.body?.note),
    recordedBy: req.actor.userId,
  };
  await Attendance.updateOne(
    { athleteId: profileId, date },
    { $set: payload },
    { upsert: true, runValidators: true }
  );
  const saved = await Attendance.findOne({ athleteId: profileId, date }).lean();
  notifyGuardiansWithStandardCopy(profileId, req.actor.userId, "Attendance");
  res.json({ attendance: saved });
});

/**
 * POST /api/athlete/rest-day
 * body: { date?, enabled? } â€” idempotently marks or clears a rest-day flag.
 * Rest is stored as the day's Attendance row so history and existing rollups
 * keep a single source of truth.
 */
router.post("/rest-day", async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId || !req.actor) {
    res.status(404).json({ error: "athlete_profile_not_found" });
    return;
  }
  const enabledRaw = req.body?.enabled ?? req.body?.rest;
  const enabled = enabledRaw === undefined ? true : enabledRaw;
  if (typeof enabled !== "boolean") {
    res.status(400).json({ error: "invalid_enabled" });
    return;
  }
  const date = parseDateStrict(req.body?.date, res);
  if (!date) return;

  if (enabled) {
    await Attendance.updateOne(
      { athleteId: profileId, date },
      {
        $set: {
          athleteId: profileId,
          date,
          status: "rest",
          note: strOrUndef(req.body?.note),
          recordedBy: req.actor.userId,
        },
      },
      { upsert: true, runValidators: true }
    );
  } else {
    await Attendance.deleteOne({ athleteId: profileId, date, status: "rest" });
  }

  const saved = await Attendance.findOne({ athleteId: profileId, date }).lean();
  res.json({ attendance: saved, isRestDay: saved?.status === "rest" });
});

/**
 * GET /api/athlete/training/:slot?date=YYYY-MM-DD
 * One session's full record (incl. attached photos) for the caller's own day.
 */
router.get("/training/:slot", async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId) {
    res.status(404).json({ error: "athlete_profile_not_found" });
    return;
  }
  const slot = req.params.slot as (typeof SESSION_SLOTS)[number];
  if (!SESSION_SLOTS.includes(slot)) {
    res.status(400).json({ error: "invalid_slot" });
    return;
  }
  const date = parseDateStrict(req.query.date, res);
  if (!date) return;
  const session = await TrainingSession.findOne({ athleteId: profileId, date, slot }).lean();
  res.json({
    session: session
      ? { ...session, photos: (session.photos ?? []).map(serializeSessionPhoto) }
      : null,
  });
});

/**
 * POST /api/athlete/training/:slot
 * body: { date?, status?, attended?, workoutType?, sets?, reps?,
 *         actualDurationMin?, effortRating?, notes? }
 * Athlete can update completion fields. Coach-owned type/plan/duration stay intact.
 */
router.post("/training/:slot", async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId) {
    res.status(404).json({ error: "athlete_profile_not_found" });
    return;
  }
  const slot = req.params.slot as (typeof SESSION_SLOTS)[number];
  if (!SESSION_SLOTS.includes(slot)) {
    res.status(400).json({ error: "invalid_slot" });
    return;
  }
  const b = req.body ?? {};
  const statusProvided = Object.prototype.hasOwnProperty.call(b, "status");
  const status = b.status;
  if (statusProvided && !SESSION_STATUS.includes(status)) {
    res.status(400).json({ error: "invalid_status" });
    return;
  }

  const attendedProvided = Object.prototype.hasOwnProperty.call(b, "attended");
  if (attendedProvided && typeof b.attended !== "boolean") {
    res.status(400).json({ error: "invalid_attended" });
    return;
  }
  const workoutType = optionalStringField(b.workoutType, 80);
  if (workoutType === false) {
    res.status(400).json({ error: "invalid_workoutType" });
    return;
  }
  const reps = optionalStringField(b.reps, 80);
  if (reps === false) {
    res.status(400).json({ error: "invalid_reps" });
    return;
  }
  const sets = optNumInRange(b.sets, 0, 200);
  if (sets === false) {
    res.status(400).json({ error: "invalid_sets" });
    return;
  }
  const actualDurationMin = optNumInRange(b.actualDurationMin, 0, 600);
  if (actualDurationMin === false) {
    res.status(400).json({ error: "invalid_actualDurationMin" });
    return;
  }
  const effortRating = optNumInRange(b.effortRating, 1, 10);
  if (effortRating === false) {
    res.status(400).json({ error: "invalid_effortRating" });
    return;
  }
  const date = parseDateStrict(req.body?.date, res);
  if (!date) return;
  const $set: Record<string, unknown> = {};
  if (statusProvided) $set.status = status;
  if (attendedProvided) {
    $set.attended = b.attended;
    if (b.attended === true) $set.status = "completed";
  }
  if (workoutType !== undefined) $set.workoutType = workoutType;
  if (sets !== undefined) $set.sets = sets;
  if (reps !== undefined) $set.reps = reps;
  if (actualDurationMin !== undefined) $set.actualDurationMin = actualDurationMin;
  if (effortRating !== undefined) $set.effortRating = effortRating;
  const notes = strOrUndef(b.notes);
  if (notes !== undefined) $set.notes = notes;
  if (Object.keys($set).length === 0) {
    res.status(400).json({ error: "no_updates" });
    return;
  }

  await TrainingSession.updateOne(
    { athleteId: profileId, date, slot },
    {
      $set,
      $setOnInsert: { athleteId: profileId, date, slot },
    },
    { upsert: true, runValidators: true }
  );

  // Completing a session is ground-truth evidence the athlete showed up —
  // auto-mark the day's Attendance as present so the coach dashboard's
  // "Present" count reflects real training completion, not a separate step.
  if (($set.attended === true || $set.status === "completed") && req.actor) {
    await Attendance.updateOne(
      { athleteId: profileId, date },
      {
        $set: { athleteId: profileId, date, status: "present", recordedBy: req.actor.userId },
      },
      { upsert: true, runValidators: true }
    );
  }

  const saved = await TrainingSession.findOne({
    athleteId: profileId,
    date,
    slot,
  }).lean();
  res.json({ session: saved });
});

function serializeSessionPhoto(p: {
  _id: Types.ObjectId;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt?: Date;
}) {
  return {
    id: p._id.toString(),
    originalName: p.originalName,
    mimeType: p.mimeType,
    sizeBytes: p.sizeBytes,
    uploadedAt: (p.uploadedAt ?? new Date()).toISOString(),
  };
}

/**
 * POST /api/athlete/training/:slot/photos  multipart, field "file", body: { date }
 * Attaches a photo to a session's notes — visible to the coach immediately
 * (no send gate), same as the coach-side upload; scoped to selfAthleteId so an
 * athlete can only ever attach to their own session.
 */
router.post(
  "/training/:slot/photos",
  (req: Request, res: Response, next) => {
    mediaUpload.single("file")(req, res, (err: unknown) => {
      if (!err) {
        next();
        return;
      }
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        res.status(400).json({ error: "file_too_large" });
        return;
      }
      res.status(400).json({ error: "unsupported_file_type" });
    });
  },
  async (req: Request, res: Response) => {
    const profileId = selfAthleteId(req);
    if (!profileId) {
      res.status(404).json({ error: "athlete_profile_not_found" });
      return;
    }
    const slot = req.params.slot as (typeof SESSION_SLOTS)[number];
    if (!SESSION_SLOTS.includes(slot)) {
      res.status(400).json({ error: "invalid_slot" });
      return;
    }
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "file_required" });
      return;
    }
    const date = parseDateStrict(req.body?.date, res);
    if (!date) {
      await fs.promises.unlink(file.path).catch(() => undefined);
      return;
    }
    const photo = {
      _id: new Types.ObjectId(),
      storedFilename: file.filename,
      originalName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      uploadedAt: new Date(),
    };
    await TrainingSession.updateOne(
      { athleteId: profileId, date, slot },
      { $push: { photos: photo }, $setOnInsert: { athleteId: profileId, date, slot } },
      { upsert: true, runValidators: true }
    );
    res.status(201).json({ photo: serializeSessionPhoto(photo) });
  }
);

/**
 * GET /api/athlete/training/:slot/photos/:photoId/file — view a photo the
 * coach (or the athlete themself) attached to one of their own sessions.
 * Scoped to selfAthleteId so an athlete can never reach another athlete's
 * session photo.
 */
router.get("/training/:slot/photos/:photoId/file", async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId) {
    res.status(404).json({ error: "athlete_profile_not_found" });
    return;
  }
  const session = await TrainingSession.findOne(
    { athleteId: profileId, "photos._id": req.params.photoId },
    { "photos.$": 1 }
  ).lean();
  const photo = session?.photos?.[0];
  if (!photo) {
    res.status(404).json({ error: "photo_not_found" });
    return;
  }
  const filePath = mediaFilePath(photo);
  res.type(photo.mimeType);
  res.setHeader("Cache-Control", "private, max-age=0, no-store");
  res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: "file_missing" });
    }
  });
});

/**
 * POST /api/athlete/recovery
 * body: { date?, modalities[], note? }
 */
router.post("/recovery", async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId) {
    res.status(404).json({ error: "athlete_profile_not_found" });
    return;
  }
  const incoming = Array.isArray(req.body?.modalities) ? req.body.modalities : [];
  const modalities = incoming.filter((m: unknown): m is RecoveryModality =>
    typeof m === "string" && (RECOVERY_MODALITIES as readonly string[]).includes(m)
  );
  const date = parseDateStrict(req.body?.date, res);
  if (!date) return;
  const payload = {
    athleteId: profileId,
    date,
    modalities,
    note: strOrUndef(req.body?.note),
  };
  await Recovery.updateOne(
    { athleteId: profileId, date },
    { $set: payload },
    { upsert: true, runValidators: true }
  );
  const saved = await Recovery.findOne({ athleteId: profileId, date }).lean();
  res.json({ recovery: saved });
});

/**
 * POST /api/athlete/notes
 * body: { date?, body, clientActionId? }
 * Append-only. clientActionId is optional (manual-UI callers don't send one)
 * but idempotency-guarded when present, for the same reason as /water above.
 */
router.post("/notes", async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId || !req.actor) {
    res.status(404).json({ error: "athlete_profile_not_found" });
    return;
  }
  const body = strOrUndef(req.body?.body);
  if (!body) {
    res.status(400).json({ error: "body_required" });
    return;
  }
  const date = parseDateStrict(req.body?.date, res);
  if (!date) return;

  const perform = async () => {
    const created = await AthleteNote.create({ athleteId: profileId, date, body });
    return { note: created.toObject() };
  };

  const clientActionId = typeof req.body?.clientActionId === "string" ? req.body.clientActionId.trim() : "";
  if (!clientActionId) {
    res.status(201).json(await perform());
    return;
  }
  const outcome = await withIdempotency(req.actor.userId, clientActionId, "athlete/notes", perform);
  if (!outcome.result) {
    res.status(202).json({ pending: true });
    return;
  }
  res.status(201).json(outcome.result);
});

/**
 * GET /api/athlete/notes?date=YYYY-MM-DD
 */
router.get("/notes", async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId) {
    res.status(404).json({ error: "athlete_profile_not_found" });
    return;
  }
  const date = parseDateStrict(req.query.date, res);
  if (!date) return;
  const end = new Date(date.getTime() + 24 * 60 * 60 * 1000);
  const notes = await AthleteNote.find({
    athleteId: profileId,
    date: { $gte: date, $lt: end },
  })
    .sort({ createdAt: -1 })
    .lean();
  res.json({ notes });
});

/**
 * GET /api/athlete/coach-comments?date=YYYY-MM-DD
 */
router.get("/coach-comments", async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId) {
    res.status(404).json({ error: "athlete_profile_not_found" });
    return;
  }
  const date = parseDateStrict(req.query.date, res);
  if (!date) return;
  const end = new Date(date.getTime() + 24 * 60 * 60 * 1000);
  const comments = await CoachComment.find({
    athleteId: profileId,
    date: { $gte: date, $lt: end },
  })
    .sort({ createdAt: -1 })
    .lean();
  res.json({ comments });
});

/**
 * GET /api/athlete/announcements — team broadcasts from the athlete's currently
 * assigned coach(es). Scoped: resolves the athlete's active coach assignments,
 * then returns only those coaches' announcements (no cross-squad leakage).
 */
router.get("/announcements", async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId) {
    res.status(404).json({ error: "athlete_profile_not_found" });
    return;
  }
  const assignments = await CoachAthleteAssignment.find({
    athleteId: profileId,
    endedAt: null,
  })
    .select("coachId")
    .lean();
  const coachIds = assignments.map((a) => a.coachId as Types.ObjectId);
  if (coachIds.length === 0) {
    res.json({ announcements: [], coachCount: 0 });
    return;
  }
  const rows = await Announcement.find({ coachId: { $in: coachIds } })
    .sort({ createdAt: -1 })
    .limit(30)
    .lean();
  const coaches = await User.find({ _id: { $in: coachIds } })
    .select("_id name")
    .lean();
  const nameById = new Map(coaches.map((c) => [c._id.toString(), c.name as string]));
  res.json({
    coachCount: coachIds.length,
    announcements: rows.map((a) => ({
      id: a._id.toString(),
      body: a.body as string,
      coachName: nameById.get((a.coachId as Types.ObjectId).toString()) ?? "Coach",
      createdAt: (a.createdAt as Date).toISOString(),
    })),
  });
});

// ---------- RPE Monitoring ----------

function inRange(v: unknown, lo: number, hi: number): v is number {
  return typeof v === "number" && !Number.isNaN(v) && v >= lo && v <= hi;
}

/**
 * POST /api/athlete/rpe-monitoring
 * Upsert keyed on (athleteId, date, sessionType). Athlete-self only.
 */
router.post("/rpe-monitoring", async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId) {
    res.status(404).json({ error: "athlete_profile_not_found" });
    return;
  }

  const b = req.body ?? {};
  const sessionType = b.sessionType as RpeSessionType;
  if (!RPE_SESSION_TYPES.includes(sessionType)) {
    res.status(400).json({ error: "invalid_sessionType" });
    return;
  }
  if (
    typeof b.trainingCategory !== "string" ||
    !(TRAINING_CATEGORIES as readonly string[]).includes(b.trainingCategory)
  ) {
    res.status(400).json({ error: "invalid_trainingCategory" });
    return;
  }
  if (!inRange(b.plannedIntensityPercent, 0, 100)) {
    res.status(400).json({ error: "invalid_plannedIntensityPercent" });
    return;
  }
  if (!inRange(b.rpe, 0, 10)) {
    res.status(400).json({ error: "invalid_rpe" });
    return;
  }
  if (!inRange(b.sleepQuality, 0, 5)) {
    res.status(400).json({ error: "invalid_sleepQuality" });
    return;
  }
  if (!inRange(b.muscleSoreness, 0, 5)) {
    res.status(400).json({ error: "invalid_muscleSoreness" });
    return;
  }
  if (!inRange(b.fatigue, 0, 5)) {
    res.status(400).json({ error: "invalid_fatigue" });
    return;
  }
  if (!inRange(b.moodMotivation, 0, 5)) {
    res.status(400).json({ error: "invalid_moodMotivation" });
    return;
  }

  // restingHeartRate is optional. Reject explicit numeric values outside [20,220].
  // Treat 0, null, undefined, "" as "not provided".
  let restingHeartRate: number | undefined;
  if (
    b.restingHeartRate !== undefined &&
    b.restingHeartRate !== null &&
    b.restingHeartRate !== "" &&
    b.restingHeartRate !== 0
  ) {
    if (!inRange(b.restingHeartRate, 20, 220)) {
      res.status(400).json({ error: "invalid_restingHeartRate" });
      return;
    }
    restingHeartRate = b.restingHeartRate;
  }

  const profile = await AthleteProfile.findById(profileId)
    .select("_id academyId")
    .lean();
  if (!profile) {
    res.status(404).json({ error: "athlete_profile_not_found" });
    return;
  }

  // Denormalize the currently-active coach if exactly one exists
  const assignments = await CoachAthleteAssignment.find({
    athleteId: profileId,
    endedAt: null,
  })
    .select("coachId")
    .lean();
  const coachId =
    assignments.length === 1
      ? (assignments[0].coachId as Types.ObjectId)
      : null;

  const date = parseDateStrict(b.date, res);
  if (!date) return;
  const day =
    typeof b.day === "string" && b.day.trim()
      ? b.day.trim()
      : dayOfWeek(date);

  const derived = deriveLoadAndRisk({
    plannedIntensityPercent: b.plannedIntensityPercent,
    rpe: b.rpe,
    fatigue: b.fatigue,
    muscleSoreness: b.muscleSoreness,
    sleepQuality: b.sleepQuality,
    moodMotivation: b.moodMotivation,
    restingHeartRate,
  });

  const payload = {
    academyId: profile.academyId ?? null,
    athleteId: profileId,
    coachId,
    date,
    day,
    sessionType,
    trainingCategory: b.trainingCategory,
    plannedIntensityPercent: b.plannedIntensityPercent,
    rpe: b.rpe,
    bodyConditionFeedback: strOrUndef(b.bodyConditionFeedback),
    restingHeartRate,
    sleepQuality: b.sleepQuality,
    muscleSoreness: b.muscleSoreness,
    fatigue: b.fatigue,
    moodMotivation: b.moodMotivation,
    ...derived,
  };

  const result = await RpeMonitoring.updateOne(
    { athleteId: profileId, date, sessionType },
    { $set: payload },
    { upsert: true, runValidators: true }
  );
  const saved = await RpeMonitoring.findOne({
    athleteId: profileId,
    date,
    sessionType,
  }).lean();

  // Surface a flagged readiness reading to every currently-assigned coach.
  // Entity-based dedup on the RpeMonitoring row's own id means re-editing the
  // same slot the same day does not re-fire a push or create another bell row.
  if (saved && saved.riskFlag !== "green" && assignments.length > 0) {
    const athleteUser = await User.findById(req.actor!.userId).select("name").lean();
    const academyId = (profile.academyId as Types.ObjectId | null | undefined) ?? null;
    const link = `/coach/athletes/${profileId.toString()}`;
    const { title, body: alertBody } = buildReadinessRiskFlag({
      athleteName: (athleteUser?.name as string) || "An athlete",
      riskReasons: (saved.riskReasons as string[]) ?? [],
    });
    await Promise.all(
      assignments.map(async (a) => {
        const coachUserId = a.coachId as Types.ObjectId;
        const timezone = await resolveTimezoneForUser({
          userId: coachUserId,
          role: "coach",
          academyId,
        });
        await evaluateAndDispatch({
          userId: coachUserId,
          type: "readiness_risk_flag",
          category: "alerts",
          priorityTier: 2,
          dedupKey: `readiness_risk_flag:${(saved._id as Types.ObjectId).toString()}:${coachUserId.toString()}`,
          title,
          body: alertBody,
          link,
          academyId,
          entityRef: { collection: "RpeMonitoring", id: saved._id as Types.ObjectId },
          timezone,
        });
      })
    );
  }

  res.status(result.upsertedCount ? 201 : 200).json({
    entry: saved,
    wasNew: result.upsertedCount === 1,
  });
});

/**
 * GET /api/athlete/rpe-monitoring?date=YYYY-MM-DD
 */
router.get("/rpe-monitoring", async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId) {
    res.status(404).json({ error: "athlete_profile_not_found" });
    return;
  }
  const date = parseDateStrict(req.query.date, res);
  if (!date) return;
  const end = new Date(date.getTime() + 24 * 60 * 60 * 1000);
  const entries = (
    await RpeMonitoring.find({
      athleteId: profileId,
      date: { $gte: date, $lt: end },
    }).lean()
  ).sort(
    (a, b) =>
      SESSION_SLOT_ORDER[a.sessionType as SessionSlot] -
      SESSION_SLOT_ORDER[b.sessionType as SessionSlot]
  );
  res.json({ entries });
});

// ---------- Direct messaging (athlete side) ----------
// Athlete⇄coach 1:1 threads. The athlete may only message a coach who is an
// ACTIVE assignment of theirs (CoachAthleteAssignment, endedAt: null) — every
// per-coach route validates this first, so an athlete can never open a thread
// with a coach they aren't assigned to.

/**
 * Resolve+validate the `:coachId` param against the athlete's active coaches.
 * Returns the coach ObjectId, or null after sending the appropriate error.
 */
async function assertAssignedCoach(
  req: Request,
  res: Response,
  athleteId: Types.ObjectId
): Promise<Types.ObjectId | null> {
  const raw = req.params.coachId;
  if (!raw || !Types.ObjectId.isValid(raw)) {
    res.status(400).json({ error: "invalid_coach_id" });
    return null;
  }
  const coachId = new Types.ObjectId(raw);
  const active = await CoachAthleteAssignment.exists({
    athleteId,
    coachId,
    endedAt: null,
  });
  if (!active) {
    res.status(403).json({ error: "coach_not_assigned" });
    return null;
  }
  return coachId;
}

/**
 * GET /api/athlete/coaches — the athlete's currently-assigned coaches (id + name).
 * Lets the athlete start a conversation with a coach they haven't messaged yet
 * (the threads list only surfaces coaches with existing messages).
 */
router.get("/coaches", async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId) {
    res.status(404).json({ error: "athlete_profile_not_found" });
    return;
  }
  const assignments = await CoachAthleteAssignment.find({
    athleteId: profileId,
    endedAt: null,
  })
    .select("coachId")
    .lean();
  const coachIds = assignments.map((a) => a.coachId as Types.ObjectId);
  if (coachIds.length === 0) {
    res.json({ coaches: [] });
    return;
  }
  const coaches = await User.find({ _id: { $in: coachIds }, isActive: true })
    .select("_id name")
    .sort({ name: 1 })
    .lean();
  res.json({
    coaches: coaches.map((c) => ({ coachId: c._id.toString(), name: c.name as string })),
  });
});

/** GET /api/athlete/messages/threads — one row per coach the athlete has messaged. */
router.get("/messages/threads", async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId) {
    res.status(404).json({ error: "athlete_profile_not_found" });
    return;
  }
  const assignments = await CoachAthleteAssignment.find({
    athleteId: profileId,
    endedAt: null,
  })
    .select("coachId")
    .lean();
  const coachIds = assignments.map((a) => a.coachId as Types.ObjectId);
  const threads = await buildAthleteThreads(profileId, coachIds);
  res.json({ threads });
});

/** GET /api/athlete/messages/unread-count — total unread across all coaches. */
router.get("/messages/unread-count", async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId) {
    res.status(404).json({ error: "athlete_profile_not_found" });
    return;
  }
  const unreadCount = await athleteTotalUnread(profileId);
  res.json({ unreadCount });
});

/** GET /api/athlete/messages/:coachId?before=&limit= — thread history. */
router.get("/messages/:coachId", async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId) {
    res.status(404).json({ error: "athlete_profile_not_found" });
    return;
  }
  const coachId = await assertAssignedCoach(req, res, profileId);
  if (!coachId) return;
  const before = req.query.before ? new Date(String(req.query.before)) : undefined;
  if (before && Number.isNaN(before.getTime())) {
    res.status(400).json({ error: "invalid_before" });
    return;
  }
  const { messages, hasMore } = await fetchThread({
    coachId,
    athleteId: profileId,
    viewerRole: "athlete",
    before,
    limit: clampMsgLimit(req.query.limit),
  });
  res.json({ messages, hasMore });
});

/**
 * POST /api/athlete/messages/:coachId  body: { body, clientActionId? } — send
 * a message. clientActionId is optional (manual-UI callers don't send one)
 * but idempotency-guarded when present, for the same reason as /water above.
 */
router.post("/messages/:coachId", async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId || !req.actor) {
    res.status(404).json({ error: "athlete_profile_not_found" });
    return;
  }
  const coachId = await assertAssignedCoach(req, res, profileId);
  if (!coachId) return;
  const body = strOrUndef(req.body?.body);
  if (!body) {
    res.status(400).json({ error: "empty_message" });
    return;
  }
  if (body.length > 4000) {
    res.status(400).json({ error: "message_too_long" });
    return;
  }

  const perform = async () => {
    const { message: created } = await sendMessage({ coachId, athleteId: profileId, senderRole: "athlete", body });
    return { message: messageView(created, "athlete", null) };
  };

  const clientActionId = typeof req.body?.clientActionId === "string" ? req.body.clientActionId.trim() : "";
  if (!clientActionId) {
    res.status(201).json(await perform());
    return;
  }
  const outcome = await withIdempotency(req.actor.userId, clientActionId, "athlete/messages", perform);
  if (!outcome.result) {
    res.status(202).json({ pending: true });
    return;
  }
  res.status(201).json(outcome.result);
});

/** POST /api/athlete/messages/:coachId/read — mark coach msgs read. */
router.post("/messages/:coachId/read", async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId) {
    res.status(404).json({ error: "athlete_profile_not_found" });
    return;
  }
  const coachId = await assertAssignedCoach(req, res, profileId);
  if (!coachId) return;
  const marked = await markThreadRead({
    coachId,
    athleteId: profileId,
    readerRole: "athlete",
  });
  res.json({ marked });
});

/**
 * Media a coach has shared with this athlete. Only rows with `sentAt` set are
 * visible — an uploaded-but-not-yet-sent image never leaks to the athlete,
 * and only the OWN athlete's rows are ever returned (scoped by athleteId =
 * selfAthleteId(req), never a client-supplied id).
 */

/** GET /api/athlete/media — images sent to me, newest first. */
router.get("/media", async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId) {
    res.status(404).json({ error: "athlete_profile_not_found" });
    return;
  }
  const rows = await WorkoutMedia.find({ athleteId: profileId, sentAt: { $ne: null } })
    .sort({ sentAt: -1 })
    .lean<WorkoutMediaDoc[]>();
  res.json({ media: rows.map((m) => serializeMedia(m as WorkoutMediaDoc)) });
});

async function loadSentMedia(req: Request, res: Response): Promise<WorkoutMediaDoc | null> {
  const profileId = selfAthleteId(req);
  if (!profileId) {
    res.status(404).json({ error: "athlete_profile_not_found" });
    return null;
  }
  const raw = req.params.mediaId;
  if (!raw || !Types.ObjectId.isValid(raw)) {
    res.status(400).json({ error: "invalid_media_id" });
    return null;
  }
  const media = await WorkoutMedia.findOne({
    _id: raw,
    athleteId: profileId,
    sentAt: { $ne: null },
  });
  if (!media) {
    res.status(404).json({ error: "media_not_found" });
    return null;
  }
  return media;
}

/** GET /api/athlete/media/:mediaId — one sent media's metadata (incl. workout table). */
router.get("/media/:mediaId", async (req: Request, res: Response) => {
  const media = await loadSentMedia(req, res);
  if (!media) return;
  res.json({ media: serializeMedia(media) });
});

/** GET /api/athlete/media/:mediaId/file — streams the raw image bytes. */
router.get("/media/:mediaId/file", async (req: Request, res: Response) => {
  const media = await loadSentMedia(req, res);
  if (!media) return;
  const filePath = mediaFilePath(media);
  res.type(media.mimeType);
  res.setHeader("Cache-Control", "private, max-age=0, no-store");
  res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: "file_missing" });
    }
  });
});

export default router;
