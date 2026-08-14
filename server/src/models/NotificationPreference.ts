import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";
import { env } from "../config/env";

export const NOTIFICATION_CATEGORY_KEYS = [
  "reminders",
  "alerts",
  "deadlines",
  "digests",
  "milestones",
  "messages",
] as const;
export type NotificationCategoryKey = (typeof NOTIFICATION_CATEGORY_KEYS)[number];

/**
 * One row per user. Lazy-created via upsert on first read (GET /api/notification-
 * preferences, the sweep's own lookup, or the presence heartbeat) — there is no
 * backfill script; a user who never touches any of those simply has no row, and
 * the sweep never generates a candidate for them without one anyway.
 *
 * `quietHours.{start,end}Minute` are minute-of-day (0–1439) in the user's OWN
 * resolved local time (see services/timezone.ts) — NOT UTC. A wrap-past-midnight
 * window (start > end, e.g. 22:00–07:00) is a valid, expected shape.
 *
 * `lastActiveAt` is the presence-heartbeat target (POST /api/presence/heartbeat).
 * It deliberately defaults to null, not "now" — defaulting to "now" would make a
 * freshly lazy-created row look recently active and wrongly suppress a push that
 * should have gone out.
 */
const notificationPreferenceSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    enabled: { type: Boolean, default: true },
    categories: {
      reminders: { type: Boolean, default: true },
      alerts: { type: Boolean, default: true },
      deadlines: { type: Boolean, default: true },
      digests: { type: Boolean, default: true },
      milestones: { type: Boolean, default: true },
      messages: { type: Boolean, default: true },
    },
    quietHours: {
      enabled: { type: Boolean, default: true },
      startMinute: {
        type: Number,
        min: 0,
        max: 1439,
        default: () => env.notification.quietHoursDefaultStartMinute,
      },
      endMinute: {
        type: Number,
        min: 0,
        max: 1439,
        default: () => env.notification.quietHoursDefaultEndMinute,
      },
    },
    // null = fall back to the global env default at evaluation time.
    dailyCap: { type: Number, default: null },
    minIntervalMinutes: { type: Number, default: null },
    lastActiveAt: { type: Date, default: null },
    consecutiveIgnored: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export type NotificationPreferenceDoc = InferSchemaType<
  typeof notificationPreferenceSchema
> & { _id: Types.ObjectId };

export const NotificationPreference: Model<NotificationPreferenceDoc> =
  model<NotificationPreferenceDoc>(
    "NotificationPreference",
    notificationPreferenceSchema
  );
