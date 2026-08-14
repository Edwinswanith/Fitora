import fs from "fs";
import path from "path";
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

export function mealScanFilePath(doc: Pick<MealScanDoc, "storedFilename">): string {
  const resolved = path.join(env.upload.dir, doc.storedFilename);
  if (path.dirname(resolved) !== env.upload.dir) throw new Error("invalid_stored_filename");
  return resolved;
}

/**
 * Runs the (real-or-mock, per getMealVisionConverter) vision call and
 * persists the sanitized items as MealScanItem rows for the User to review —
 * NEVER creates a Meal here. status becomes "needs_review" regardless of
 * confidence (even a confident detection still needs a human look before it
 * becomes trusted intake data), or "rejected" with an error message if the
 * model call itself failed — either way the User is never left with a scan
 * silently stuck in "processing" forever.
 */
export async function processScan(scan: HydratedDocument<MealScanDoc>, hourOfDay: number): Promise<HydratedDocument<MealScanDoc>> {
  try {
    const result = await getMealVisionConverter().convert({
      filePath: mealScanFilePath(scan),
      mimeType: scan.mimeType,
      originalName: scan.originalName,
    });

    scan.rawModelOutputRef = result as unknown as MealScanDoc["rawModelOutputRef"];

    // Defense in depth: re-sanitize regardless of which converter produced
    // this (real Gemini, mock, or a test double) — mirrors
    // sanitizeWorkoutTableRows' role for the workout-image pipeline, so a
    // malformed/incomplete item can never reach the database no matter which
    // adapter is active.
    const items = sanitizeMealVisionItems(result.items);

    if (items.length === 0) {
      scan.status = "needs_review";
      scan.overallConfidence = 0;
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

    const avgConfidence =
      items.reduce((sum, i) => sum + (i.foodConfidence + i.quantityConfidence) / 2, 0) / items.length;

    scan.status = "needs_review";
    scan.overallConfidence = Math.round(avgConfidence * 100) / 100;
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
