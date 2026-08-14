import { Types, type HydratedDocument } from "mongoose";
import { NutritionTarget, type NutritionTargetDoc } from "../models/NutritionTarget";
import { AthleteProfile, type AthleteProfileDoc } from "../models/AthleteProfile";
import { calculateNutritionTarget } from "./nutritionEngine";

export class NutritionTargetError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function ageFromDob(dob: Date | null | undefined): number | null {
  if (!dob) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const hasHadBirthdayThisYear =
    now.getUTCMonth() > dob.getUTCMonth() ||
    (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() >= dob.getUTCDate());
  if (!hasHadBirthdayThisYear) age -= 1;
  return age;
}

const REQUIRED_FIELDS_ERROR = "profile_incomplete_for_nutrition_target";

/**
 * Recalculates and versions a new NutritionTarget from the athlete's current
 * profile — closes the prior current target (effectiveTo = now) rather than
 * mutating it, so every past Meal/analytics query still resolves against
 * whatever target was actually active on that date. Requires the profile to
 * have weight/height/dob/biologicalSex/activityLevel/fitnessGoal/
 * goalIntensity set first (via PATCH /athlete/me) — this function does not
 * silently guess missing inputs.
 */
export async function recalculateNutritionTarget(
  athleteId: Types.ObjectId
): Promise<HydratedDocument<NutritionTargetDoc>> {
  const profile = await AthleteProfile.findById(athleteId).lean<AthleteProfileDoc>();
  if (!profile) throw new NutritionTargetError("athlete_profile_not_found", 404);

  const age = ageFromDob(profile.dob as Date | undefined);
  if (
    !profile.weightKg ||
    !profile.heightCm ||
    age === null ||
    !profile.biologicalSex ||
    !profile.activityLevel ||
    !profile.fitnessGoal ||
    !profile.goalIntensity
  ) {
    throw new NutritionTargetError(REQUIRED_FIELDS_ERROR, 422);
  }

  const engineInput = {
    weightKg: profile.weightKg,
    heightCm: profile.heightCm,
    age,
    biologicalSex: profile.biologicalSex,
    activityLevel: profile.activityLevel,
    goal: profile.fitnessGoal,
    goalIntensity: profile.goalIntensity,
  };
  const result = calculateNutritionTarget(engineInput);

  const now = new Date();
  await NutritionTarget.updateOne(
    { athleteId, effectiveTo: null },
    { $set: { effectiveTo: now } }
  );

  return NutritionTarget.create({
    athleteId,
    goal: profile.fitnessGoal,
    goalIntensity: profile.goalIntensity,
    calories: result.calories,
    proteinG: result.proteinG,
    carbsG: result.carbsG,
    fatG: result.fatG,
    effectiveFrom: now,
    effectiveTo: null,
    calculationVersion: result.calculationVersion,
    inputSnapshot: engineInput,
  });
}

export async function getCurrentTarget(athleteId: Types.ObjectId): Promise<NutritionTargetDoc | null> {
  return NutritionTarget.findOne({ athleteId, effectiveTo: null }).lean();
}

/** Resolves whichever target was active on `date` — for historical analytics. */
export async function resolveTargetForDate(
  athleteId: Types.ObjectId,
  date: Date
): Promise<NutritionTargetDoc | null> {
  return NutritionTarget.findOne({
    athleteId,
    effectiveFrom: { $lte: date },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gt: date } }],
  })
    .sort({ effectiveFrom: -1 })
    .lean();
}

export function serializeTarget(t: NutritionTargetDoc) {
  return {
    id: t._id.toString(),
    goal: t.goal,
    goalIntensity: t.goalIntensity,
    calories: t.calories,
    proteinG: t.proteinG,
    carbsG: t.carbsG,
    fatG: t.fatG,
    effectiveFrom: (t.effectiveFrom as Date).toISOString(),
    effectiveTo: t.effectiveTo ? (t.effectiveTo as Date).toISOString() : null,
    calculationVersion: t.calculationVersion,
  };
}
