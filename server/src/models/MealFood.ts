import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

/**
 * One food line-item within a logged Meal. A real collection (not embedded
 * in Meal) because per-food editing/substitution during the meal-scan review
 * step is cleaner against real documents than embedded-array mutation, and
 * it mirrors how MealScanItem already exists standalone pre-confirmation —
 * confirming a scan is a copy from MealScanItem into MealFood, not a
 * reference, so a Meal never depends on its originating MealScan surviving.
 */
const mealFoodSchema = new Schema(
  {
    mealId: { type: Schema.Types.ObjectId, ref: "Meal", required: true },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, required: true, trim: true, maxlength: 40 },
    calories: { type: Number, required: true, min: 0, max: 5000 },
    proteinG: { type: Number, required: true, min: 0, max: 500 },
    carbsG: { type: Number, required: true, min: 0, max: 800 },
    fatG: { type: Number, required: true, min: 0, max: 400 },
    fiberG: { type: Number, min: 0, max: 200 },
    // Only populated when this row traces back to a MealScan — how sure the
    // vision model was about the food identity/quantity, surfaced to the
    // User during review, never hidden.
    confidence: { type: Number, min: 0, max: 1, default: null },
  },
  { timestamps: true }
);

mealFoodSchema.index({ mealId: 1 });

export type MealFoodDoc = InferSchemaType<typeof mealFoodSchema> & { _id: Types.ObjectId };
export const MealFood: Model<MealFoodDoc> = model<MealFoodDoc>("MealFood", mealFoodSchema);
