import { Types } from "mongoose";
import {
  Notification,
  type NotificationPriority,
} from "../models/Notification";
import { GuardianAthleteLink } from "../models/GuardianAthleteLink";

export type CreateNotificationInput = {
  recipientUserId: Types.ObjectId | string;
  type: string;
  title: string;
  body?: string;
  priority?: NotificationPriority;
  link?: string | null;
  academyId?: Types.ObjectId | string | null;
};

/**
 * Emit one in-app notification. Best-effort: failures are logged, never thrown,
 * so a notification problem can't break the action that triggered it (logging a
 * session, posting feedback, etc.). Other modules call this — it's the single
 * choke point for creating notifications.
 */
export async function createNotification(
  input: CreateNotificationInput
): Promise<void> {
  try {
    await Notification.create({
      recipientUserId: input.recipientUserId,
      type: input.type,
      title: input.title,
      body: input.body ?? "",
      priority: input.priority ?? "medium",
      link: input.link ?? null,
      academyId: input.academyId ?? null,
    });
  } catch (err) {
    console.error("[notifications] failed to create:", (err as Error).message);
  }
}

/**
 * Notify every guardian actively linked to an athlete that a new data point
 * (sleep/wellness check-in, water intake, attendance) was logged — the only
 * three things a guardian's dashboard shows, so this is what tells them to go
 * look. Best-effort, like createNotification: never throws.
 */
export async function notifyGuardiansOfAthleteUpdate(
  athleteId: Types.ObjectId,
  title: string,
  body: string
): Promise<void> {
  try {
    const links = await GuardianAthleteLink.find({ athleteId, endedAt: null })
      .select("guardianId")
      .lean();
    await Promise.all(
      links.map((link) =>
        createNotification({
          recipientUserId: link.guardianId as Types.ObjectId,
          type: "athlete_update",
          title,
          body,
          link: "/guardian/dashboard",
        })
      )
    );
  } catch (err) {
    console.error("[notifications] failed to notify guardians:", (err as Error).message);
  }
}

/** Shape returned to the client for one notification row. */
export type NotificationView = {
  id: string;
  type: string;
  title: string;
  body: string;
  priority: NotificationPriority;
  link: string | null;
  read: boolean;
  createdAt: string;
};

export async function listNotifications(
  recipientUserId: Types.ObjectId,
  limit = 30
): Promise<{ notifications: NotificationView[]; unreadCount: number; hasUrgentUnread: boolean }> {
  const [rows, unreadCount, urgent] = await Promise.all([
    Notification.find({ recipientUserId }).sort({ createdAt: -1 }).limit(limit).lean(),
    Notification.countDocuments({ recipientUserId, readAt: null }),
    Notification.exists({ recipientUserId, readAt: null, priority: "high" }),
  ]);
  return {
    unreadCount,
    hasUrgentUnread: Boolean(urgent),
    notifications: rows.map((n) => ({
      id: n._id.toString(),
      type: n.type,
      title: n.title,
      body: n.body ?? "",
      priority: (n.priority ?? "medium") as NotificationPriority,
      link: n.link ?? null,
      read: n.readAt != null,
      createdAt: (n.createdAt as Date).toISOString(),
    })),
  };
}
