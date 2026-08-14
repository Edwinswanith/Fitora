import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";
import { env } from "../config/env";

/**
 * Idempotency ledger for voice-triggered writes (plan §6). Every confirmed
 * voice action carries a client-generated `clientActionId`; before performing
 * an append-only write (water, notes, coach messages, the log-session
 * orchestration endpoint), the route atomically inserts here first — a
 * duplicate-key error means the action already ran, so the cached
 * `resultSummary` is returned instead of writing again. This is the
 * server-side backstop for retries/double-taps/app-killed-mid-request that a
 * client-side lock alone can't cover.
 *
 * Upsert-keyed writes (wellness/rpe-monitoring/recovery/rest-day) are already
 * naturally idempotent via their own (athleteId, date[, slot]) unique
 * indexes — clientActionId is still threaded through there for consistent
 * logging/tracing, but this collection is the primary guard only for the
 * genuinely append-only routes.
 */
const voiceActionReceiptSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    clientActionId: { type: String, required: true, trim: true },
    route: { type: String, required: true, trim: true },
    resultSummary: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

voiceActionReceiptSchema.index({ userId: 1, clientActionId: 1 }, { unique: true });
voiceActionReceiptSchema.index({ createdAt: 1 }, { expireAfterSeconds: env.voiceAssistant.actionReceiptTtlSeconds });

export type VoiceActionReceiptDoc = InferSchemaType<typeof voiceActionReceiptSchema> & {
  _id: Types.ObjectId;
};

export const VoiceActionReceipt: Model<VoiceActionReceiptDoc> =
  model<VoiceActionReceiptDoc>("VoiceActionReceipt", voiceActionReceiptSchema);
