import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

export const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export const PLANNED_MEAL_SOURCES = ["deterministic", "ai_generated", "coach_assigned"] as const;
export type PlannedMealSource = (typeof PLANNED_MEAL_SOURCES)[number];

export const plannedFoodSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, required: true, trim: true, maxlength: 40 },
    calories: { type: Number, required: true, min: 0, max: 5000 },
    proteinG: { type: Number, required: true, min: 0, max: 500 },
    carbsG: { type: Number, required: true, min: 0, max: 800 },
    fatG: { type: Number, required: true, min: 0, max: 400 },
    fiberG: { type: Number, min: 0, max: 200 },
    // Optional — set by a coach authoring a MealPlan food, or carried over
    // from the deterministic library. Free-text coach food entries have no
    // reliable automatic allergen signal, so this is only ever populated
    // when a human (coach) explicitly tags it — see
    // services/mealPlanAssignment.ts for how this gates assignment.
    allergenTags: { type: [String], default: [] },
  },
  { _id: false }
);

/**
 * A PLANNED meal — strictly never counted toward actual daily intake. A
 * planned meal existing has zero effect on consumed calories/macros; only a
 * logged Meal (see Meal.ts) does. Upserted per (athleteId, date, mealType) —
 * regenerating a day's plan replaces that slot's plan rather than
 * accumulating duplicates.
 */
const plannedMealSchema = new Schema(
  {
    athleteId: { type: Schema.Types.ObjectId, ref: "AthleteProfile", required: true },
    date: { type: Date, required: true },
    mealType: { type: String, enum: MEAL_TYPES, required: true },
    source: { type: String, enum: PLANNED_MEAL_SOURCES, default: "deterministic" },
    name: { type: String, trim: true, maxlength: 160 },
    foods: { type: [plannedFoodSchema], default: [] },
    routineId: { type: Schema.Types.ObjectId, ref: "Routine", default: null },
    mealPlanAssignmentId: { type: Schema.Types.ObjectId, ref: "MealPlanAssignment", default: null },
  },
  { timestamps: true }
);

plannedMealSchema.index({ athleteId: 1, date: 1, mealType: 1 }, { unique: true });

export type PlannedMealDoc = InferSchemaType<typeof plannedMealSchema> & {
  _id: Types.ObjectId;
};
export const PlannedMeal: Model<PlannedMealDoc> = model<PlannedMealDoc>(
  "PlannedMeal",
  plannedMealSchema
);
