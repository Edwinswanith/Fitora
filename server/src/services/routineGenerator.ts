import { Types } from "mongoose";
import { MEAL_LIBRARY, libraryBaseCalories, type MealLibraryEntry, type LibraryFood } from "../lib/mealLibrary";
import { PlannedMeal } from "../models/PlannedMeal";
import { Routine } from "../models/Routine";
import { WorkoutAssignment } from "../models/WorkoutAssignment";
import { dayRange } from "./dashboard";
import type { NutritionTargetDoc } from "../models/NutritionTarget";

// Fixed share of daily calories per slot — simple, explainable, centrally
// defined (not scattered), and easy to adjust in one place later.
const SLOT_CALORIE_SHARE: Record<"breakfast" | "lunch" | "dinner" | "snack", number> = {
  breakfast: 0.25,
  lunch: 0.35,
  dinner: 0.3,
  snack: 0.1,
};

function poolFor(mealType: "breakfast" | "lunch" | "dinner" | "snack"): MealLibraryEntry[] {
  if (mealType === "lunch" || mealType === "dinner") {
    // Lunch and dinner draw from a shared pool — real-world meals are
    // interchangeable between the two slots, which is what makes a 7-day
    // plan feel varied instead of "the same 2 dinners forever."
    return MEAL_LIBRARY.filter((e) => e.mealType === "lunch" || e.mealType === "dinner");
  }
  return MEAL_LIBRARY.filter((e) => e.mealType === mealType);
}

/**
 * Filters candidates for one slot. Allergy exclusion is NEVER relaxed, even
 * in the fallback chain below — everything else (cuisine preference, then
 * diet preference) is progressively relaxed only if the stricter filter
 * leaves zero candidates, so a User is never left without a plan just
 * because their preferences happen to be narrow, but is never shown
 * something they're allergic to under any circumstance.
 */
function selectCandidates(
  mealType: "breakfast" | "lunch" | "dinner" | "snack",
  allergies: string[],
  dietaryPreferences: string[],
  cuisinePreferences: string[]
): MealLibraryEntry[] {
  const allergySafe = poolFor(mealType).filter(
    (e) => !e.allergens.some((a) => allergies.includes(a))
  );

  const dietFiltered = dietaryPreferences.length
    ? allergySafe.filter((e) => e.dietTags.some((d) => dietaryPreferences.includes(d)))
    : allergySafe;
  const base = dietFiltered.length > 0 ? dietFiltered : allergySafe;

  const cuisineFiltered = cuisinePreferences.length
    ? base.filter((e) => e.cuisineTags.some((c) => cuisinePreferences.includes(c)))
    : base;

  // Never return an empty pool if the allergy-safe pool itself has entries —
  // that's the point of the fallback chain (relax preferences, never safety).
  return cuisineFiltered.length > 0 ? cuisineFiltered : base;
}

function scaleFoods(foods: LibraryFood[], scaleFactor: number): LibraryFood[] {
  return foods.map((f) => ({
    name: f.name,
    quantity: Math.round(f.quantity * scaleFactor * 10) / 10,
    unit: f.unit,
    calories: Math.round(f.calories * scaleFactor),
    proteinG: Math.round(f.proteinG * scaleFactor * 10) / 10,
    carbsG: Math.round(f.carbsG * scaleFactor * 10) / 10,
    fatG: Math.round(f.fatG * scaleFactor * 10) / 10,
    fiberG: f.fiberG !== undefined ? Math.round(f.fiberG * scaleFactor * 10) / 10 : undefined,
  }));
}

export type GenerateRoutineParams = {
  athleteId: Types.ObjectId;
  startDate: Date;
  durationDays: number;
  target: Pick<NutritionTargetDoc, "calories">;
  dietaryPreferences: string[];
  allergies: string[];
  cuisinePreferences: string[];
};

/**
 * Generates a deterministic multi-day meal plan — no AI call in this path at
 * all, so it can never block on a provider timeout and never produces
 * hallucinated nutrition values (every number traces back to the static
 * MEAL_LIBRARY, only scaled by simple arithmetic). Upserts PlannedMeal per
 * (athleteId, date, mealType) — regenerating a routine replaces that range's
 * plan rather than accumulating duplicates. Returns the created Routine
 * (a thin reference layer — it stores ids, not a copy of the meal content).
 */
export async function generateDeterministicRoutine(
  params: GenerateRoutineParams
): Promise<InstanceType<typeof Routine>> {
  const usedEntryIdsByType = new Map<string, string[]>();
  const plannedMealIds: Types.ObjectId[] = [];

  for (let day = 0; day < params.durationDays; day++) {
    const date = dayRange(new Date(params.startDate.getTime() + day * 24 * 60 * 60 * 1000)).start;
    const slots: Array<"breakfast" | "lunch" | "dinner" | "snack"> = ["breakfast", "lunch", "dinner", "snack"];

    for (const mealType of slots) {
      const candidates = selectCandidates(mealType, params.allergies, params.dietaryPreferences, params.cuisinePreferences);
      const used = usedEntryIdsByType.get(mealType) ?? [];
      // Prefer an entry not yet used this routine; once the whole pool has
      // been used, cycle back to the least-recently-used one rather than
      // failing or repeating the same single meal every day.
      const unused = candidates.filter((c) => !used.includes(c.id));
      const entry = (unused.length > 0 ? unused : candidates)[
        Math.floor((day * 7 + slots.indexOf(mealType)) % (unused.length > 0 ? unused.length : candidates.length))
      ];
      usedEntryIdsByType.set(mealType, [...used, entry.id].slice(-Math.max(1, candidates.length - 1)));

      const slotBudget = params.target.calories * SLOT_CALORIE_SHARE[mealType];
      const baseCal = libraryBaseCalories(entry);
      const scaleFactor = baseCal > 0 ? slotBudget / baseCal : 1;
      const foods = scaleFoods(entry.baseFoods, scaleFactor);

      const planned = await PlannedMeal.findOneAndUpdate(
        { athleteId: params.athleteId, date, mealType },
        {
          $set: {
            source: "deterministic",
            name: entry.name,
            foods,
          },
        },
        { upsert: true, new: true, runValidators: true }
      );
      plannedMealIds.push(planned!._id as Types.ObjectId);
    }
  }

  const { start: rangeStart } = dayRange(params.startDate);
  const { end: rangeEnd } = dayRange(new Date(params.startDate.getTime() + (params.durationDays - 1) * 24 * 60 * 60 * 1000));
  const existingWorkouts = await WorkoutAssignment.find({
    assignedTo: params.athleteId,
    scheduledDate: { $gte: rangeStart, $lt: rangeEnd },
  })
    .select("_id")
    .lean();

  const routine = await Routine.create({
    athleteId: params.athleteId,
    startDate: rangeStart,
    durationDays: params.durationDays,
    generatedBy: "deterministic",
    plannedMealIds,
    workoutAssignmentIds: existingWorkouts.map((w) => w._id),
  });

  for (const pmId of plannedMealIds) {
    await PlannedMeal.updateOne({ _id: pmId, routineId: null }, { $set: { routineId: routine._id } });
  }

  return routine;
}
