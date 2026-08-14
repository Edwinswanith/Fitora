import { Router, type Request, type Response } from "express";
import { Types } from "mongoose";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/role";
import { loadScope } from "../middleware/coachAthleteAccess";
import { writeRateLimit } from "../middleware/rateLimit";
import { AthleteProfile } from "../models/AthleteProfile";
import { PlannedMeal, MEAL_TYPES, type MealType } from "../models/PlannedMeal";
import { Meal, MEAL_SOURCES } from "../models/Meal";
import { MealFood } from "../models/MealFood";
import { MealScan } from "../models/MealScan";
import { MealScanItem } from "../models/MealScanItem";
import { Routine } from "../models/Routine";
import { parseDateOrNull } from "../lib/trainingCategories";
import { dayRange } from "../services/dashboard";
import {
  recalculateNutritionTarget,
  getCurrentTarget,
  resolveTargetForDate,
  serializeTarget,
  NutritionTargetError,
} from "../services/nutritionTarget";
import { macrosReconcileToCalories } from "../services/nutritionEngine";
import { mealScanUpload, mealScanFilePath, processScan, confirmScan, serializeScan, type ReviewedFoodInput } from "../services/mealScan";
import { generateDeterministicRoutine } from "../services/routineGenerator";
import { resolveTimezoneForUser } from "../services/timezone";
import { minuteOfDayInZone } from "../services/timezone";

const router = Router();
router.use(requireAuth, requireRole("athlete"), loadScope);

function selfAthleteId(req: Request): Types.ObjectId | null {
  return req.actor?.athleteProfileId ?? null;
}

// ---------- Nutrition Target ----------

/** GET /nutrition/target?date= — current target, or whichever was active on `date`. */
router.get("/target", async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId) return void res.status(404).json({ error: "athlete_profile_not_found" });

  if (req.query.date) {
    const date = parseDateOrNull(req.query.date);
    if (!date) return void res.status(400).json({ error: "invalid_date" });
    const target = await resolveTargetForDate(profileId, date);
    res.json({ target: target ? serializeTarget(target) : null });
    return;
  }

  const target = await getCurrentTarget(profileId);
  res.json({ target: target ? serializeTarget(target) : null });
});

/**
 * POST /nutrition/target/recalculate — deterministic only (services/
 * nutritionEngine.ts). Requires weight/height/dob/biologicalSex/
 * activityLevel/fitnessGoal/goalIntensity already set via PATCH /athlete/me.
 */
router.post("/target/recalculate", writeRateLimit({ windowMs: 60_000, max: 10 }), async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId) return void res.status(404).json({ error: "athlete_profile_not_found" });
  try {
    const target = await recalculateNutritionTarget(profileId);
    res.status(201).json({ target: serializeTarget(target) });
  } catch (err) {
    if (err instanceof NutritionTargetError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
});

// ---------- Planned Meals ----------

function serializePlannedMeal(pm: {
  _id: Types.ObjectId;
  date: Date;
  mealType: string;
  source: string;
  name?: string | null;
  foods: unknown[];
}) {
  return {
    id: pm._id.toString(),
    date: pm.date.toISOString().slice(0, 10),
    mealType: pm.mealType,
    source: pm.source,
    name: pm.name ?? null,
    foods: pm.foods,
  };
}

/** GET /nutrition/planned-meals?date= — never affects consumed totals. */
router.get("/planned-meals", async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId) return void res.status(404).json({ error: "athlete_profile_not_found" });
  const date = parseDateOrNull(req.query.date) ?? new Date();
  const { start, end } = dayRange(date);
  const rows = await PlannedMeal.find({ athleteId: profileId, date: { $gte: start, $lt: end } })
    .sort({ mealType: 1 })
    .lean();
  res.json({ plannedMeals: rows.map((r) => serializePlannedMeal(r as never)) });
});

// ---------- Meals (consumed — authoritative intake) ----------

function serializeMeal(meal: { _id: Types.ObjectId; date: Date; mealType: string; source: string; name?: string | null; loggedAt: Date; plannedMealId?: Types.ObjectId | null }, foods: Array<Record<string, unknown>>) {
  return {
    id: meal._id.toString(),
    date: meal.date.toISOString().slice(0, 10),
    mealType: meal.mealType,
    source: meal.source,
    name: meal.name ?? null,
    plannedMealId: meal.plannedMealId ? meal.plannedMealId.toString() : null,
    loggedAt: meal.loggedAt.toISOString(),
    foods: foods.map((f) => ({
      id: (f._id as Types.ObjectId).toString(),
      name: f.name,
      quantity: f.quantity,
      unit: f.unit,
      calories: f.calories,
      proteinG: f.proteinG,
      carbsG: f.carbsG,
      fatG: f.fatG,
      fiberG: f.fiberG ?? null,
      confidence: f.confidence ?? null,
    })),
  };
}

function validateFoodsInput(raw: unknown): { ok: true; foods: ReviewedFoodInput[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "foods_required" };
  if (raw.length > 30) return { ok: false, error: "too_many_foods" };
  const foods: ReviewedFoodInput[] = [];
  for (const item of raw) {
    const r = item as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name.trim() : "";
    const unit = typeof r.unit === "string" ? r.unit.trim() : "";
    const quantity = Number(r.quantity);
    const calories = Number(r.calories);
    const proteinG = Number(r.proteinG);
    const carbsG = Number(r.carbsG);
    const fatG = Number(r.fatG);
    if (!name || name.length > 160) return { ok: false, error: "invalid_food_name" };
    if (!unit || unit.length > 40) return { ok: false, error: "invalid_unit" };
    if (!Number.isFinite(quantity) || quantity < 0) return { ok: false, error: "invalid_quantity" };
    if (!Number.isFinite(calories) || calories < 0 || calories > 5000) return { ok: false, error: "invalid_calories" };
    if (!Number.isFinite(proteinG) || proteinG < 0 || proteinG > 500) return { ok: false, error: "invalid_proteinG" };
    if (!Number.isFinite(carbsG) || carbsG < 0 || carbsG > 800) return { ok: false, error: "invalid_carbsG" };
    if (!Number.isFinite(fatG) || fatG < 0 || fatG > 400) return { ok: false, error: "invalid_fatG" };
    const fiberG = r.fiberG !== undefined ? Number(r.fiberG) : undefined;
    if (fiberG !== undefined && (!Number.isFinite(fiberG) || fiberG < 0 || fiberG > 200)) {
      return { ok: false, error: "invalid_fiberG" };
    }
    foods.push({ name, quantity, unit, calories, proteinG, carbsG, fatG, fiberG });
  }
  return { ok: true, foods };
}

/** GET /nutrition/meals?date= */
router.get("/meals", async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId) return void res.status(404).json({ error: "athlete_profile_not_found" });
  const date = parseDateOrNull(req.query.date) ?? new Date();
  const { start, end } = dayRange(date);
  const meals = await Meal.find({ athleteId: profileId, date: { $gte: start, $lt: end } })
    .sort({ loggedAt: 1 })
    .lean();
  const foods = await MealFood.find({ mealId: { $in: meals.map((m) => m._id) } }).lean();
  const foodsByMeal = new Map<string, typeof foods>();
  for (const f of foods) {
    const key = (f.mealId as Types.ObjectId).toString();
    foodsByMeal.set(key, [...(foodsByMeal.get(key) ?? []), f]);
  }
  const totals = foods.reduce(
    (acc, f) => ({
      calories: acc.calories + f.calories,
      proteinG: acc.proteinG + f.proteinG,
      carbsG: acc.carbsG + f.carbsG,
      fatG: acc.fatG + f.fatG,
    }),
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 }
  );
  res.json({
    meals: meals.map((m) => serializeMeal(m as never, foodsByMeal.get(m._id.toString()) ?? [])),
    totals,
  });
});

/**
 * POST /nutrition/meals — logs a CONSUMED meal. body: { date?, mealType,
 * source ("ad_hoc" | "confirmed_from_plan" | "modified_from_plan"),
 * plannedMealId?, name?, foods: [...] }. This is the ONLY thing that affects
 * a day's actual consumed totals — creating a PlannedMeal never does.
 */
router.post("/meals", writeRateLimit({ windowMs: 60_000, max: 60 }), async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId) return void res.status(404).json({ error: "athlete_profile_not_found" });

  const date = req.body?.date ? parseDateOrNull(req.body.date) : new Date();
  if (!date) return void res.status(400).json({ error: "invalid_date" });
  const mealType = req.body?.mealType as MealType;
  if (!MEAL_TYPES.includes(mealType)) return void res.status(400).json({ error: "invalid_mealType" });
  const source = req.body?.source ?? "ad_hoc";
  if (!MEAL_SOURCES.includes(source) || source === "meal_scan") {
    // meal_scan source is only ever set by the confirm-scan flow, never directly.
    return void res.status(400).json({ error: "invalid_source" });
  }
  let plannedMealId: Types.ObjectId | null = null;
  if (req.body?.plannedMealId) {
    if (!Types.ObjectId.isValid(req.body.plannedMealId)) return void res.status(400).json({ error: "invalid_plannedMealId" });
    const planned = await PlannedMeal.findOne({ _id: req.body.plannedMealId, athleteId: profileId }).lean();
    if (!planned) return void res.status(404).json({ error: "planned_meal_not_found" });
    plannedMealId = planned._id;
  }

  const validated = validateFoodsInput(req.body?.foods);
  if (!validated.ok) return void res.status(400).json({ error: validated.error });

  const meal = await Meal.create({
    athleteId: profileId,
    date: dayRange(date).start,
    mealType,
    source,
    plannedMealId,
    name: typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 160) : undefined,
  });
  await MealFood.insertMany(validated.foods.map((f) => ({ mealId: meal._id, ...f })));
  const foods = await MealFood.find({ mealId: meal._id }).lean();
  res.status(201).json({ meal: serializeMeal(meal.toObject(), foods) });
});

async function loadOwnMeal(req: Request, res: Response) {
  const profileId = selfAthleteId(req);
  if (!profileId) {
    res.status(404).json({ error: "athlete_profile_not_found" });
    return null;
  }
  const id = req.params.mealId;
  if (!Types.ObjectId.isValid(id)) {
    res.status(400).json({ error: "invalid_meal_id" });
    return null;
  }
  const meal = await Meal.findOne({ _id: id, athleteId: profileId });
  if (!meal) {
    res.status(404).json({ error: "meal_not_found" });
    return null;
  }
  return meal;
}

/** PATCH /nutrition/meals/:mealId — body: { name?, foods? } */
router.patch("/meals/:mealId", writeRateLimit({ windowMs: 60_000, max: 60 }), async (req: Request, res: Response) => {
  const meal = await loadOwnMeal(req, res);
  if (!meal) return;
  if (req.body?.name !== undefined) {
    meal.name = typeof req.body.name === "string" ? req.body.name.trim().slice(0, 160) : undefined;
    await meal.save();
  }
  if (req.body?.foods !== undefined) {
    const validated = validateFoodsInput(req.body.foods);
    if (!validated.ok) return void res.status(400).json({ error: validated.error });
    await MealFood.deleteMany({ mealId: meal._id });
    await MealFood.insertMany(validated.foods.map((f) => ({ mealId: meal._id, ...f })));
    if (meal.source === "confirmed_from_plan") {
      meal.source = "modified_from_plan";
      await meal.save();
    }
  }
  const foods = await MealFood.find({ mealId: meal._id }).lean();
  res.json({ meal: serializeMeal(meal.toObject(), foods) });
});

/** DELETE /nutrition/meals/:mealId */
router.delete("/meals/:mealId", writeRateLimit({ windowMs: 60_000, max: 60 }), async (req: Request, res: Response) => {
  const meal = await loadOwnMeal(req, res);
  if (!meal) return;
  await MealFood.deleteMany({ mealId: meal._id });
  await meal.deleteOne();
  res.json({ ok: true });
});

// ---------- Meal Scan ----------

/** POST /nutrition/meal-scan — multipart upload, field "file". */
router.post(
  "/meal-scan",
  writeRateLimit({ windowMs: 60_000, max: 20 }),
  (req: Request, res: Response, next) => {
    mealScanUpload.single("file")(req, res, (err: unknown) => {
      if (!err) return next();
      res.status(400).json({ error: "unsupported_file_type" });
    });
  },
  async (req: Request, res: Response) => {
    const profileId = selfAthleteId(req);
    if (!profileId || !req.actor) return void res.status(404).json({ error: "athlete_profile_not_found" });
    if (!req.file) return void res.status(400).json({ error: "file_required" });

    const scan = await MealScan.create({
      athleteId: profileId,
      storedFilename: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      status: "processing",
    });

    const timezone = await resolveTimezoneForUser({ userId: req.actor.userId, role: "athlete" });
    const hourOfDay = Math.floor(minuteOfDayInZone(new Date(), timezone) / 60);
    const processed = await processScan(scan, hourOfDay);
    const items = await MealScanItem.find({ scanId: processed._id }).lean();
    res.status(201).json({ scan: serializeScan(processed.toObject(), items as never) });
  }
);

/** GET /nutrition/meal-scan/:scanId — poll for status + review items. */
router.get("/meal-scan/:scanId", async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId) return void res.status(404).json({ error: "athlete_profile_not_found" });
  const id = req.params.scanId;
  if (!Types.ObjectId.isValid(id)) return void res.status(400).json({ error: "invalid_scan_id" });
  const scan = await MealScan.findOne({ _id: id, athleteId: profileId }).lean();
  if (!scan) return void res.status(404).json({ error: "scan_not_found" });
  const items = await MealScanItem.find({ scanId: scan._id }).lean();
  res.json({ scan: serializeScan(scan as never, items as never) });
});

/**
 * POST /nutrition/meal-scan/:scanId/confirm — body: { date?, mealType,
 * foods: [...] }. The ONLY way a scan becomes a Meal — always driven by the
 * (possibly-edited) reviewed food list the User submits here, never the raw
 * AI output directly.
 */
router.post(
  "/meal-scan/:scanId/confirm",
  writeRateLimit({ windowMs: 60_000, max: 40 }),
  async (req: Request, res: Response) => {
    const profileId = selfAthleteId(req);
    if (!profileId) return void res.status(404).json({ error: "athlete_profile_not_found" });
    const id = req.params.scanId;
    if (!Types.ObjectId.isValid(id)) return void res.status(400).json({ error: "invalid_scan_id" });
    const scan = await MealScan.findOne({ _id: id, athleteId: profileId });
    if (!scan) return void res.status(404).json({ error: "scan_not_found" });
    if (scan.status === "confirmed") return void res.status(409).json({ error: "already_confirmed" });
    if (scan.status === "processing") return void res.status(409).json({ error: "scan_still_processing" });

    const mealType = req.body?.mealType as MealType;
    if (!MEAL_TYPES.includes(mealType)) return void res.status(400).json({ error: "invalid_mealType" });
    const date = req.body?.date ? parseDateOrNull(req.body.date) : new Date();
    if (!date) return void res.status(400).json({ error: "invalid_date" });

    const validated = validateFoodsInput(req.body?.foods);
    if (!validated.ok) return void res.status(400).json({ error: validated.error });

    const { meal } = await confirmScan(scan, profileId, dayRange(date).start, mealType, validated.foods);
    const foods = await MealFood.find({ mealId: meal._id }).lean();
    res.status(201).json({ meal: serializeMeal(meal.toObject(), foods), scan: serializeScan(scan.toObject()) });
  }
);

// ---------- Routine ----------

/** GET /nutrition/routine?startDate=&days= — most recent covering the range. */
router.get("/routine", async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId) return void res.status(404).json({ error: "athlete_profile_not_found" });
  const routine = await Routine.findOne({ athleteId: profileId }).sort({ createdAt: -1 }).lean();
  if (!routine) return void res.json({ routine: null });
  res.json({
    routine: {
      id: routine._id.toString(),
      startDate: (routine.startDate as Date).toISOString().slice(0, 10),
      durationDays: routine.durationDays,
      generatedBy: routine.generatedBy,
      plannedMealIds: (routine.plannedMealIds as Types.ObjectId[]).map((id) => id.toString()),
      workoutAssignmentIds: (routine.workoutAssignmentIds as Types.ObjectId[]).map((id) => id.toString()),
    },
  });
});

/**
 * POST /nutrition/routine/generate — body: { startDate?, durationDays }
 * (7|14|30). Deterministic — no AI call, never blocks. Requires a current
 * NutritionTarget to exist first (POST /target/recalculate).
 */
router.post("/routine/generate", writeRateLimit({ windowMs: 60_000, max: 10 }), async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId) return void res.status(404).json({ error: "athlete_profile_not_found" });

  const durationDays = Number(req.body?.durationDays);
  if (![7, 14, 30].includes(durationDays)) return void res.status(400).json({ error: "invalid_durationDays" });
  const startDate = req.body?.startDate ? parseDateOrNull(req.body.startDate) : new Date();
  if (!startDate) return void res.status(400).json({ error: "invalid_startDate" });

  const [target, profile] = await Promise.all([
    getCurrentTarget(profileId),
    AthleteProfile.findById(profileId).lean(),
  ]);
  if (!target) return void res.status(422).json({ error: "no_active_nutrition_target" });
  if (!profile) return void res.status(404).json({ error: "athlete_profile_not_found" });

  const routine = await generateDeterministicRoutine({
    athleteId: profileId,
    startDate: dayRange(startDate).start,
    durationDays,
    target,
    dietaryPreferences: (profile.dietaryPreferences as string[] | undefined) ?? [],
    allergies: (profile.allergies as string[] | undefined) ?? [],
    cuisinePreferences: (profile.cuisinePreferences as string[] | undefined) ?? [],
  });

  res.status(201).json({
    routine: {
      id: routine._id.toString(),
      startDate: (routine.startDate as Date).toISOString().slice(0, 10),
      durationDays: routine.durationDays,
      generatedBy: routine.generatedBy,
      plannedMealIds: routine.plannedMealIds.map((id) => id.toString()),
      workoutAssignmentIds: routine.workoutAssignmentIds.map((id) => id.toString()),
    },
  });
});

export { macrosReconcileToCalories };
export default router;
