import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth";
import { NotificationPreference } from "../models/NotificationPreference";

const router = Router();

router.use(requireAuth);

/**
 * POST /api/presence/heartbeat
 * Marks the caller's app as currently foregrounded — the decision engine skips
 * a push (but still creates the in-app row) for non-transactional categories
 * while this is recent, since the user will see it via the in-app poll instead.
 * Client should throttle calls (e.g. once per 60-120s while foregrounded), not
 * fire on every screen focus — this is a write, not a cheap read.
 */
router.post("/heartbeat", async (req: Request, res: Response) => {
  if (!req.actor) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  await NotificationPreference.updateOne(
    { userId: req.actor.userId },
    { $set: { lastActiveAt: new Date() }, $setOnInsert: { userId: req.actor.userId } },
    { upsert: true }
  );
  res.json({ ok: true });
});

export default router;
