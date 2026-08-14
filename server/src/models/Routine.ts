import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

export const ROUTINE_GENERATED_BY = ["deterministic", "ai_generated"] as const;
export type RoutineGeneratedBy = (typeof ROUTINE_GENERATED_BY)[number];

/**
 * A thin organizing layer over a date range of future planning — references
 * existing PlannedMeal/WorkoutAssignment rows rather than duplicating their
 * content, so this deliberately stays a small index/pointer document, never
 * a giant mutable JSON blob holding the actual plan data.
 */
const routineSchema = new Schema(
  {
    athleteId: { type: Schema.Types.ObjectId, ref: "AthleteProfile", required: true },
    startDate: { type: Date, required: true },
    durationDays: { type: Number, required: true, min: 1, max: 90 },
    generatedBy: { type: String, enum: ROUTINE_GENERATED_BY, default: "deterministic" },
    plannedMealIds: { type: [Schema.Types.ObjectId], ref: "PlannedMeal", default: [] },
    workoutAssignmentIds: { type: [Schema.Types.ObjectId], ref: "WorkoutAssignment", default: [] },
  },
  { timestamps: true }
);

routineSchema.index({ athleteId: 1, startDate: -1 });

export type RoutineDoc = InferSchemaType<typeof routineSchema> & { _id: Types.ObjectId };
export const Routine: Model<RoutineDoc> = model<RoutineDoc>("Routine", routineSchema);
