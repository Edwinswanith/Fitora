import { Router, type Request, type Response } from "express";
import { Types } from "mongoose";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/role";
import { writeRateLimit } from "../middleware/rateLimit";
import { loadScope } from "../middleware/coachAthleteAccess";
import { CoachSession, COACH_SESSION_TYPES } from "../models/CoachSession";
import { CoachAthleteAssignment } from "../models/CoachAthleteAssignment";
import { User } from "../models/User";
import { resolveAvailableSlots } from "../services/coachAvailability";
import { requestSession, cancelSession, issueJoinToken, serializeSession, CoachSessionError, parseDateTimeOrNull } from "../services/coachSession";
import { parseDateOrNull } from "../lib/trainingCategories";
import { dayRange } from "../services/dashboard";

const router = Router();
router.use(requireAuth, requireRole("athlete"), loadScope);

function selfAthleteId(req: Request): Types.ObjectId | null {
  return req.actor?.athleteProfileId ?? null;
}

async function requireActiveRelationshipWith(coachId: string, athleteId: Types.ObjectId) {
  if (!Types.ObjectId.isValid(coachId)) return null;
  return CoachAthleteAssignment.findOne({ coachId, athleteId, status: "active" }).lean();
}

/** GET /coaches/:coachId/available-slots?date= — requires an active relationship with that coach. */
router.get("/coaches/:coachId/available-slots", async (req: Request, res: Response) => {
  const athleteId = selfAthleteId(req);
  if (!athleteId) return void res.status(404).json({ error: "athlete_profile_not_found" });

  const relationship = await requireActiveRelationshipWith(req.params.coachId, athleteId);
  if (!relationship) return void res.status(403).json({ error: "not_your_coach" });

  const date = parseDateOrNull(req.query.date);
  if (!date) return void res.status(400).json({ error: "invalid_date" });

  const slots = await resolveAvailableSlots(new Types.ObjectId(req.params.coachId), dayRange(date).start);
  res.json({ slots: slots.map((s) => ({ start: s.start, end: s.end })) });
});

/** POST /coaches/:coachId/sessions — body: { type, scheduledStart }. The concurrency-guarded booking create. */
router.post("/coaches/:coachId/sessions", writeRateLimit({ windowMs: 60_000, max: 20 }), async (req: Request, res: Response) => {
  const athleteId = selfAthleteId(req);
  if (!athleteId) return void res.status(404).json({ error: "athlete_profile_not_found" });

  const relationship = await requireActiveRelationshipWith(req.params.coachId, athleteId);
  if (!relationship) return void res.status(403).json({ error: "not_your_coach" });

  const type = req.body?.type;
  if (!COACH_SESSION_TYPES.includes(type)) return void res.status(400).json({ error: "invalid_type" });
  const scheduledStart = parseDateTimeOrNull(req.body?.scheduledStart);
  if (!scheduledStart) return void res.status(400).json({ error: "invalid_scheduledStart" });

  try {
    const { session, quota } = await requestSession({
      coachId: new Types.ObjectId(req.params.coachId),
      athleteId,
      relationshipId: relationship._id,
      type,
      scheduledStart,
      requestedBy: req.actor!.userId,
    });
    res.status(201).json({ session: serializeSession(session, "athlete"), quota });
  } catch (err) {
    if (err instanceof CoachSessionError) return void res.status(err.status).json({ error: err.message });
    throw err;
  }
});

/** GET /sessions?status= — this athlete's own bookings, across all coaches (past + present). */
router.get("/sessions", async (req: Request, res: Response) => {
  const athleteId = selfAthleteId(req);
  if (!athleteId) return void res.status(404).json({ error: "athlete_profile_not_found" });

  const filter: Record<string, unknown> = { athleteId };
  if (typeof req.query.status === "string") filter.status = req.query.status;
  const sessions = await CoachSession.find(filter).sort({ scheduledStart: -1 }).limit(200);
  res.json({ sessions: sessions.map((s) => serializeSession(s, "athlete")) });
});

router.post("/sessions/:sessionId/cancel", writeRateLimit({ windowMs: 60_000, max: 40 }), async (req: Request, res: Response) => {
  const athleteId = selfAthleteId(req);
  if (!athleteId) return void res.status(404).json({ error: "athlete_profile_not_found" });

  const id = req.params.sessionId;
  if (!Types.ObjectId.isValid(id)) return void res.status(400).json({ error: "invalid_session_id" });
  const session = await CoachSession.findOne({ _id: id, athleteId });
  if (!session) return void res.status(404).json({ error: "session_not_found" });

  const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 500) : undefined;
  try {
    const updated = await cancelSession(session, req.actor!.userId, note);
    res.json({ session: serializeSession(updated, "athlete") });
  } catch (err) {
    if (err instanceof CoachSessionError) return void res.status(err.status).json({ error: err.message });
    throw err;
  }
});

/** POST /sessions/:id/join-token — issues a live-video token, only within the join window on a confirmed session. */
router.post("/sessions/:sessionId/join-token", writeRateLimit({ windowMs: 60_000, max: 20 }), async (req: Request, res: Response) => {
  const athleteId = selfAthleteId(req);
  if (!athleteId) return void res.status(404).json({ error: "athlete_profile_not_found" });

  const id = req.params.sessionId;
  if (!Types.ObjectId.isValid(id)) return void res.status(400).json({ error: "invalid_session_id" });
  const session = await CoachSession.findOne({ _id: id, athleteId });
  if (!session) return void res.status(404).json({ error: "session_not_found" });

  const athlete = await User.findById(req.actor!.userId).select("name").lean();
  try {
    const issued = await issueJoinToken(session, "athlete", req.actor!.userId, athlete?.name ?? "Athlete");
    res.json({ video: issued });
  } catch (err) {
    if (err instanceof CoachSessionError) return void res.status(err.status).json({ error: err.message });
    throw err;
  }
});

export default router;
