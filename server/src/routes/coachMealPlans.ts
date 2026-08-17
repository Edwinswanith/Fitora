import { Router, type Request, type Response } from "express";
import { Types, type HydratedDocument } from "mongoose";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/role";
import { writeRateLimit } from "../middleware/rateLimit";
import { loadScope, requireAthleteAccess } from "../middleware/coachAthleteAccess";
import { MealPlan, MEAL_PLAN_DURATIONS, type MealPlanDoc } from "../models/MealPlan";
import { MealPlanAssignment } from "../models/MealPlanAssignment";
import { MEAL_TYPES, type MealType } from "../models/PlannedMeal";
import { parseDateOrNull } from "../lib/trainingCategories";
import {
  assignMealPlanToAthlete,
  cancelMealPlanAssignment,
  validatePlanForAthlete,
  serializeMealPlanAssignment,
  MealPlanAssignmentError,
} from "../services/mealPlanAssignment";
import { checkFeatureEntitlement } from "../services/subscription";

const router = Router();
router.use(requireAuth, requireRole("coach"), loadScope);

function reqStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

type FoodInput = { name: string; quantity: number; unit: string; calories: number; proteinG: number; carbsG: number; fatG: number; fiberG?: number; allergenTags?: string[] };

function validateFoods(raw: unknown): { ok: true; foods: FoodInput[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "foods_required" };
  if (raw.length > 30) return { ok: false, error: "too_many_foods" };
  const foods: FoodInput[] = [];
  for (const item of raw) {
    const r = item as Record<string, unknown>;
    const name = reqStr(r.name);
    const unit = reqStr(r.unit);
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
    const allergenTags = Array.isArray(r.allergenTags) ? r.allergenTags.filter((t): t is string => typeof t === "string") : [];
    foods.push({ name, quantity, unit, calories, proteinG, carbsG, fatG, allergenTags });
  }
  return { ok: true, foods };
}

function validateDays(raw: unknown, durationDays: number): { ok: true; days: unknown[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "days_required" };
  if (raw.length > durationDays) return { ok: false, error: "too_many_days" };
  const days: unknown[] = [];
  for (const item of raw) {
    const d = item as Record<string, unknown>;
    const dayIndex = Number(d.dayIndex);
    if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex >= durationDays) {
      return { ok: false, error: "invalid_dayIndex" };
    }
    const rawMeals = Array.isArray(d.meals) ? d.meals : [];
    if (rawMeals.length === 0 || rawMeals.length > 8) return { ok: false, error: "invalid_meals" };
    const meals: unknown[] = [];
    for (const m of rawMeals) {
      const mr = m as Record<string, unknown>;
      const mealType = mr.mealType as MealType;
      if (!MEAL_TYPES.includes(mealType)) return { ok: false, error: "invalid_mealType" };
      const validated = validateFoods(mr.foods);
      if (!validated.ok) return validated;
      meals.push({ mealType, name: reqStr(mr.name) || undefined, foods: validated.foods });
    }
    days.push({ dayIndex, meals });
  }
  return { ok: true, days };
}

function serializePlan(p: MealPlanDoc | HydratedDocument<MealPlanDoc>) {
  return {
    id: p._id.toString(),
    ownerId: (p.ownerId as Types.ObjectId).toString(),
    name: p.name,
    description: p.description ?? null,
    durationDays: p.durationDays,
    version: p.version,
    isArchived: p.isArchived,
    days: p.days,
    createdAt: (p.createdAt as Date).toISOString(),
    updatedAt: (p.updatedAt as Date).toISOString(),
  };
}

// ---------- MealPlan CRUD ----------

router.get("/meal-plans", async (req: Request, res: Response) => {
  if (!req.actor) return void res.status(401).json({ error: "unauthenticated" });
  const includeArchived = req.query.includeArchived === "1";
  const filter: Record<string, unknown> = { ownerId: req.actor.userId };
  if (!includeArchived) filter.isArchived = false;
  const plans = await MealPlan.find(filter).sort({ updatedAt: -1 }).lean();
  res.json({ mealPlans: plans.map((p) => serializePlan(p as never)) });
});

router.post("/meal-plans", writeRateLimit({ windowMs: 60_000, max: 30 }), async (req: Request, res: Response) => {
  if (!req.actor) return void res.status(401).json({ error: "unauthenticated" });
  const name = reqStr(req.body?.name);
  if (!name || name.length > 160) return void res.status(400).json({ error: "invalid_name" });
  const durationDays = Number(req.body?.durationDays);
  if (!MEAL_PLAN_DURATIONS.includes(durationDays as never)) return void res.status(400).json({ error: "invalid_durationDays" });
  const description = reqStr(req.body?.description);
  if (description.length > 2000) return void res.status(400).json({ error: "invalid_description" });

  const validated = validateDays(req.body?.days, durationDays);
  if (!validated.ok) return void res.status(400).json({ error: validated.error });

  const plan = await MealPlan.create({
    ownerId: req.actor.userId,
    name,
    description: description || undefined,
    durationDays,
    days: validated.days,
    version: 1,
  });
  res.status(201).json({ mealPlan: serializePlan(plan) });
});

async function loadOwnPlan(req: Request, res: Response): Promise<HydratedDocument<MealPlanDoc> | null> {
  if (!req.actor) {
    res.status(401).json({ error: "unauthenticated" });
    return null;
  }
  const id = req.params.mealPlanId;
  if (!Types.ObjectId.isValid(id)) {
    res.status(400).json({ error: "invalid_meal_plan_id" });
    return null;
  }
  const plan = await MealPlan.findById(id);
  if (!plan) {
    res.status(404).json({ error: "meal_plan_not_found" });
    return null;
  }
  if (!plan.ownerId.equals(req.actor.userId)) {
    res.status(403).json({ error: "not_meal_plan_owner" });
    return null;
  }
  return plan;
}

router.get("/meal-plans/:mealPlanId", async (req: Request, res: Response) => {
  const plan = await loadOwnPlan(req, res);
  if (!plan) return;
  res.json({ mealPlan: serializePlan(plan) });
});

/**
 * PATCH /meal-plans/:id — body: any of { name, description, days }. Editing
 * `days` bumps `version` — the field MealPlanAssignment snapshots, so future
 * assignments pick up the edit while existing ones stay frozen. `days` is a
 * whole-array replace (same convention as workout-templates' PATCH); "copy
 * day"/"repeat meal" are client-side array operations on top of this, not
 * separate endpoints.
 */
router.patch("/meal-plans/:mealPlanId", writeRateLimit({ windowMs: 60_000, max: 40 }), async (req: Request, res: Response) => {
  const plan = await loadOwnPlan(req, res);
  if (!plan) return;

  if (req.body?.name !== undefined) {
    const name = reqStr(req.body.name);
    if (!name || name.length > 160) return void res.status(400).json({ error: "invalid_name" });
    plan.name = name;
  }
  if (req.body?.description !== undefined) {
    const description = reqStr(req.body.description);
    if (description.length > 2000) return void res.status(400).json({ error: "invalid_description" });
    plan.description = description || undefined;
  }
  let daysChanged = false;
  if (req.body?.days !== undefined) {
    const validated = validateDays(req.body.days, plan.durationDays);
    if (!validated.ok) return void res.status(400).json({ error: validated.error });
    plan.days = validated.days as unknown as typeof plan.days;
    daysChanged = true;
  }
  if (daysChanged) plan.version = (plan.version ?? 1) + 1;

  await plan.save();
  res.json({ mealPlan: serializePlan(plan) });
});

router.post("/meal-plans/:mealPlanId/archive", writeRateLimit({ windowMs: 60_000, max: 40 }), async (req: Request, res: Response) => {
  const plan = await loadOwnPlan(req, res);
  if (!plan) return;
  plan.isArchived = true;
  await plan.save();
  res.json({ mealPlan: serializePlan(plan) });
});

router.post("/meal-plans/:mealPlanId/unarchive", writeRateLimit({ windowMs: 60_000, max: 40 }), async (req: Request, res: Response) => {
  const plan = await loadOwnPlan(req, res);
  if (!plan) return;
  plan.isArchived = false;
  await plan.save();
  res.json({ mealPlan: serializePlan(plan) });
});

// ---------- Assignment ----------

/**
 * POST /athletes/:athleteId/meal-plan-assignments — body: { mealPlanId,
 * startDate }. Validates against the athlete's profile/target first (see
 * services/mealPlanAssignment.ts): a tagged allergen match is a hard 422
 * block; everything else surfaces as non-blocking `warnings`.
 */
router.post(
  "/athletes/:athleteId/meal-plan-assignments",
  writeRateLimit({ windowMs: 60_000, max: 30 }),
  requireAthleteAccess("athleteId"),
  async (req: Request, res: Response) => {
    if (!req.actor) return void res.status(401).json({ error: "unauthenticated" });

    const entitlement = await checkFeatureEntitlement(
      new Types.ObjectId(req.params.athleteId),
      req.actor.userId,
      "nutritionIncluded"
    );
    if (!entitlement.allowed) return void res.status(403).json({ error: entitlement.reason });

    const mealPlanId = reqStr(req.body?.mealPlanId);
    if (!Types.ObjectId.isValid(mealPlanId)) return void res.status(400).json({ error: "invalid_meal_plan_id" });
    const plan = await MealPlan.findById(mealPlanId);
    if (!plan || !plan.ownerId.equals(req.actor.userId)) {
      return void res.status(404).json({ error: "meal_plan_not_found" });
    }
    const startDate = parseDateOrNull(req.body?.startDate);
    if (!startDate) return void res.status(400).json({ error: "invalid_startDate" });

    const athleteId = new Types.ObjectId(req.params.athleteId);
    const validation = await validatePlanForAthlete(plan, athleteId);
    if (validation.blocked) {
      res.status(422).json({ error: validation.error, violatingFoods: validation.violatingFoods });
      return;
    }

    try {
      const assignment = await assignMealPlanToAthlete({ plan, assignedTo: athleteId, assignedBy: req.actor.userId, startDate });
      res.status(201).json({ assignment: serializeMealPlanAssignment(assignment), warnings: validation.warnings });
    } catch (err) {
      if (err instanceof MealPlanAssignmentError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  }
);

router.get(
  "/athletes/:athleteId/meal-plan-assignments",
  requireAthleteAccess("athleteId"),
  async (req: Request, res: Response) => {
    if (!req.actor) return void res.status(401).json({ error: "unauthenticated" });
    // requireAthleteAccess only confirms the athlete is CURRENTLY assigned to
    // this coach — it says nothing about who created a given assignment. Scope
    // by assignedBy too, or a coach who inherited an athlete from a prior
    // relationship sees every previous coach's meal plans for that athlete.
    const rows = await MealPlanAssignment.find({ assignedTo: req.params.athleteId, assignedBy: req.actor.userId }).sort({ createdAt: -1 }).lean();
    res.json({ assignments: rows.map((r) => serializeMealPlanAssignment(r as never)) });
  }
);

router.post(
  "/meal-plan-assignments/:assignmentId/cancel",
  writeRateLimit({ windowMs: 60_000, max: 30 }),
  async (req: Request, res: Response) => {
    if (!req.actor) return void res.status(401).json({ error: "unauthenticated" });
    const id = req.params.assignmentId;
    if (!Types.ObjectId.isValid(id)) return void res.status(400).json({ error: "invalid_assignment_id" });
    const assignment = await MealPlanAssignment.findById(id);
    if (!assignment || !assignment.assignedBy.equals(req.actor.userId)) {
      return void res.status(404).json({ error: "assignment_not_found" });
    }
    const updated = await cancelMealPlanAssignment(assignment);
    res.json({ assignment: serializeMealPlanAssignment(updated) });
  }
);

export default router;
