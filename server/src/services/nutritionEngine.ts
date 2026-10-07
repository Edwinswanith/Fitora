import type { FitnessGoal, GoalIntensity, ActivityLevel, BiologicalSex } from "../models/AthleteProfile";

/**
 * Single source of truth for the deterministic BMR -> TDEE -> goal-adjusted
 * -> guardrailed -> macro pipeline. AI must never compute or override any of
 * this (see MealScan/mealScan.ts for where the AI boundary actually is —
 * nutrition targets are not it). Every tunable constant lives HERE, not
 * scattered across routes — activity factors, calorie deltas, macro rules,
 * and safety floors all in one place.
 */
export const NUTRITION_CALCULATION_VERSION = "v1-mifflin-st-jeor";

export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

// Daily calorie delta from TDEE, by goal + intensity. Zero for maintenance
// regardless of intensity (there's nothing to intensify).
const GOAL_CALORIE_DELTA: Record<FitnessGoal, Record<GoalIntensity, number>> = {
  lose_weight: { mild: -250, moderate: -500, aggressive: -750 },
  maintain_weight: { mild: 0, moderate: 0, aggressive: 0 },
  gain_weight: { mild: 250, moderate: 500, aggressive: 750 },
};

// Protein target scales with bodyweight and goal (higher when losing, to
// protect lean mass, and when gaining, to support growth); fat is a fixed
// share of total calories; carbs absorb the remainder. This is the standard
// "protein by bodyweight, fat by %, carbs fill the rest" approach — simple,
// explainable, and easy to safety-check (see reconcileMacros below).
const PROTEIN_G_PER_KG: Record<FitnessGoal, number> = {
  lose_weight: 2.0,
  maintain_weight: 1.8,
  gain_weight: 2.0,
};
const FAT_PERCENT_OF_CALORIES = 0.25;

// Safety guardrails — a target must never encourage an unsafe deficit
// regardless of what the raw formula produces.
const ABSOLUTE_CALORIE_FLOOR = 1200;
const MIN_CALORIES_AS_BMR_MULTIPLE = 1.0; // never below resting metabolic need

export type NutritionEngineInput = {
  weightKg: number;
  heightCm: number;
  age: number;
  biologicalSex: BiologicalSex;
  activityLevel: ActivityLevel;
  goal: FitnessGoal;
  goalIntensity: GoalIntensity;
};

export type NutritionEngineOutput = {
  bmr: number;
  tdee: number;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  calculationVersion: string;
};

/** Mifflin-St Jeor — the most widely validated BMR equation for general use. */
export function computeBMR(input: Pick<NutritionEngineInput, "weightKg" | "heightCm" | "age" | "biologicalSex">): number {
  const base = 10 * input.weightKg + 6.25 * input.heightCm - 5 * input.age;
  return input.biologicalSex === "male" ? base + 5 : base - 161;
}

export function computeTDEE(bmr: number, activityLevel: ActivityLevel): number {
  return bmr * ACTIVITY_FACTORS[activityLevel];
}

/**
 * Rounds macros so protein*4 + carbs*4 + fat*9 reconciles to `calories`
 * within a small tolerance (rounding alone can drift a few kcal) — the
 * remainder after protein+fat is always assigned to carbs last, since carbs
 * is the "fill the rest" macro by design.
 */
function reconcileMacros(calories: number, proteinG: number, fatG: number): { proteinG: number; carbsG: number; fatG: number } {
  const proteinKcal = proteinG * 4;
  const fatKcal = fatG * 9;
  const carbsKcal = Math.max(0, calories - proteinKcal - fatKcal);
  const carbsG = Math.round(carbsKcal / 4);
  return { proteinG: Math.round(proteinG), carbsG, fatG: Math.round(fatG) };
}

export function calculateNutritionTarget(input: NutritionEngineInput): NutritionEngineOutput {
  const bmr = computeBMR(input);
  const tdee = computeTDEE(bmr, input.activityLevel);
  const rawCalories = tdee + GOAL_CALORIE_DELTA[input.goal][input.goalIntensity];

  const calories = Math.round(
    Math.max(ABSOLUTE_CALORIE_FLOOR, rawCalories, bmr * MIN_CALORIES_AS_BMR_MULTIPLE)
  );

  const proteinG = PROTEIN_G_PER_KG[input.goal] * input.weightKg;
  const fatG = (calories * FAT_PERCENT_OF_CALORIES) / 9;
  const macros = reconcileMacros(calories, proteinG, fatG);

  return {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    calories,
    ...macros,
    calculationVersion: NUTRITION_CALCULATION_VERSION,
  };
}

export type NutritionTargetBreakdown = {
  bmr: number;
  activityFactor: number;
  tdee: number;
  goalDelta: number;
  /** Which safety floor raised the target, if any. */
  floorApplied: "minimum" | "resting_burn" | null;
  calories: number;
};

/**
 * The same steps as calculateNutritionTarget, kept as numbers the app can
 * show ("How is this calculated?"). Never a second formula: it reuses the
 * functions and constants above.
 */
export function explainNutritionTarget(input: NutritionEngineInput): NutritionTargetBreakdown {
  const bmr = computeBMR(input);
  const activityFactor = ACTIVITY_FACTORS[input.activityLevel];
  const tdee = bmr * activityFactor;
  const goalDelta = GOAL_CALORIE_DELTA[input.goal][input.goalIntensity];
  const raw = tdee + goalDelta;
  const calories = Math.round(Math.max(ABSOLUTE_CALORIE_FLOOR, raw, bmr * MIN_CALORIES_AS_BMR_MULTIPLE));
  const floorApplied = raw >= Math.max(ABSOLUTE_CALORIE_FLOOR, bmr * MIN_CALORIES_AS_BMR_MULTIPLE) ? null : bmr * MIN_CALORIES_AS_BMR_MULTIPLE > ABSOLUTE_CALORIE_FLOOR ? "resting_burn" : "minimum";
  return { bmr: Math.round(bmr), activityFactor, tdee: Math.round(tdee), goalDelta, floorApplied, calories };
}

/** Verifies protein*4 + carbs*4 + fat*9 reconciles to calories within tolerance. */
export function macrosReconcileToCalories(
  calories: number,
  proteinG: number,
  carbsG: number,
  fatG: number,
  tolerancePercent = 5
): boolean {
  const derived = proteinG * 4 + carbsG * 4 + fatG * 9;
  const diff = Math.abs(derived - calories);
  return diff <= (calories * tolerancePercent) / 100;
}
