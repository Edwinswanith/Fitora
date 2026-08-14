import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

// Deliberately distinct from WorkoutMedia's ALLOWED_MEDIA_MIME_TYPES (images
// only, sized/shaped for a coach's photographed-plan review-then-send flow).
// Exercise demonstration media is reusable across many athletes/assignments
// and may be a short video, so it gets its own, smaller whitelist.
export const ALLOWED_EXERCISE_MEDIA_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
] as const;
export type AllowedExerciseMediaMimeType = (typeof ALLOWED_EXERCISE_MEDIA_MIME_TYPES)[number];

export const EXERCISE_MEDIA_KINDS = ["image", "video"] as const;
export type ExerciseMediaKind = (typeof EXERCISE_MEDIA_KINDS)[number];

/**
 * Coach-owned, reusable exercise demonstration media (image or short video),
 * referenced by WorkoutExercise.mediaId across as many templates/assignments
 * as the coach likes. Unlike WorkoutMedia there is no athleteId (this isn't
 * scoped to one athlete) and no sentAt review gate (visibility is governed by
 * whether the requester can see an assignment/template referencing it, not by
 * an explicit send action) — a genuinely different responsibility from
 * WorkoutMedia's per-athlete photographed-plan flow, so it gets its own model
 * rather than overloading that one. Raw bytes live on local disk under
 * env.upload.dir exactly like WorkoutMedia (no object-storage credentials are
 * configured for this project yet); storedFilename is always server-
 * generated, never the client's original filename.
 */
const exerciseMediaSchema = new Schema(
  {
    coachId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    originalName: { type: String, required: true, trim: true, maxlength: 255 },
    storedFilename: { type: String, required: true, unique: true },
    mimeType: { type: String, enum: ALLOWED_EXERCISE_MEDIA_MIME_TYPES, required: true },
    kind: { type: String, enum: EXERCISE_MEDIA_KINDS, required: true },
    sizeBytes: { type: Number, required: true, min: 1 },
    durationSec: { type: Number, min: 0, default: null },
  },
  { timestamps: true }
);

exerciseMediaSchema.index({ coachId: 1, createdAt: -1 });

export type ExerciseMediaDoc = InferSchemaType<typeof exerciseMediaSchema> & {
  _id: Types.ObjectId;
};
export const ExerciseMedia: Model<ExerciseMediaDoc> = model<ExerciseMediaDoc>(
  "ExerciseMedia",
  exerciseMediaSchema
);
