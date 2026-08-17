import { Router, type Request, type Response } from "express";
import { Types } from "mongoose";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/role";
import { writeRateLimit } from "../middleware/rateLimit";
import { loadScope } from "../middleware/coachAthleteAccess";
import { CoachSession } from "../models/CoachSession";
import { confirmSession, rescheduleSession, cancelSession, completeSession, serializeSession, CoachSessionError, parseDateTimeOrNull } from "../services/coachSession";

const router = Router();
router.use(requireAuth, requireRole("coach"), loadScope);

async function loadOwnSession(req: Request, res: Response) {
  const id = req.params.sessionId;
  if (!Types.ObjectId.isValid(id)) {
    res.status(400).json({ error: "invalid_session_id" });
    return null;
  }
  const session = await CoachSession.findById(id);
  if (!session || !session.coachId.equals(req.actor!.userId)) {
    res.status(404).json({ error: "session_not_found" });
    return null;
  }
  return session;
}

/** GET /sessions?status=&athleteId= — this coach's own bookings. */
router.get("/sessions", async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = { coachId: req.actor!.userId };
  if (typeof req.query.status === "string") filter.status = req.query.status;
  if (typeof req.query.athleteId === "string" && Types.ObjectId.isValid(req.query.athleteId)) {
    filter.athleteId = req.query.athleteId;
  }
  const sessions = await CoachSession.find(filter).sort({ scheduledStart: -1 }).limit(200);
  res.json({ sessions: sessions.map((s) => serializeSession(s, "coach")) });
});

router.post("/sessions/:sessionId/confirm", writeRateLimit({ windowMs: 60_000, max: 40 }), async (req: Request, res: Response) => {
  const session = await loadOwnSession(req, res);
  if (!session) return;
  try {
    const updated = await confirmSession(session, req.actor!.userId);
    res.json({ session: serializeSession(updated, "coach") });
  } catch (err) {
    if (err instanceof CoachSessionError) return void res.status(err.status).json({ error: err.message });
    throw err;
  }
});

router.post("/sessions/:sessionId/reschedule", writeRateLimit({ windowMs: 60_000, max: 40 }), async (req: Request, res: Response) => {
  const session = await loadOwnSession(req, res);
  if (!session) return;
  const newStart = parseDateTimeOrNull(req.body?.scheduledStart);
  if (!newStart) return void res.status(400).json({ error: "invalid_scheduledStart" });
  const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 500) : undefined;
  try {
    const updated = await rescheduleSession(session, newStart, req.actor!.userId, note);
    res.json({ session: serializeSession(updated, "coach") });
  } catch (err) {
    if (err instanceof CoachSessionError) return void res.status(err.status).json({ error: err.message });
    throw err;
  }
});

router.post("/sessions/:sessionId/cancel", writeRateLimit({ windowMs: 60_000, max: 40 }), async (req: Request, res: Response) => {
  const session = await loadOwnSession(req, res);
  if (!session) return;
  const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 500) : undefined;
  try {
    const updated = await cancelSession(session, req.actor!.userId, note);
    res.json({ session: serializeSession(updated, "coach") });
  } catch (err) {
    if (err instanceof CoachSessionError) return void res.status(err.status).json({ error: err.message });
    throw err;
  }
});

/** POST /sessions/:id/complete — body: { summary?, coachNotes? }. summary is athlete-visible, coachNotes is coach-private. */
router.post("/sessions/:sessionId/complete", writeRateLimit({ windowMs: 60_000, max: 40 }), async (req: Request, res: Response) => {
  const session = await loadOwnSession(req, res);
  if (!session) return;
  const summary = typeof req.body?.summary === "string" ? req.body.summary.trim().slice(0, 2000) : undefined;
  const coachNotes = typeof req.body?.coachNotes === "string" ? req.body.coachNotes.trim().slice(0, 2000) : undefined;
  try {
    const updated = await completeSession(session, req.actor!.userId, summary, coachNotes);
    res.json({ session: serializeSession(updated, "coach") });
  } catch (err) {
    if (err instanceof CoachSessionError) return void res.status(err.status).json({ error: err.message });
    throw err;
  }
});

export default router;
