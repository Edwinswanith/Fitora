import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";
import { workoutExerciseSchema, WORKOUT_TEMPLATE_OWNER_ROLES } from "./WorkoutTemplate";
import { SESSION_SLOTS } from "./TrainingSession";

export const WORKOUT_ASSIGNMENT_STATUS = [
  "scheduled",
  "in_progress",
  "completed",
  "skipped",
] as const;
export type WorkoutAssignmentStatus = (typeof WORKOUT_ASSIGNMENT_STATUS)[number];

/**
 * One scheduling instance of a WorkoutTemplate for one User on one date —
 * "what this User is supposed to perform," distinct from the template
 * ("what is designed") and from TrainingSession ("what actually happened").
 *
 * exercisesSnapshot + templateVersionSnapshot are copied from the template
 * at CREATE time and never touched again by template edits — this is the
 * mechanism that keeps an in-progress/completed assignment immutable when a
 * coach later edits the source template (Bench Press 4x10 stays 4x10 on this
 * assignment even after the coach edits the template to 5x8).
 *
 * `slot` is optional: when set, this assignment is tied to the existing
 * AM/AFT/PM TrainingSession system (via trainingSessionId, populated on
 * start) for continuity with the daily card, RPE, and attendance — a
 * standalone/manual workout (e.g. "Morning Mobility") can leave it unset and
 * is tracked purely through this assignment + ExerciseProgress.
 */
const workoutAssignmentSchema = new Schema(
  {
    templateId: { type: Schema.Types.ObjectId, ref: "WorkoutTemplate", required: true },
    templateVersionSnapshot: { type: Number, required: true },
    nameSnapshot: { type: String, required: true, trim: true, maxlength: 160 },
    exercisesSnapshot: { type: [workoutExerciseSchema], default: [] },

    assignedTo: { type: Schema.Types.ObjectId, ref: "AthleteProfile", required: true },
    assignedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    assignedByRole: { type: String, enum: WORKOUT_TEMPLATE_OWNER_ROLES, required: true },

    scheduledDate: { type: Date, required: true },
    slot: { type: String, enum: SESSION_SLOTS, default: null },

    status: { type: String, enum: WORKOUT_ASSIGNMENT_STATUS, default: "scheduled" },
    trainingSessionId: { type: Schema.Types.ObjectId, ref: "TrainingSession", default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// "Today's workout" / date-range listing for a User.
workoutAssignmentSchema.index({ assignedTo: 1, scheduledDate: -1 });
// A coach's own assignment history (who did I assign what to).
workoutAssignmentSchema.index({ assignedBy: 1, createdAt: -1 });
// At most one slot-linked assignment per User/date/slot — a manual/standalone
// (slot: null) assignment is exempt, so multiple unslotted workouts can
// coexist on the same day (e.g. a strength template plus a mobility
// checklist), matching TrainingSession's own one-row-per-slot invariant for
// the slotted case.
workoutAssignmentSchema.index(
  { assignedTo: 1, scheduledDate: 1, slot: 1 },
  { unique: true, partialFilterExpression: { slot: { $type: "string" } } }
);

export type WorkoutAssignmentDoc = InferSchemaType<typeof workoutAssignmentSchema> & {
  _id: Types.ObjectId;
};
export const WorkoutAssignment: Model<WorkoutAssignmentDoc> = model<WorkoutAssignmentDoc>(
  "WorkoutAssignment",
  workoutAssignmentSchema
);
