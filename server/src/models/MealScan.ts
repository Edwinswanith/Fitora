import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";
import { MEAL_TYPES } from "./PlannedMeal";

export const MEAL_SCAN_STATUS = ["processing", "needs_review", "confirmed", "rejected"] as const;
export type MealScanStatus = (typeof MEAL_SCAN_STATUS)[number];

/**
 * A photo-based meal recognition request. The AI boundary is strict: this
 * document (plus MealScanItem) is where the vision model's output lands —
 * it is NEVER trusted as consumed nutrition on its own. A Meal (authoritative
 * intake) is only ever created via the explicit /confirm step, after the
 * User has reviewed/edited the items — see services/mealScan.ts. `status`
 * starts "processing", moves to "needs_review" once the model responds (even
 * a low-confidence or empty result — never "confirmed" automatically), and
 * only reaches "confirmed" via the User's own action.
 */
const mealScanSchema = new Schema(
  {
    athleteId: { type: Schema.Types.ObjectId, ref: "AthleteProfile", required: true },
    storedFilename: { type: String, required: true, unique: true },
    originalName: { type: String, required: true, trim: true, maxlength: 255 },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true, min: 1 },

    status: { type: String, enum: MEAL_SCAN_STATUS, default: "processing" },
    overallConfidence: { type: Number, min: 0, max: 1, default: null },
    suggestedMealName: { type: String, trim: true, maxlength: 160, default: null },
    suggestedMealType: { type: String, enum: MEAL_TYPES, default: null },
    // Raw model output kept for audit/debugging only — never served back to
    // the client as trusted data; everything user-facing goes through
    // MealScanItem, which has already been schema- and range-validated.
    rawModelOutputRef: { type: Schema.Types.Mixed, default: null },
    error: { type: String, default: null },

    confirmedMealId: { type: Schema.Types.ObjectId, ref: "Meal", default: null },
  },
  { timestamps: true }
);

mealScanSchema.index({ athleteId: 1, createdAt: -1 });

export type MealScanDoc = InferSchemaType<typeof mealScanSchema> & { _id: Types.ObjectId };
export const MealScan: Model<MealScanDoc> = model<MealScanDoc>("MealScan", mealScanSchema);
