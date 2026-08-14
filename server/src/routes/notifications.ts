import { Router, type Request, type Response } from "express";
import { Types } from "mongoose";
import { requireAuth } from "../middleware/auth";
import { Notification } from "../models/Notification";
import { listNotifications } from "../services/notifications";

const router = Router();

// Every route here is scoped to the authenticated user's own notifications.
router.use(requireAuth);

function actorId(req: Request): Types.ObjectId {
  // requireAuth guarantees req.actor is set.
  return req.actor!.userId;
}

/** GET /api/notifications — newest-first list + unread/urgent counts. */
router.get("/", async (req: Request, res: Response) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
  const result = await listNotifications(actorId(req), limit);
  res.json(result);
});

/** GET /api/notifications/unread-count — lightweight badge poll. */
router.get("/unread-count", async (req: Request, res: Response) => {
  const recipientUserId = actorId(req);
  const [unreadCount, urgent] = await Promise.all([
    Notification.countDocuments({ recipientUserId, readAt: null }),
    Notification.exists({ recipientUserId, readAt: null, priority: "high" }),
  ]);
  res.json({ unreadCount, hasUrgentUnread: Boolean(urgent) });
});

/** POST /api/notifications/:id/read — mark one read (own rows only). */
router.post("/:id/read", async (req: Request, res: Response) => {
  if (!Types.ObjectId.isValid(req.params.id)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  await Notification.updateOne(
    { _id: req.params.id, recipientUserId: actorId(req), readAt: null },
    { $set: { readAt: new Date() } }
  );
  res.json({ ok: true });
});

/** POST /api/notifications/read-all — mark every unread row read. */
router.post("/read-all", async (req: Request, res: Response) => {
  await Notification.updateMany(
    { recipientUserId: actorId(req), readAt: null },
    { $set: { readAt: new Date() } }
  );
  res.json({ ok: true });
});

export default router;
