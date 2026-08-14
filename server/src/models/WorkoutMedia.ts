import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

/** What the uploaded image is of — free-form categorisation, not a workflow state. */
export const MEDIA_CONTEXTS = ["athlete", "workout", "training_plan"] as const;
export type MediaContext = (typeof MEDIA_CONTEXTS)[number];

/** Whitelisted upload mime types — never trust the client-supplied filename/extension. */
export const ALLOWED_MEDIA_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export type AllowedMediaMimeType = (typeof ALLOWED_MEDIA_MIME_TYPES)[number];

export const MEDIA_CONVERSION_STATUS = ["none", "pending", "completed", "failed"] as const;
export type MediaConversionStatus = (typeof MEDIA_CONVERSION_STATUS)[number];

const workoutTableRowSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    sets: { type: String, trim: true, maxlength: 40 },
    reps: { type: String, trim: true, maxlength: 40 },
    distance: { type: String, trim: true, maxlength: 40 },
    duration: { type: String, trim: true, maxlength: 40 },
    intensity: { type: String, trim: true, maxlength: 40 },
    notes: { type: String, trim: true, maxlength: 500 },
  },
  { _id: false }
);

/**
 * One coach-uploaded image, scoped to exactly one assigned athlete (never a
 * shared library — the coach-scope invariant holds by construction since every
 * row is bound to a specific athleteId). Raw bytes live on local disk under
 * env.upload.dir, named by `storedFilename` (a generated id, NOT the client's
 * original filename); `originalName` is metadata only, never used for storage
 * paths. The file becomes visible to the athlete only once `sentAt` is set —
 * uploading and sending are distinct actions.
 */
const workoutMediaSchema = new Schema(
  {
    coachId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    athleteId: { type: Schema.Types.ObjectId, ref: "AthleteProfile", required: true },
    academyId: { type: Schema.Types.ObjectId, ref: "Academy", default: null },
    context: { type: String, enum: MEDIA_CONTEXTS, required: true },

    originalName: { type: String, required: true, trim: true, maxlength: 255 },
    storedFilename: { type: String, required: true, unique: true },
    mimeType: { type: String, enum: ALLOWED_MEDIA_MIME_TYPES, required: true },
    sizeBytes: { type: Number, required: true, min: 1 },

    /** Set when the coach sends the raw image to the athlete; null = coach-only draft. */
    sentAt: { type: Date, default: null },

    conversion: {
      status: { type: String, enum: MEDIA_CONVERSION_STATUS, default: "none" },
      table: { type: [workoutTableRowSchema], default: [] },
      convertedAt: { type: Date, default: null },
      error: { type: String, default: null },
    },
  },
  { timestamps: true }
);

// Coach's per-athlete media list, newest first.
workoutMediaSchema.index({ coachId: 1, athleteId: 1, createdAt: -1 });
// Athlete's received (sent-only) media list, newest first.
workoutMediaSchema.index({ athleteId: 1, sentAt: -1, createdAt: -1 });

export type WorkoutMediaDoc = InferSchemaType<typeof workoutMediaSchema> & {
  _id: Types.ObjectId;
};
export const WorkoutMedia: Model<WorkoutMediaDoc> = model<WorkoutMediaDoc>(
  "WorkoutMedia",
  workoutMediaSchema
);
