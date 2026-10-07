import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

export const FITNESS_GOALS = ["lose_weight", "maintain_weight", "gain_weight"] as const;
export type FitnessGoal = (typeof FITNESS_GOALS)[number];

export const GOAL_INTENSITIES = ["mild", "moderate", "aggressive"] as const;
export type GoalIntensity = (typeof GOAL_INTENSITIES)[number];

export const ACTIVITY_LEVELS = ["sedentary", "light", "moderate", "active", "very_active"] as const;
export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number];

export const BIOLOGICAL_SEXES = ["male", "female"] as const;
export type BiologicalSex = (typeof BIOLOGICAL_SEXES)[number];

const athleteProfileSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    academyId: { type: Schema.Types.ObjectId, ref: "Academy", index: true },
    dob: { type: Date },
    sport: { type: String, required: true, index: true },
    position: { type: String },
    heightCm: { type: Number },
    weightKg: { type: Number },
    /** Athlete-set target body weight — optional, self-service, no history/trend implied (see ProgressView). */
    targetWeightKg: { type: Number },
    timezone: { type: String, default: "UTC" },
    /** Daily hydration target in millilitres (progress is measured against this). */
    hydrationGoalMl: { type: Number, default: 3000, min: 500, max: 8000 },

    // Nutrition-target inputs (Phase 3). All optional at the schema level —
    // the deterministic target engine (services/nutritionEngine.ts) enforces
    // "required for calculation" itself rather than forcing every general-
    // fitness field on every profile up front.
    fitnessGoal: { type: String, enum: FITNESS_GOALS, default: null },
    goalIntensity: { type: String, enum: GOAL_INTENSITIES, default: null },
    activityLevel: { type: String, enum: ACTIVITY_LEVELS, default: null },
    biologicalSex: { type: String, enum: BIOLOGICAL_SEXES, default: null },
    dietaryPreferences: { type: [String], default: [] },
    allergies: { type: [String], default: [] },
    cuisinePreferences: { type: [String], default: [] },
  },
  { timestamps: true }
);

export type AthleteProfileDoc = InferSchemaType<typeof athleteProfileSchema> & {
  _id: Types.ObjectId;
};
export const AthleteProfile: Model<AthleteProfileDoc> = model<AthleteProfileDoc>(
  "AthleteProfile",
  athleteProfileSchema
);
