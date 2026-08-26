import { Types, type HydratedDocument } from "mongoose";
import { MealPlan, type MealPlanDoc } from "../models/MealPlan";
import { MealPlanAssignment, type MealPlanAssignmentDoc } from "../models/MealPlanAssignment";
import { PlannedMeal } from "../models/PlannedMeal";
import { AthleteProfile } from "../models/AthleteProfile";
import { User } from "../models/User";
import { getCurrentTarget } from "./nutritionTarget";
import { dayRange } from "./dashboard";
import { evaluateAndDispatch } from "./notificationEligibility";
import { resolveTimezoneForUser } from "./timezone";
import { categoryForType } from "../lib/notificationTypes";
import { buildMealPlanAssigned, buildMealPlanUpdated } from "./notificationTemplates";

/** Best-effort — never lets a notification failure fail the write that triggered it. */
async function notifyAthleteMealPlanEvent(
  athleteId: Types.ObjectId,
  coachId: Types.ObjectId,
  dedupKey: string,
  type: "meal_plan_assigned" | "meal_plan_updated",
  planName: string,
  entityId: Types.ObjectId,
  entityCollection: string
): Promise<void> {
  try {
    const [profile, coach] = await Promise.all([
      AthleteProfile.findById(athleteId).select("userId").lean(),
      User.findById(coachId).select("name").lean(),
    ]);
    if (!profile?.userId) return;
    const userId = profile.userId as Types.ObjectId;
    const timezone = await resolveTimezoneForUser({ userId, role: "athlete" });
    const coachName = (coach?.name as string) || "your coach";
    const template = type === "meal_plan_assigned" ? buildMealPlanAssigned({ coachName, planName }) : buildMealPlanUpdated({ coachName, planName });
    await evaluateAndDispatch({
      userId,
      type,
      category: categoryForType(type),
      priorityTier: type === "meal_plan_assigned" ? 2 : 3,
      dedupKey,
      timezone,
      entityRef: { collection: entityCollection, id: entityId },
      ...template,
    });
  } catch (err) {
    console.error("[mealPlanAssignment] notification dispatch failed (non-fatal)", (err as Error).message);
  }
}

export class MealPlanAssignmentError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export type AssignmentWarning =
  | { type: "allergy_reminder"; allergies: string[] }
  | { type: "diet_preference_unverified"; dietaryPreferences: string[] }
  | { type: "day_calories_deviation"; dayIndex: number; planCalories: number; targetCalories: number; deviationPercent: number };

/**
 * Validates a plan against the target athlete's profile/target BEFORE
 * assigning. Allergy violations are a HARD block — never overridable,
 * mirrors the deterministic routine generator's own "never relax allergy
 * safety" rule — but ONLY for foods a coach has actually tagged with
 * allergenTags; free-text food names have no reliable automatic allergen
 * signal, so an untagged food can't be blocked on a guess. To keep that
 * honest rather than giving a false sense of safety, an athlete-with-
 * allergies always gets a non-blocking `allergy_reminder` warning too,
 * regardless of tagging, so the coach is never left assuming the system
 * caught everything. Calorie deviation per day is informational (>20% off
 * target), never blocking — a coach may have good reason to deviate.
 */
export async function validatePlanForAthlete(
  plan: Pick<MealPlanDoc, "days">,
  athleteId: Types.ObjectId
): Promise<{ blocked: false; warnings: AssignmentWarning[] } | { blocked: true; error: string; violatingFoods: string[] }> {
  const profile = await AthleteProfile.findById(athleteId).lean();
  if (!profile) throw new MealPlanAssignmentError("athlete_profile_not_found", 404);

  const allergies = (profile.allergies as string[] | undefined) ?? [];
  const dietaryPreferences = (profile.dietaryPreferences as string[] | undefined) ?? [];

  const violatingFoods: string[] = [];
  if (allergies.length > 0) {
    for (const day of plan.days as unknown as Array<{ meals: Array<{ foods: Array<{ name: string; allergenTags?: string[] }> }> }>) {
      for (const meal of day.meals) {
        for (const food of meal.foods) {
          const tags = food.allergenTags ?? [];
          if (tags.some((t) => allergies.includes(t))) {
            violatingFoods.push(food.name);
          }
        }
      }
    }
  }
  if (violatingFoods.length > 0) {
    return { blocked: true, error: "plan_contains_tagged_allergen", violatingFoods };
  }

  const warnings: AssignmentWarning[] = [];
  if (allergies.length > 0) {
    warnings.push({ type: "allergy_reminder", allergies });
  }
  if (dietaryPreferences.length > 0) {
    warnings.push({ type: "diet_preference_unverified", dietaryPreferences });
  }

  const target = await getCurrentTarget(athleteId);
  if (target) {
    for (const day of plan.days as unknown as Array<{ dayIndex: number; meals: Array<{ foods: Array<{ calories: number }> }> }>) {
      const dayCalories = day.meals.reduce((sum, m) => sum + m.foods.reduce((s, f) => s + f.calories, 0), 0);
      if (dayCalories === 0) continue;
      const deviationPercent = Math.round((Math.abs(dayCalories - target.calories) / target.calories) * 100);
      if (deviationPercent > 20) {
        warnings.push({ type: "day_calories_deviation", dayIndex: day.dayIndex, planCalories: dayCalories, targetCalories: target.calories, deviationPercent });
      }
    }
  }

  return { blocked: false, warnings };
}

/**
 * Assigns a MealPlan to an athlete — snapshots the plan's days + version
 * (never mutated by a later plan edit, same principle as WorkoutAssignment),
 * then creates/upserts one PlannedMeal per (day, mealType) exactly the way
 * the deterministic routine generator does, so the athlete's existing
 * planned-meals view (built in Phase 3) shows coach-assigned meals with zero
 * new athlete-side code. Never creates a Meal (consumed) — only PlannedMeal.
 */
export async function assignMealPlanToAthlete(params: {
  plan: HydratedDocument<MealPlanDoc>;
  assignedTo: Types.ObjectId;
  assignedBy: Types.ObjectId;
  startDate: Date;
}): Promise<HydratedDocument<MealPlanAssignmentDoc>> {
  const start = dayRange(params.startDate).start;
  const plannedMealIds: Types.ObjectId[] = [];

  for (const day of params.plan.days) {
    const date = new Date(start.getTime() + day.dayIndex * 24 * 60 * 60 * 1000);
    for (const meal of day.meals) {
      const planned = await PlannedMeal.findOneAndUpdate(
        { athleteId: params.assignedTo, date, mealType: meal.mealType },
        {
          $set: {
            source: "coach_assigned",
            name: meal.name ?? params.plan.name,
            foods: meal.foods,
          },
        },
        { upsert: true, new: true, runValidators: true }
      );
      plannedMealIds.push(planned!._id as Types.ObjectId);
    }
  }

  const assignment = await MealPlanAssignment.create({
    mealPlanId: params.plan._id,
    mealPlanVersionSnapshot: params.plan.version,
    nameSnapshot: params.plan.name,
    daysSnapshot: params.plan.days,
    durationDays: params.plan.durationDays,
    assignedTo: params.assignedTo,
    assignedBy: params.assignedBy,
    startDate: start,
    plannedMealIds,
  });

  await PlannedMeal.updateMany(
    { _id: { $in: plannedMealIds } },
    { $set: { mealPlanAssignmentId: assignment._id } }
  );

  await notifyAthleteMealPlanEvent(
    params.assignedTo,
    params.assignedBy,
    `meal_plan_assigned:${assignment._id.toString()}`,
    "meal_plan_assigned",
    assignment.nameSnapshot as string,
    assignment._id,
    "MealPlanAssignment"
  );

  return assignment;
}

/**
 * Fires `meal_plan_updated` to every athlete with a still-`active`
 * assignment of this plan (Phase 12 §3) — informational only, since
 * snapshotting means their actual assignment content is untouched.
 */
export async function notifyMealPlanTemplateUpdated(
  plan: Pick<MealPlanDoc, "_id" | "name" | "ownerId" | "version">
): Promise<void> {
  try {
    const affected = await MealPlanAssignment.find({ mealPlanId: plan._id, status: "active" })
      .select("assignedTo")
      .lean();
    const athleteIds = Array.from(new Set(affected.map((a) => (a.assignedTo as Types.ObjectId).toString())));
    await Promise.all(
      athleteIds.map((athleteId) =>
        notifyAthleteMealPlanEvent(
          new Types.ObjectId(athleteId),
          plan.ownerId as Types.ObjectId,
          `meal_plan_updated:${plan._id.toString()}:v${plan.version}:${athleteId}`,
          "meal_plan_updated",
          plan.name as string,
          plan._id as Types.ObjectId,
          "MealPlan"
        )
      )
    );
  } catch (err) {
    console.error("[mealPlanAssignment] template-updated notification failed (non-fatal)", (err as Error).message);
  }
}

/**
 * Cancels an assignment — never deletes the PlannedMeal rows it created
 * (historical/in-flight planning data is never destroyed), just marks the
 * assignment itself as no longer the athlete's active coach-assigned plan.
 */
export async function cancelMealPlanAssignment(
  assignment: HydratedDocument<MealPlanAssignmentDoc>
): Promise<HydratedDocument<MealPlanAssignmentDoc>> {
  if (assignment.status === "cancelled") return assignment;
  assignment.status = "cancelled";
  assignment.cancelledAt = new Date();
  await assignment.save();
  return assignment;
}

export function serializeMealPlanAssignment(a: MealPlanAssignmentDoc | HydratedDocument<MealPlanAssignmentDoc>) {
  const endDate = new Date((a.startDate as Date).getTime() + (a.durationDays - 1) * 24 * 60 * 60 * 1000);
  const endDateExclusive = new Date(endDate.getTime() + 24 * 60 * 60 * 1000);
  return {
    id: a._id.toString(),
    mealPlanId: (a.mealPlanId as Types.ObjectId).toString(),
    mealPlanVersionSnapshot: a.mealPlanVersionSnapshot,
    name: a.nameSnapshot,
    assignedTo: (a.assignedTo as Types.ObjectId).toString(),
    assignedBy: (a.assignedBy as Types.ObjectId).toString(),
    startDate: (a.startDate as Date).toISOString().slice(0, 10),
    endDate: endDate.toISOString().slice(0, 10),
    durationDays: a.durationDays,
    status: a.status,
    isPast: a.status === "active" && endDateExclusive.getTime() < Date.now(),
    plannedMealIds: (a.plannedMealIds as Types.ObjectId[]).map((id) => id.toString()),
    cancelledAt: a.cancelledAt ? (a.cancelledAt as Date).toISOString() : null,
  };
}
