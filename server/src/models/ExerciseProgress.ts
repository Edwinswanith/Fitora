import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

export const EXERCISE_PROGRESS_STATUS = [
  "not_started",
  "in_progress",
  "completed",
  "skipped",
] as const;
export type ExerciseProgressStatus = (typeof EXERCISE_PROGRESS_STATUS)[number];

const setCompletionSchema = new Schema(
  {
    setNumber: { type: Number, required: true, min: 1 },
    reps: { type: Number, min: 0 },
    weightKg: { type: Number, min: 0 },
    durationSec: { type: Number, min: 0 },
    completedAt: { type: Date, default: () => new Date() },
  },
  { _id: false }
);

/**
 * Per-exercise, per-set execution against one WorkoutAssignment.
 * `exerciseIndex` is the exercise's position within that assignment's
 * exercisesSnapshot array (the snapshot is immutable, so an index is a
 * stable reference for the assignment's lifetime — no separate id needed on
 * the embedded exercise subdocument).
 */
const exerciseProgressSchema = new Schema(
  {
    assignmentId: { type: Schema.Types.ObjectId, ref: "WorkoutAssignment", required: true },
    exerciseIndex: { type: Number, required: true, min: 0 },
    status: { type: String, enum: EXERCISE_PROGRESS_STATUS, default: "not_started" },
    setsCompleted: { type: [setCompletionSchema], default: [] },
    notes: { type: String, trim: true, maxlength: 500 },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

exerciseProgressSchema.index({ assignmentId: 1, exerciseIndex: 1 }, { unique: true });

export type ExerciseProgressDoc = InferSchemaType<typeof exerciseProgressSchema> & {
  _id: Types.ObjectId;
};
export const ExerciseProgress: Model<ExerciseProgressDoc> = model<ExerciseProgressDoc>(
  "ExerciseProgress",
  exerciseProgressSchema
);
