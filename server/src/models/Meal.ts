import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";
import { MEAL_TYPES } from "./PlannedMeal";

export const MEAL_SOURCES = ["confirmed_from_plan", "modified_from_plan", "ad_hoc", "meal_scan"] as const;
export type MealSource = (typeof MEAL_SOURCES)[number];

/**
 * A CONSUMED/logged meal — the sole authoritative record of actual intake.
 * Deliberately a separate collection from PlannedMeal (never a
 * `PlannedMeal.isConsumed` flag): a User may skip the plan, change the
 * quantity, eat something else entirely, or log without ever having planned
 * anything, and none of that should ever require mutating the plan record.
 * `plannedMealId` is set only when this meal traces back to a plan
 * (confirmed or modified from it) — null for ad-hoc/scanned meals.
 */
const mealSchema = new Schema(
  {
    athleteId: { type: Schema.Types.ObjectId, ref: "AthleteProfile", required: true },
    date: { type: Date, required: true },
    mealType: { type: String, enum: MEAL_TYPES, required: true },
    source: { type: String, enum: MEAL_SOURCES, required: true },
    plannedMealId: { type: Schema.Types.ObjectId, ref: "PlannedMeal", default: null },
    name: { type: String, trim: true, maxlength: 160 },
    loggedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

// A day's logged meals, newest first — NOT unique (a User can log several
// snacks, or even two "lunch"-typed entries the same day; mealType here is
// just a label on the log, not a slot key like it is on PlannedMeal).
mealSchema.index({ athleteId: 1, date: 1, loggedAt: -1 });

export type MealDoc = InferSchemaType<typeof mealSchema> & { _id: Types.ObjectId };
export const Meal: Model<MealDoc> = model<MealDoc>("Meal", mealSchema);
