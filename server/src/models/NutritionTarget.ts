import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";
import { FITNESS_GOALS, GOAL_INTENSITIES, ACTIVITY_LEVELS, BIOLOGICAL_SEXES } from "./AthleteProfile";

/**
 * A versioned, deterministically-calculated calorie/macro target — never
 * calculated or overridden by AI (see services/nutritionEngine.ts). Changing
 * a User's goal creates a NEW row and closes the previous one via
 * effectiveTo rather than mutating it in place, so historical analytics
 * always resolve against whatever target was actually active on that date
 * (see services/nutritionTarget.ts resolveTargetForDate). inputSnapshot is a
 * full audit trail of exactly what inputs produced this target;
 * calculationVersion tags which formula/config version was used so a future
 * change to the engine is auditable rather than silently reinterpreting old
 * targets.
 */
const nutritionTargetSchema = new Schema(
  {
    athleteId: { type: Schema.Types.ObjectId, ref: "AthleteProfile", required: true },
    goal: { type: String, enum: FITNESS_GOALS, required: true },
    goalIntensity: { type: String, enum: GOAL_INTENSITIES, required: true },
    calories: { type: Number, required: true, min: 800, max: 6000 },
    proteinG: { type: Number, required: true, min: 0 },
    carbsG: { type: Number, required: true, min: 0 },
    fatG: { type: Number, required: true, min: 0 },
    effectiveFrom: { type: Date, required: true },
    effectiveTo: { type: Date, default: null },
    calculationVersion: { type: String, required: true },
    inputSnapshot: {
      weightKg: { type: Number, required: true },
      heightCm: { type: Number, required: true },
      age: { type: Number, required: true },
      biologicalSex: { type: String, enum: BIOLOGICAL_SEXES, required: true },
      activityLevel: { type: String, enum: ACTIVITY_LEVELS, required: true },
      goal: { type: String, enum: FITNESS_GOALS, required: true },
      goalIntensity: { type: String, enum: GOAL_INTENSITIES, required: true },
    },
  },
  { timestamps: true }
);

// Exactly one CURRENT target per athlete (effectiveTo: null) — same
// enforcement pattern as the one-primary-coach index on CoachAthleteAssignment.
nutritionTargetSchema.index(
  { athleteId: 1 },
  { unique: true, partialFilterExpression: { effectiveTo: null } }
);
nutritionTargetSchema.index({ athleteId: 1, effectiveFrom: -1 });

export type NutritionTargetDoc = InferSchemaType<typeof nutritionTargetSchema> & {
  _id: Types.ObjectId;
};
export const NutritionTarget: Model<NutritionTargetDoc> = model<NutritionTargetDoc>(
  "NutritionTarget",
  nutritionTargetSchema
);
