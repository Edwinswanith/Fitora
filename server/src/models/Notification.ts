import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

/**
 * Per-user in-app notification. Always scoped to a single recipient
 * (`recipientUserId`) — a user only ever reads/mutates their own rows, which
 * keeps authorization trivial (no cross-athlete scope needed). `link` is an
 * in-app deep path (e.g. `/coach/athletes/<id>`) the row navigates to on tap.
 */
export const NOTIFICATION_PRIORITIES = ["high", "medium", "low"] as const;
export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number];

const notificationSchema = new Schema(
  {
    recipientUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    /** Machine type, e.g. "coach_feedback", "readiness_flag", "checkin_reminder". */
    type: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    body: { type: String, trim: true, default: "" },
    priority: { type: String, enum: NOTIFICATION_PRIORITIES, default: "medium" },
    /** In-app destination path; null = not navigable. */
    link: { type: String, default: null },
    /** Set when the recipient has read it; null = unread. */
    readAt: { type: Date, default: null },
    academyId: { type: Schema.Types.ObjectId, ref: "Academy", default: null },
  },
  { timestamps: true }
);

// Newest-first listing per user, and a fast unread count.
notificationSchema.index({ recipientUserId: 1, createdAt: -1 });
notificationSchema.index({ recipientUserId: 1, readAt: 1 });

export type NotificationDoc = InferSchemaType<typeof notificationSchema> & {
  _id: Types.ObjectId;
};
export const Notification: Model<NotificationDoc> = model<NotificationDoc>(
  "Notification",
  notificationSchema
);
