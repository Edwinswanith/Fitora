import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth";
import {
  NotificationPreference,
  NOTIFICATION_CATEGORY_KEYS,
  type NotificationPreferenceDoc,
} from "../models/NotificationPreference";

const router = Router();

router.use(requireAuth);

function serialize(pref: NotificationPreferenceDoc) {
  return {
    enabled: pref.enabled,
    categories: pref.categories,
    quietHours: pref.quietHours,
    dailyCap: pref.dailyCap ?? null,
    minIntervalMinutes: pref.minIntervalMinutes ?? null,
  };
}

/** GET /api/notification-preferences — lazy-creates a default row on first access. */
router.get("/", async (req: Request, res: Response) => {
  if (!req.actor) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  const pref = await NotificationPreference.findOneAndUpdate(
    { userId: req.actor.userId },
    { $setOnInsert: { userId: req.actor.userId } },
    { upsert: true, new: true }
  );
  res.json(serialize(pref));
});

function isMinuteOfDay(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) >= 0 && (v as number) < 1440;
}

/**
 * 15-720 minutes: the minimum gap the sweep enforces between any two
 * reminder-category notifications for this user (services/notificationEligibility.ts
 * already reads this field at evaluation time — this is the missing write path).
 * This is a minimum-spacing value, not a fixed-cadence "every N minutes" timer,
 * and it applies to all reminder-type notifications, not a specific one (e.g.
 * hydration) — callers must not describe it as more specific than it is.
 */
function isMinIntervalMinutes(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) >= 15 && (v as number) <= 720;
}

/**
 * PATCH /api/notification-preferences
 * body: { enabled?, categories?: {reminders?,alerts?,...}, quietHours?: {enabled?, startMinute?, endMinute?} }
 * Whitelisted partial update — never a raw client-object merge.
 */
router.patch("/", async (req: Request, res: Response) => {
  if (!req.actor) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  const b = req.body ?? {};
  const $set: Record<string, unknown> = {};

  if (typeof b.enabled === "boolean") $set.enabled = b.enabled;

  if (b.categories && typeof b.categories === "object") {
    for (const key of NOTIFICATION_CATEGORY_KEYS) {
      if (typeof b.categories[key] === "boolean") {
        $set[`categories.${key}`] = b.categories[key];
      }
    }
  }

  if (b.quietHours && typeof b.quietHours === "object") {
    if (typeof b.quietHours.enabled === "boolean") $set["quietHours.enabled"] = b.quietHours.enabled;
    if (isMinuteOfDay(b.quietHours.startMinute)) $set["quietHours.startMinute"] = b.quietHours.startMinute;
    if (isMinuteOfDay(b.quietHours.endMinute)) $set["quietHours.endMinute"] = b.quietHours.endMinute;
  }

  if (Object.prototype.hasOwnProperty.call(b, "minIntervalMinutes")) {
    if (b.minIntervalMinutes === null) {
      $set.minIntervalMinutes = null; // explicit reset to the global default
    } else if (isMinIntervalMinutes(b.minIntervalMinutes)) {
      $set.minIntervalMinutes = b.minIntervalMinutes;
    } else {
      res.status(400).json({ error: "invalid_minIntervalMinutes" });
      return;
    }
  }

  const pref = await NotificationPreference.findOneAndUpdate(
    { userId: req.actor.userId },
    { $set, $setOnInsert: { userId: req.actor.userId } },
    { upsert: true, new: true }
  );
  res.json(serialize(pref));
});

export default router;
