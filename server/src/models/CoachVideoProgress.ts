import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

export const COACH_VIDEO_PROGRESS_STATUSES = ["not_started", "viewed", "completed"] as const;
export type CoachVideoProgressStatus = (typeof COACH_VIDEO_PROGRESS_STATUSES)[number];

/**
 * One athlete's watch progress on one CoachVideo — keyed by athleteId (ref
 * AthleteProfile, matching every other athlete-scoped collection's naming
 * convention in this codebase), not userId. Write path is checkpointed:
 * the client throttles progress POSTs (on pause / every N seconds / on
 * app-background), never per-second — see routes/athleteCoachVideos.ts.
 * Unique index is the upsert target.
 */
const coachVideoProgressSchema = new Schema(
  {
    videoId: { type: Schema.Types.ObjectId, ref: "CoachVideo", required: true },
    athleteId: { type: Schema.Types.ObjectId, ref: "AthleteProfile", required: true },
    status: { type: String, enum: COACH_VIDEO_PROGRESS_STATUSES, default: "not_started" },
    progressPercent: { type: Number, min: 0, max: 100, default: 0 },
    lastPositionSec: { type: Number, min: 0, default: 0 },
  },
  { timestamps: true }
);

coachVideoProgressSchema.index({ videoId: 1, athleteId: 1 }, { unique: true });
coachVideoProgressSchema.index({ athleteId: 1, updatedAt: -1 });

export type CoachVideoProgressDoc = InferSchemaType<typeof coachVideoProgressSchema> & {
  _id: Types.ObjectId;
};
export const CoachVideoProgress: Model<CoachVideoProgressDoc> = model<CoachVideoProgressDoc>(
  "CoachVideoProgress",
  coachVideoProgressSchema
);
