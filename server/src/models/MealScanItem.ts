import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

/**
 * One AI-detected food item within a MealScan, pre-review. Every numeric
 * field is validated/range-checked the same way a human-entered MealFood
 * would be (see services/mealScan.ts sanitization) — the model's structured-
 * output schema constrains the SHAPE, but never the trustworthiness of the
 * VALUES, so this document still goes through the same range checks
 * regardless of what the AI nominally promised.
 */
const mealScanItemSchema = new Schema(
  {
    scanId: { type: Schema.Types.ObjectId, ref: "MealScan", required: true },
    foodName: { type: String, required: true, trim: true, maxlength: 160 },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, required: true, trim: true, maxlength: 40 },
    calories: { type: Number, required: true, min: 0, max: 5000 },
    proteinG: { type: Number, required: true, min: 0, max: 500 },
    carbsG: { type: Number, required: true, min: 0, max: 800 },
    fatG: { type: Number, required: true, min: 0, max: 400 },
    fiberG: { type: Number, min: 0, max: 200 },
    foodConfidence: { type: Number, required: true, min: 0, max: 1 },
    quantityConfidence: { type: Number, required: true, min: 0, max: 1 },
  },
  { timestamps: true }
);

mealScanItemSchema.index({ scanId: 1 });

export type MealScanItemDoc = InferSchemaType<typeof mealScanItemSchema> & { _id: Types.ObjectId };
export const MealScanItem: Model<MealScanItemDoc> = model<MealScanItemDoc>(
  "MealScanItem",
  mealScanItemSchema
);
