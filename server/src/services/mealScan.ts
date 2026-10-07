import fs from "fs";
import { randomUUID } from "crypto";
import multer from "multer";
import { Types, type HydratedDocument } from "mongoose";
import { env } from "../config/env";
import { MealScan, type MealScanDoc } from "../models/MealScan";
import { MealScanItem, type MealScanItemDoc } from "../models/MealScanItem";
import { Meal } from "../models/Meal";
import { MealFood } from "../models/MealFood";
import type { MealType } from "../models/PlannedMeal";
import { getMealVisionConverter, sanitizeMealVisionItems } from "./mealVisionConverter";
import { suggestMealType } from "./mealClassification";
import { withLocalObjectCopy } from "./objectStorage";

const ALLOWED_SCAN_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const EXT_BY_MIME: Record<(typeof ALLOWED_SCAN_MIME_TYPES)[number], string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

fs.mkdirSync(env.upload.dir, { recursive: true });

export const mealScanUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, env.upload.dir),
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${EXT_BY_MIME[file.mimetype as never] ?? ""}`),
  }),
  limits: { fileSize: env.upload.maxSizeBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_SCAN_MIME_TYPES.includes(file.mimetype as never)) {
      cb(new Error("unsupported_file_type"));
      return;
    }
    cb(null, true);
  },
});


// Below this average confidence, items are real enough to have survived
// sanitization but not trustworthy enough to present as "here's your meal" —
// deliberately below the mock adapter's fixed 0.4 (moderate-confidence,
// exercises the ordinary needs_review path in tests) so that stays unaffected.
const LOW_CONFIDENCE_THRESHOLD = 0.35;

/**
 * Runs the (real-or-mock, per getMealVisionConverter) vision call and
 * persists the sanitized items as MealScanItem rows for the User to review —
 * NEVER creates a Meal here, and never lands on a status that implies
 * trustworthy nutrition data unless a confident food detection actually
 * happened. Resolves to one of MEAL_SCAN_STATUS's terminal states (see that
 * enum's doc comment) — never left stuck in "processing" forever, and a
 * failed/absent/low-confidence detection never reaches the client dressed up
 * as real items.
 */
export async function processScan(scan: HydratedDocument<MealScanDoc>, hourOfDay: number): Promise<HydratedDocument<MealScanDoc>> {
  try {
    const result = await withLocalObjectCopy(scan.storedFilename, (filePath) =>
      getMealVisionConverter().convert({ filePath, mimeType: scan.mimeType, originalName: scan.originalName })
    );

    scan.rawModelOutputRef = result as unknown as MealScanDoc["rawModelOutputRef"];

    // Defense in depth: re-sanitize regardless of which converter produced
    // this (real Gemini, mock, or a test double) — mirrors
    // sanitizeWorkoutTableRows' role for the workout-image pipeline, so a
    // malformed/incomplete item can never reach the database no matter which
    // adapter is active.
    const items = sanitizeMealVisionItems(result.items);

    // Explicit model assessment, not inferred from an empty items array —
    // an empty array alone can't distinguish "no food", "too blurry to
    // tell", or "food present but nothing confident enough to report".
    // Missing/non-boolean values default to true so converters that don't
    // set these fields (the mock, older test doubles) keep falling through
    // to the existing items-and-confidence logic below unaffected.
    const containsFood = result.containsFood !== false;
    const isImageClear = result.isImageClear !== false;

    if (!containsFood) {
      scan.status = "no_food_detected";
      scan.overallConfidence = 0;
      await scan.save();
      return scan;
    }
    if (!isImageClear) {
      scan.status = "low_quality";
      scan.overallConfidence = 0;
      await scan.save();
      return scan;
    }
    if (items.length === 0) {
      // The model claimed food was present and the image was clear, but
      // nothing survived sanitization — functionally the same as "no
      // confident detection" from the User's point of view.
      scan.status = "no_food_detected";
      scan.overallConfidence = 0;
      await scan.save();
      return scan;
    }

    const avgConfidence =
      items.reduce((sum, i) => sum + (i.foodConfidence + i.quantityConfidence) / 2, 0) / items.length;
    const roundedConfidence = Math.round(avgConfidence * 100) / 100;

    if (avgConfidence < LOW_CONFIDENCE_THRESHOLD) {
      // Detected *something*, but not confidently enough to show as if it
      // were real nutrition data — no MealScanItem rows are created, so
      // there's nothing for the client to accidentally present as trustworthy.
      scan.status = "low_confidence";
      scan.overallConfidence = roundedConfidence;
      await scan.save();
      return scan;
    }

    await MealScanItem.insertMany(
      items.map((item) => ({
        scanId: scan._id,
        foodName: item.foodName,
        quantity: item.quantity,
        unit: item.unit,
        calories: item.calories,
        proteinG: item.proteinG,
        carbsG: item.carbsG,
        fatG: item.fatG,
        fiberG: item.fiberG,
        foodConfidence: item.foodConfidence,
        quantityConfidence: item.quantityConfidence,
      }))
    );

    scan.status = "needs_review";
    scan.overallConfidence = roundedConfidence;
    scan.suggestedMealName = result.suggestedMealName ?? null;
    scan.suggestedMealType = suggestMealType(
      items.map((i) => i.foodName),
      hourOfDay
    );
    await scan.save();
  } catch (err) {
    scan.status = "rejected";
    scan.error = (err as Error).message || "vision_call_failed";
    await scan.save();
  }
  return scan;
}

export type ReviewedFoodInput = {
  name: string;
  quantity: number;
  unit: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG?: number;
  confidence?: number;
};

/**
 * The ONLY path that turns scan output into a trusted, consumed Meal —
 * always driven by the User-reviewed (possibly edited) food list, never the
 * raw AI output directly. Copies into fresh MealFood rows rather than
 * referencing MealScanItem, so the Meal never depends on the scan surviving.
 */
export async function confirmScan(
  scan: HydratedDocument<MealScanDoc>,
  athleteId: Types.ObjectId,
  date: Date,
  mealType: MealType,
  foods: ReviewedFoodInput[]
): Promise<{ meal: InstanceType<typeof Meal>; scan: HydratedDocument<MealScanDoc> }> {
  const meal = await Meal.create({
    athleteId,
    date,
    mealType,
    source: "meal_scan",
    loggedAt: new Date(),
  });
  await MealFood.insertMany(
    foods.map((f) => ({
      mealId: meal._id,
      name: f.name,
      quantity: f.quantity,
      unit: f.unit,
      calories: f.calories,
      proteinG: f.proteinG,
      carbsG: f.carbsG,
      fatG: f.fatG,
      fiberG: f.fiberG,
      confidence: f.confidence ?? null,
    }))
  );

  scan.status = "confirmed";
  scan.confirmedMealId = meal._id;
  await scan.save();

  return { meal, scan };
}

export function serializeScan(scan: MealScanDoc, items: MealScanItemDoc[] = []) {
  return {
    id: scan._id.toString(),
    status: scan.status,
    overallConfidence: scan.overallConfidence ?? null,
    suggestedMealName: scan.suggestedMealName ?? null,
    suggestedMealType: scan.suggestedMealType ?? null,
    error: scan.error ?? null,
    confirmedMealId: scan.confirmedMealId ? (scan.confirmedMealId as Types.ObjectId).toString() : null,
    items: items.map((i) => ({
      id: i._id.toString(),
      foodName: i.foodName,
      quantity: i.quantity,
      unit: i.unit,
      calories: i.calories,
      proteinG: i.proteinG,
      carbsG: i.carbsG,
      fatG: i.fatG,
      fiberG: i.fiberG ?? null,
      foodConfidence: i.foodConfidence,
      quantityConfidence: i.quantityConfidence,
    })),
    createdAt: (scan.createdAt as Date).toISOString(),
  };
}
