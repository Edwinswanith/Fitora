import mongoose, { Types } from "mongoose";
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/role";
import { loadScope } from "../middleware/coachAthleteAccess";
import { writeRateLimit } from "../middleware/rateLimit";
import { VoicePendingState } from "../models/VoicePendingState";
import { AthleteProfile } from "../models/AthleteProfile";
import { User } from "../models/User";
import { Wellness } from "../models/Wellness";
import { Attendance } from "../models/Attendance";
import { WaterIntake } from "../models/WaterIntake";
import { Recovery } from "../models/Recovery";
import { TrainingSession, SESSION_SLOTS, SESSION_STATUS, type SessionSlot } from "../models/TrainingSession";
import { RpeMonitoring, type RpeSessionType } from "../models/RpeMonitoring";
import { CoachAthleteAssignment } from "../models/CoachAthleteAssignment";
import { TRAINING_CATEGORIES, deriveLoadAndRisk, dayOfWeek, parseDateOrNull } from "../lib/trainingCategories";
import { dayRange } from "../services/dashboard";
import { evaluateAndDispatch } from "../services/notificationEligibility";
import { resolveTimezoneForUser } from "../services/timezone";
import { buildReadinessRiskFlag } from "../services/notificationTemplates";
import { withIdempotency } from "../lib/voiceIdempotency";
import { getVoiceIntentInterpreterV2 } from "../services/voiceIntentInterpreterV2";
import { derivePolicy, VOICE_INTENTS_V2, type PolicyPendingState, type VoiceIntentNameV2 } from "../services/voiceIntentPolicy";

/**
 * V2 athlete voice pipeline — additive and inert unless called. The existing
 * /api/athlete/voice/interpret (in routes/athlete.ts) is untouched and keeps
 * serving V1 exactly as before; this router is mounted separately at
 * /api/athlete/voice so both can coexist while the mobile client's
 * EXPO_PUBLIC_VOICE_ASSISTANT_V2 flag decides which one it calls (plan §13).
 */
const router = Router();

router.use(requireAuth, requireRole("athlete"), loadScope);

function selfAthleteId(req: Request): Types.ObjectId | null {
  return req.actor?.athleteProfileId ?? null;
}

/** Client fallback only — the persisted VoicePendingState document wins whenever present (plan §8.1). */
function sanitizePendingIntentHint(raw: unknown): PolicyPendingState {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!VOICE_INTENTS_V2.includes(r.intent as VoiceIntentNameV2)) return null;
  if (!r.entities || typeof r.entities !== "object") return null;
  if (!Array.isArray(r.missingFields)) return null;
  return {
    intent: r.intent as VoiceIntentNameV2,
    entities: r.entities as Record<string, unknown>,
    missingFields: r.missingFields.filter((f): f is string => typeof f === "string"),
  };
}

/**
 * POST /api/athlete/voice/interpret-v2
 * body: { transcript, pendingIntentHint? }
 *
 * Read-only from the athlete's own data's perspective — never writes to any
 * athlete-scoped collection. It only classifies (interpreter, model-only),
 * derives policy (deterministic), and persists/clears the athlete's own
 * VoicePendingState row. The actual save happens only when the client, after
 * the athlete confirms, calls the underlying REST endpoint (plan §4) with a
 * clientActionId.
 */
router.post(
  "/interpret-v2",
  writeRateLimit({ windowMs: 60_000, max: 120 }),
  async (req: Request, res: Response) => {
    const profileId = selfAthleteId(req);
    if (!profileId) {
      res.status(404).json({ error: "athlete_profile_not_found" });
      return;
    }

    const transcript = req.body?.transcript;
    if (typeof transcript !== "string" || !transcript.trim() || transcript.length > 2000) {
      res.status(400).json({ error: "invalid_transcript" });
      return;
    }

    const existing = await VoicePendingState.findOne({ athleteProfileId: profileId }).lean();
    const pending: PolicyPendingState = existing
      ? { intent: existing.intent as VoiceIntentNameV2, entities: (existing.entities as Record<string, unknown>) ?? {}, missingFields: existing.missingFields ?? [] }
      : sanitizePendingIntentHint(req.body?.pendingIntentHint);

    const today = new Date().toISOString().slice(0, 10);

    let policyResult;
    try {
      const turn = await getVoiceIntentInterpreterV2().interpret({ transcript, today, pendingIntent: pending });
      policyResult = derivePolicy(turn, pending);
    } catch {
      policyResult = derivePolicy({ intent: "unknown_intent", entities: {}, confidence: 0 }, pending);
    }

    if (policyResult.action === "collect_fields" || policyResult.action === "ready_to_confirm") {
      await VoicePendingState.findOneAndUpdate(
        { athleteProfileId: profileId },
        {
          $set: {
            intent: policyResult.effectiveIntent,
            entities: policyResult.entities,
            missingFields: policyResult.missingFields,
            lastTranscript: transcript,
          },
        },
        { upsert: true }
      );
    } else if (policyResult.action === "execute" || policyResult.action === "reject") {
      // Workflow resolved (confirmed, cancelled, or rejected) — nothing pending anymore.
      await VoicePendingState.deleteOne({ athleteProfileId: profileId });
    }
    // navigate/answer: one-shot, doesn't touch any existing pending workflow.

    res.json({
      intent: policyResult.effectiveIntent,
      entities: policyResult.entities,
      missingFields: policyResult.missingFields,
      action: policyResult.action,
      requiresConfirmation: policyResult.requiresConfirmation,
      spokenResponse: policyResult.spokenResponse,
    });
  }
);

/**
 * GET /api/athlete/voice/today-checklist?date=YYYY-MM-DD
 *
 * Backs the show_daily_checklist voice intent — read-only, checks real
 * records for the day and reports which of the day's habitual categories
 * (wellness check-in, a training session, water, recovery) aren't logged
 * yet. Never guesses; a category counts as "logged" only when a real row
 * with real content exists.
 */
router.get("/today-checklist", async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId) {
    res.status(404).json({ error: "athlete_profile_not_found" });
    return;
  }
  const date = dayRange(typeof req.query.date === "string" ? req.query.date : undefined).start;
  const end = new Date(date.getTime() + 24 * 60 * 60 * 1000);

  const [wellness, sessionLogged, waterCount, recoveryLogged] = await Promise.all([
    Wellness.findOne({ athleteId: profileId, date }).select("sleepQuality mood stress soreness fatigue sleepHours").lean(),
    TrainingSession.exists({
      athleteId: profileId,
      date,
      $or: [{ status: { $in: ["in_progress", "completed", "skipped"] } }, { attended: true }],
    }),
    WaterIntake.countDocuments({ athleteId: profileId, date: { $gte: date, $lt: end } }),
    Recovery.exists({ athleteId: profileId, date }),
  ]);
  // A heart-rate-only Wellness row (from /heart-rate) doesn't count as a
  // wellness check-in — only real check-in fields do.
  const wellnessLogged = Boolean(
    wellness &&
      ["sleepQuality", "mood", "stress", "soreness", "fatigue", "sleepHours"].some(
        (f) => wellness[f as keyof typeof wellness] !== undefined && wellness[f as keyof typeof wellness] !== null
      )
  );

  const categories: { key: string; logged: boolean }[] = [
    { key: "wellness", logged: wellnessLogged },
    { key: "session", logged: Boolean(sessionLogged) },
    { key: "water", logged: waterCount > 0 },
    { key: "recovery", logged: Boolean(recoveryLogged) },
  ];

  res.json({
    date: date.toISOString().slice(0, 10),
    logged: categories.filter((c) => c.logged).map((c) => c.key),
    missing: categories.filter((c) => !c.logged).map((c) => c.key),
  });
});

function inRange(v: unknown, lo: number, hi: number): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
}

function optNumInRange(v: unknown, lo: number, hi: number): number | undefined | false {
  if (v === undefined || v === null || v === "") return undefined;
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

function parseDateStrict(input: unknown, res: Response): Date | null {
  if (input === undefined || input === null || input === "") return dayRange(undefined).start;
  const d = parseDateOrNull(input);
  if (!d) {
    res.status(400).json({ error: "invalid_date" });
    return null;
  }
  return d;
}

/** MongoMemoryServer (standalone, used by most test files) doesn't support transactions; Atlas (deployed) does. */
function isUnsupportedTransactionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /Transaction numbers are only allowed|IllegalOperation/i.test(msg);
}

type LogSessionInput = {
  profileId: Types.ObjectId;
  actorUserId: Types.ObjectId;
  date: Date;
  sessionType: SessionSlot;
  status: (typeof SESSION_STATUS)[number];
  workoutType?: string;
  sets?: number;
  reps?: string;
  actualDurationMin?: number;
  effortScore?: number;
  notes?: string;
  rpe?: number;
  trainingCategory?: string;
  plannedIntensityPercent?: number;
};

type LogSessionResult =
  | { session: unknown; rpeEntry: unknown; mode: "transactional" | "sequential-fallback" }
  | { error: string; status: number };

/**
 * The single orchestration write behind /log-session (plan §5). Replaces what
 * would otherwise be two independent mobile API calls (TrainingSession +
 * RpeMonitoring) with one transactional dual-write, falling back to sequential
 * writes with compensation when the connected MongoDB doesn't support
 * transactions (standalone `MongoMemoryServer` in most test files — Atlas, the
 * deployed environment, is always a replica set and supports them).
 */
async function writeSessionAndRpe(input: LogSessionInput): Promise<LogSessionResult> {
  const { profileId, date, sessionType, status } = input;

  const profile = await AthleteProfile.findById(profileId).select("_id academyId").lean();
  if (!profile) return { error: "athlete_profile_not_found", status: 404 };

  const $set: Record<string, unknown> = { status };
  if (input.workoutType !== undefined) $set.workoutType = input.workoutType;
  if (input.sets !== undefined) $set.sets = input.sets;
  if (input.reps !== undefined) $set.reps = input.reps;
  if (input.actualDurationMin !== undefined) $set.actualDurationMin = input.actualDurationMin;
  // effortScore/rpe are never cross-populated (correction #3) — effortRating
  // is written only when effortScore was explicitly provided.
  if (input.effortScore !== undefined) $set.effortRating = input.effortScore;
  if (input.notes !== undefined) $set.notes = input.notes;
  if (status === "completed") $set.attended = true;

  const wantsRpe = input.rpe !== undefined;
  const assignments = wantsRpe
    ? await CoachAthleteAssignment.find({ athleteId: profileId, endedAt: null }).select("coachId").lean()
    : [];
  const coachId = assignments.length === 1 ? (assignments[0].coachId as Types.ObjectId) : null;

  let rpePayload: Record<string, unknown> | null = null;
  if (wantsRpe) {
    // Real-world wellness sub-scores for the day, when the athlete already
    // checked in — never invented; a neutral 3/5 is used only when no
    // check-in exists, so an absent value can't spuriously trigger a risk flag.
    const wellness = await Wellness.findOne({ athleteId: profileId, date }).lean();
    const sleepQuality = wellness?.sleepQuality ?? 3;
    const muscleSoreness = wellness?.soreness ?? 3;
    const fatigue = wellness?.fatigue ?? 3;
    const moodMotivation = wellness?.mood ?? 3;

    const derived = deriveLoadAndRisk({
      plannedIntensityPercent: input.plannedIntensityPercent!,
      rpe: input.rpe!,
      fatigue,
      muscleSoreness,
      sleepQuality,
      moodMotivation,
      restingHeartRate: undefined,
    });

    rpePayload = {
      academyId: profile.academyId ?? null,
      athleteId: profileId,
      coachId,
      date,
      day: dayOfWeek(date),
      sessionType,
      trainingCategory: input.trainingCategory,
      plannedIntensityPercent: input.plannedIntensityPercent,
      rpe: input.rpe,
      sleepQuality,
      muscleSoreness,
      fatigue,
      moodMotivation,
      ...derived,
    };
  }

  const previousSession = await TrainingSession.findOne({ athleteId: profileId, date, slot: sessionType }).lean();

  async function doWrites(mongoSession: mongoose.ClientSession | null) {
    const opts = mongoSession
      ? { upsert: true, runValidators: true, session: mongoSession }
      : { upsert: true, runValidators: true };
    await TrainingSession.updateOne(
      { athleteId: profileId, date, slot: sessionType },
      { $set, $setOnInsert: { athleteId: profileId, date, slot: sessionType } },
      opts
    );
    if (rpePayload) {
      await RpeMonitoring.updateOne(
        { athleteId: profileId, date, sessionType: sessionType as RpeSessionType },
        { $set: rpePayload },
        opts
      );
    }
  }

  let mode: "transactional" | "sequential-fallback" = "transactional";
  const mongoSession = await mongoose.startSession();
  let transactionUnsupported = false;
  try {
    await mongoSession.withTransaction(() => doWrites(mongoSession));
  } catch (err) {
    if (!isUnsupportedTransactionError(err)) {
      await mongoSession.endSession();
      throw err;
    }
    transactionUnsupported = true;
  }
  await mongoSession.endSession();

  if (transactionUnsupported) {
    mode = "sequential-fallback";
    try {
      await doWrites(null);
    } catch {
      // Compensate: revert TrainingSession to its pre-write state (or remove
      // it if this write would have created it) rather than leave a
      // half-written session with no matching RPE row.
      if (previousSession) {
        await TrainingSession.updateOne(
          { _id: previousSession._id },
          {
            $set: {
              status: previousSession.status,
              workoutType: previousSession.workoutType,
              sets: previousSession.sets,
              reps: previousSession.reps,
              actualDurationMin: previousSession.actualDurationMin,
              effortRating: previousSession.effortRating,
              notes: previousSession.notes,
              attended: previousSession.attended,
            },
          }
        );
        return { error: "partially_saved_reverted", status: 500 };
      }
      await TrainingSession.deleteOne({ athleteId: profileId, date, slot: sessionType });
      return { error: "save_failed_nothing_saved", status: 500 };
    }
  }

  const savedSession = await TrainingSession.findOne({ athleteId: profileId, date, slot: sessionType }).lean();
  const savedRpe = rpePayload
    ? await RpeMonitoring.findOne({ athleteId: profileId, date, sessionType: sessionType as RpeSessionType }).lean()
    : null;

  if (status === "completed") {
    await Attendance.updateOne(
      { athleteId: profileId, date },
      { $set: { athleteId: profileId, date, status: "present", recordedBy: input.actorUserId } },
      { upsert: true, runValidators: true }
    );
  }

  // Surface a flagged readiness reading to every currently-assigned coach —
  // mirrors the manual /rpe-monitoring endpoint's alert behavior exactly.
  if (savedRpe && savedRpe.riskFlag !== "green" && assignments.length > 0) {
    const athleteUser = await User.findById(input.actorUserId).select("name").lean();
    const academyId = (profile.academyId as Types.ObjectId | null | undefined) ?? null;
    const link = `/coach/athletes/${profileId.toString()}`;
    const { title, body: alertBody } = buildReadinessRiskFlag({
      athleteName: (athleteUser?.name as string) || "An athlete",
      riskReasons: (savedRpe.riskReasons as string[]) ?? [],
    });
    await Promise.all(
      assignments.map(async (a) => {
        const coachUserId = a.coachId as Types.ObjectId;
        const timezone = await resolveTimezoneForUser({ userId: coachUserId, role: "coach", academyId });
        await evaluateAndDispatch({
          userId: coachUserId,
          type: "readiness_risk_flag",
          category: "alerts",
          priorityTier: 2,
          dedupKey: `readiness_risk_flag:${(savedRpe._id as Types.ObjectId).toString()}:${coachUserId.toString()}`,
          title,
          body: alertBody,
          link,
          academyId,
          entityRef: { collection: "RpeMonitoring", id: savedRpe._id as Types.ObjectId },
          timezone,
        });
      })
    );
  }

  return { session: savedSession, rpeEntry: savedRpe, mode };
}

/**
 * POST /api/athlete/voice/log-session
 * body: { sessionType, status, workoutType?, actualDurationMin?, sets?, reps?,
 *         notes?, rpe?, effortScore?, trainingCategory?, plannedIntensityPercent?,
 *         date?, clientActionId }
 *
 * The write side of a voice-confirmed log_session action. clientActionId is
 * required and idempotency-guarded (plan §6) since this is the append-adjacent
 * write a retried/duplicated confirm must never double-apply.
 */
router.post(
  "/log-session",
  writeRateLimit({ windowMs: 60_000, max: 60 }),
  async (req: Request, res: Response) => {
    if (!req.actor) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const profileId = selfAthleteId(req);
    if (!profileId) {
      res.status(404).json({ error: "athlete_profile_not_found" });
      return;
    }

    const b = req.body ?? {};
    const clientActionId = typeof b.clientActionId === "string" ? b.clientActionId.trim() : "";
    if (!clientActionId) {
      res.status(400).json({ error: "missing_clientActionId" });
      return;
    }

    const sessionType = b.sessionType as SessionSlot;
    if (!SESSION_SLOTS.includes(sessionType)) {
      res.status(400).json({ error: "invalid_sessionType" });
      return;
    }
    const status = b.status as (typeof SESSION_STATUS)[number];
    if (!SESSION_STATUS.includes(status)) {
      res.status(400).json({ error: "invalid_status" });
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
    const effortScore = optNumInRange(b.effortScore, 1, 10);
    if (effortScore === false) {
      res.status(400).json({ error: "invalid_effortScore" });
      return;
    }
    const notes = optionalStringField(b.notes, 2000);
    if (notes === false) {
      res.status(400).json({ error: "invalid_notes" });
      return;
    }

    const rpeProvided = b.rpe !== undefined && b.rpe !== null && b.rpe !== "";
    if (rpeProvided && !inRange(b.rpe, 0, 10)) {
      res.status(400).json({ error: "invalid_rpe" });
      return;
    }
    if (rpeProvided) {
      if (typeof b.trainingCategory !== "string" || !(TRAINING_CATEGORIES as readonly string[]).includes(b.trainingCategory)) {
        res.status(400).json({ error: "invalid_trainingCategory" });
        return;
      }
      if (!inRange(b.plannedIntensityPercent, 0, 100)) {
        res.status(400).json({ error: "invalid_plannedIntensityPercent" });
        return;
      }
    }

    const date = parseDateStrict(b.date, res);
    if (!date) return;

    const actorUserId = req.actor.userId;
    const outcome = await withIdempotency(actorUserId, clientActionId, "voice/log-session", () =>
      writeSessionAndRpe({
        profileId,
        actorUserId,
        date,
        sessionType,
        status,
        workoutType,
        sets,
        reps,
        actualDurationMin,
        effortScore,
        notes,
        rpe: rpeProvided ? (b.rpe as number) : undefined,
        trainingCategory: rpeProvided ? (b.trainingCategory as string) : undefined,
        plannedIntensityPercent: rpeProvided ? (b.plannedIntensityPercent as number) : undefined,
      })
    );

    if (!outcome.result) {
      res.status(202).json({ pending: true });
      return;
    }
    if ("error" in outcome.result) {
      res.status(outcome.result.status).json({ error: outcome.result.error });
      return;
    }

    await VoicePendingState.deleteOne({ athleteProfileId: profileId });
    res.status(200).json(outcome.result);
  }
);

export default router;
