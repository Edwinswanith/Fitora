import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

export const COACH_VIDEO_CATEGORIES = [
  "exercise_tutorial",
  "full_workout",
  "mobility",
  "nutrition",
  "recovery",
  "coaching_tip",
  "recorded_session",
  "program",
] as const;
export type CoachVideoCategory = (typeof COACH_VIDEO_CATEGORIES)[number];

export const COACH_VIDEO_VISIBILITIES = ["private", "selected_clients", "subscribers", "public_preview"] as const;
export type CoachVideoVisibility = (typeof COACH_VIDEO_VISIBILITIES)[number];

export const ALLOWED_COACH_VIDEO_MIME_TYPES = ["video/mp4", "video/webm", "video/quicktime"] as const;
export type AllowedCoachVideoMimeType = (typeof ALLOWED_COACH_VIDEO_MIME_TYPES)[number];

/**
 * A coach's reusable content-library upload — distinct from ExerciseMedia
 * (exercise-attached demo clips referenced by WorkoutExercise) and from
 * WorkoutMedia (per-athlete photographed-plan review-then-send flow): this is
 * standalone educational/program content a coach publishes to their roster
 * at large, gated by `visibility` rather than being attached to any specific
 * assignment. Raw bytes live on local disk under env.upload.dir, same as
 * every other media type in this codebase (no object-storage credentials
 * configured for this project) — see services/coachVideo.ts.
 *
 * `visibility`:
 *   - "private": coach-only (draft/unpublished), never returned to any athlete.
 *   - "selected_clients": visible only to athletes in `selectedClientIds`
 *     who ALSO currently hold an active relationship with this coach.
 *   - "subscribers": visible to any actively-related athlete whose
 *     relationship either has no linked subscription (free/legacy
 *     relationship — unpaywalled, same backward-compatible convention as
 *     Phase 6/7's checkFeatureEntitlement) or an active/payment_due one.
 *   - "public_preview": visible to any authenticated athlete, no
 *     relationship required — marketing/preview content.
 * `selectedClientIds` is only meaningful when visibility is
 * "selected_clients"; ignored otherwise (not cleared, so re-selecting that
 * visibility later doesn't lose the coach's prior picks).
 */
const coachVideoSchema = new Schema(
  {
    coachId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, trim: true, maxlength: 2000 },
    category: { type: String, enum: COACH_VIDEO_CATEGORIES, required: true },
    visibility: { type: String, enum: COACH_VIDEO_VISIBILITIES, default: "private" },
    selectedClientIds: { type: [Schema.Types.ObjectId], ref: "AthleteProfile", default: [] },
    originalName: { type: String, required: true, trim: true, maxlength: 255 },
    storedFilename: { type: String, required: true, unique: true },
    mimeType: { type: String, enum: ALLOWED_COACH_VIDEO_MIME_TYPES, required: true },
    sizeBytes: { type: Number, required: true, min: 1 },
    durationSec: { type: Number, min: 0, default: null },
    isArchived: { type: Boolean, default: false },
  },
  { timestamps: true }
);

coachVideoSchema.index({ coachId: 1, isArchived: 1, createdAt: -1 });
coachVideoSchema.index({ coachId: 1, visibility: 1 });

export type CoachVideoDoc = InferSchemaType<typeof coachVideoSchema> & {
  _id: Types.ObjectId;
};
export const CoachVideo: Model<CoachVideoDoc> = model<CoachVideoDoc>("CoachVideo", coachVideoSchema);
