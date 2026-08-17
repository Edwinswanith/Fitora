import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";
import { plannedFoodSchema, MEAL_TYPES } from "./PlannedMeal";

export const MEAL_PLAN_DURATIONS = [1, 7, 14, 30] as const;
export type MealPlanDuration = (typeof MEAL_PLAN_DURATIONS)[number];

const mealPlanMealSchema = new Schema(
  {
    mealType: { type: String, enum: MEAL_TYPES, required: true },
    name: { type: String, trim: true, maxlength: 160 },
    foods: { type: [plannedFoodSchema], default: [] },
  },
  { _id: false }
);

const mealPlanDaySchema = new Schema(
  {
    dayIndex: { type: Number, required: true, min: 0 },
    meals: { type: [mealPlanMealSchema], default: [] },
  },
  { _id: false }
);

/**
 * A reusable, coach-authored multi-day nutrition plan — the nutrition
 * counterpart to WorkoutTemplate, and deliberately following the exact same
 * pattern: `version` bumps on a meaningful edit, and MealPlanAssignment
 * snapshots `days` + `version` at assign-time, so editing a plan later never
 * mutates an assignment that already exists (same reasoning, same mechanism
 * as the workout system's template/assignment split).
 */
const mealPlanSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, trim: true, maxlength: 2000 },
    durationDays: { type: Number, enum: MEAL_PLAN_DURATIONS, required: true },
    days: { type: [mealPlanDaySchema], default: [] },
    version: { type: Number, default: 1, min: 1 },
    isArchived: { type: Boolean, default: false },
  },
  { timestamps: true }
);

mealPlanSchema.index({ ownerId: 1, isArchived: 1, updatedAt: -1 });

export type MealPlanDayDoc = InferSchemaType<typeof mealPlanDaySchema>;
export type MealPlanDoc = InferSchemaType<typeof mealPlanSchema> & { _id: Types.ObjectId };
export const MealPlan: Model<MealPlanDoc> = model<MealPlanDoc>("MealPlan", mealPlanSchema);
