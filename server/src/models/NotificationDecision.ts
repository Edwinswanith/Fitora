import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";
import { NOTIFICATION_CATEGORY_KEYS } from "./NotificationPreference";

export const NOTIFICATION_DECISION_STATUSES = ["sent", "suppressed"] as const;
export type NotificationDecisionStatus = (typeof NOTIFICATION_DECISION_STATUSES)[number];

/**
 * The dedup/audit ledger for push notifications — one row per (type, recipient,
 * occurrence), keyed by a unique `dedupKey` that is the actual mutex preventing a
 * double-send across concurrent/paged sweep runs (see services/notificationEligibility.ts).
 *
 * Deliberately merges what the original spec called `notification_log` into this
 * one collection: `{userId,sentTime:-1}` and `{userId,category,sentTime:-1}` cover
 * every "recent history for a user [by category]" query a separate log table would
 * exist for, without a second physical collection that must always agree with this one.
 *
 * Only PERMANENT outcomes (sent, or permanently suppressed — already-completed,
 * category-disabled, disabled) ever get a row. Transient rejections (quiet hours,
 * daily cap, min-interval, presence, no active token) write nothing, so the same
 * dedupKey remains fully eligible on the next sweep tick.
 */
const notificationDecisionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    category: { type: String, enum: NOTIFICATION_CATEGORY_KEYS, required: true },
    type: { type: String, required: true, trim: true },
    priorityTier: { type: Number, required: true },
    dedupKey: { type: String, required: true },
    status: { type: String, enum: NOTIFICATION_DECISION_STATUSES, required: true },
    suppressReason: { type: String, default: null },
    deliveryResult: {
      attempted: { type: Boolean, default: false },
      providerMessageIds: { type: [String], default: [] },
      errors: { type: [String], default: [] },
    },
    sentTime: { type: Date, required: true },
    link: { type: String, default: null },
    entityRef: {
      collection: { type: String, default: null },
      id: { type: Schema.Types.ObjectId, default: null },
    },
    academyId: { type: Schema.Types.ObjectId, ref: "Academy", default: null },
  },
  { timestamps: true }
);

notificationDecisionSchema.index({ dedupKey: 1 }, { unique: true });
notificationDecisionSchema.index({ userId: 1, sentTime: -1 });
notificationDecisionSchema.index({ userId: 1, category: 1, sentTime: -1 });

export type NotificationDecisionDoc = InferSchemaType<
  typeof notificationDecisionSchema
> & { _id: Types.ObjectId };

export const NotificationDecision: Model<NotificationDecisionDoc> =
  model<NotificationDecisionDoc>("NotificationDecision", notificationDecisionSchema);
