import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

// An exercise can be a rep count, a sets x reps scheme, a timed hold/effort,
// or a simple checklist item (e.g. "20 push-ups" with no formal sets/reps
// structure) — one shape covers structured strength work, timed mobility
// work, and manual/checklist workouts alike, so there is exactly one
// exercise model instead of parallel Normal/Video/Manual workout systems.
export const EXERCISE_TYPES = ["reps", "sets_reps", "duration", "checklist"] as const;
export type ExerciseType = (typeof EXERCISE_TYPES)[number];

export const workoutExerciseSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    type: { type: String, enum: EXERCISE_TYPES, required: true },
    sets: { type: Number, min: 0, max: 50 },
    reps: { type: String, trim: true, maxlength: 40 },
    durationSec: { type: Number, min: 0, max: 36000 },
    restSec: { type: Number, min: 0, max: 3600 },
    instructions: { type: String, trim: true, maxlength: 2000 },
    // References ExerciseMedia (coach-owned, reusable demo image/video) — kept
    // deliberately distinct from WorkoutMedia (which is a per-athlete, review-
    // then-send photographed plan) and from the future Coach Video Library
    // (reusable educational content, not exercise-specific).
    mediaId: { type: Schema.Types.ObjectId, ref: "ExerciseMedia", default: null },
    notes: { type: String, trim: true, maxlength: 500 },
    order: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

export const WORKOUT_TEMPLATE_OWNER_ROLES = ["coach", "athlete"] as const;
export type WorkoutTemplateOwnerRole = (typeof WORKOUT_TEMPLATE_OWNER_ROLES)[number];

/**
 * A reusable workout definition — authored by a Coach (assignable to Clients)
 * or self-authored by a User for their own standalone use. `version` is
 * bumped on every meaningful edit (exercise list/name/description changes);
 * WorkoutAssignment copies `exercises` + `version` at assign-time into its
 * own snapshot, so editing a template afterward never mutates an assignment
 * that already exists — see WorkoutAssignment.ts.
 */
const workoutTemplateSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    ownerRole: { type: String, enum: WORKOUT_TEMPLATE_OWNER_ROLES, required: true },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, trim: true, maxlength: 2000 },
    exercises: { type: [workoutExerciseSchema], default: [] },
    version: { type: Number, default: 1, min: 1 },
    isArchived: { type: Boolean, default: false },
  },
  { timestamps: true }
);

workoutTemplateSchema.index({ ownerId: 1, isArchived: 1, updatedAt: -1 });

export type WorkoutExerciseDoc = InferSchemaType<typeof workoutExerciseSchema>;
export type WorkoutTemplateDoc = InferSchemaType<typeof workoutTemplateSchema> & {
  _id: Types.ObjectId;
};
export const WorkoutTemplate: Model<WorkoutTemplateDoc> = model<WorkoutTemplateDoc>(
  "WorkoutTemplate",
  workoutTemplateSchema
);
