import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";
import { env } from "../config/env";

/**
 * Server-authoritative in-progress voice workflow for one athlete — the V2
 * pipeline's conversation state. At most one live document per athlete
 * (unique on athleteProfileId); the client may still send a `pendingIntentHint`
 * as a fallback (e.g. a different device, or this record already expired),
 * but this document wins whenever present.
 *
 * TTL-bounded (env.voiceAssistant.pendingStateTtlSeconds, default 900s/15min):
 * pending state that goes stale is simply gone, never lingering past its
 * purpose. Also explicitly deleted the moment a turn resolves to execute,
 * cancel, or completion — see voiceIntentPolicy.ts's `action` values.
 *
 * `lastTranscript` is the ONLY raw transcript text ever persisted anywhere in
 * this app, and only to support the "did I hear you right?" low-confidence
 * re-confirmation prompt. It is overwritten every turn (never accumulated
 * into a history) and is deleted along with the rest of this document on
 * completion/cancellation/expiry. No audio is ever stored — this collection,
 * like every other part of the voice pipeline, only ever sees text.
 */
const voicePendingStateSchema = new Schema(
  {
    athleteProfileId: { type: Schema.Types.ObjectId, ref: "AthleteProfile", required: true, unique: true },
    intent: { type: String, required: true },
    entities: { type: Schema.Types.Mixed, default: {} },
    missingFields: { type: [String], default: [] },
    lastTranscript: { type: String, default: null },
  },
  { timestamps: true }
);

voicePendingStateSchema.index(
  { updatedAt: 1 },
  { expireAfterSeconds: env.voiceAssistant.pendingStateTtlSeconds }
);

export type VoicePendingStateDoc = InferSchemaType<typeof voicePendingStateSchema> & {
  _id: Types.ObjectId;
};

export const VoicePendingState: Model<VoicePendingStateDoc> =
  model<VoicePendingStateDoc>("VoicePendingState", voicePendingStateSchema);
