/**
 * One-off manual verification against the REAL fitora Atlas database (not
 * mongodb-memory-server) — proves the Phase 3 nutrition system actually
 * persists through a real Mongo connection. Creates its own throwaway
 * athlete, exercises target-calc -> routine-generation -> meal-logging, and
 * deletes everything it created before exiting.
 */
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { connectMongo, disconnectMongo } from "../db/mongoose";
import { User } from "../models/User";
import { AthleteProfile } from "../models/AthleteProfile";
import { NutritionTarget } from "../models/NutritionTarget";
import { PlannedMeal } from "../models/PlannedMeal";
import { Meal } from "../models/Meal";
import { MealFood } from "../models/MealFood";
import { Routine } from "../models/Routine";
import { recalculateNutritionTarget } from "../services/nutritionTarget";
import { generateDeterministicRoutine } from "../services/routineGenerator";

async function run() {
  await connectMongo();
  console.log("[smoke-nutrition] connected to", mongoose.connection.db?.databaseName);

  const passwordHash = await bcrypt.hash("smoketest", 10);
  const user = await User.create({ email: "smoke-nutrition@fitora.test", passwordHash, role: "athlete", name: "Smoke Nutrition" });
  const profile = await AthleteProfile.create({
    userId: user._id,
    sport: "general",
    heightCm: 178,
    weightKg: 76,
    dob: new Date(Date.UTC(1993, 5, 20)),
    biologicalSex: "male",
    activityLevel: "moderate",
    fitnessGoal: "lose_weight",
    goalIntensity: "moderate",
  });

  const target = await recalculateNutritionTarget(profile._id);
  console.log("[smoke-nutrition] target created:", target.calories, "kcal /", target.proteinG, "P /", target.carbsG, "C /", target.fatG, "F");

  const routine = await generateDeterministicRoutine({
    athleteId: profile._id,
    startDate: new Date(Date.UTC(2026, 0, 1)),
    durationDays: 7,
    target,
    dietaryPreferences: [],
    allergies: ["nuts"],
    cuisinePreferences: [],
  });
  console.log("[smoke-nutrition] routine created:", routine._id.toString(), "plannedMeals:", routine.plannedMealIds.length);

  const meal = await Meal.create({ athleteId: profile._id, date: new Date(Date.UTC(2026, 0, 1)), mealType: "lunch", source: "ad_hoc", loggedAt: new Date() });
  await MealFood.create({ mealId: meal._id, name: "Smoke Test Chicken Bowl", quantity: 1, unit: "serving", calories: 550, proteinG: 40, carbsG: 55, fatG: 15 });

  const persistedTarget = await NutritionTarget.findById(target._id).lean();
  const persistedRoutine = await Routine.findById(routine._id).lean();
  const persistedPlannedCount = await PlannedMeal.countDocuments({ athleteId: profile._id });
  const persistedMeal = await Meal.findById(meal._id).lean();
  const persistedFoods = await MealFood.find({ mealId: meal._id }).lean();

  console.log("[smoke-nutrition] re-read from Mongo (fresh queries):");
  console.log("  target.calories =", persistedTarget?.calories, "(expect > 0)");
  console.log("  routine.plannedMealIds.length =", persistedRoutine?.plannedMealIds.length, "(expect 28)");
  console.log("  PlannedMeal count =", persistedPlannedCount, "(expect 28)");
  console.log("  meal.mealType =", persistedMeal?.mealType, "(expect lunch)");
  console.log("  meal foods count =", persistedFoods.length, "(expect 1)");

  const ok =
    (persistedTarget?.calories ?? 0) > 0 &&
    persistedRoutine?.plannedMealIds.length === 28 &&
    persistedPlannedCount === 28 &&
    persistedMeal?.mealType === "lunch" &&
    persistedFoods.length === 1;

  await Promise.all([
    NutritionTarget.deleteMany({ athleteId: profile._id }),
    PlannedMeal.deleteMany({ athleteId: profile._id }),
    Routine.deleteMany({ athleteId: profile._id }),
    MealFood.deleteMany({ mealId: meal._id }),
    Meal.deleteMany({ athleteId: profile._id }),
    AthleteProfile.deleteOne({ _id: profile._id }),
    User.deleteOne({ _id: user._id }),
  ]);
  console.log("[smoke-nutrition] cleanup complete — database left as found");

  if (!ok) throw new Error("smoke test assertions failed");
  console.log("[smoke-nutrition] ALL ASSERTIONS PASSED");
}

run()
  .then(async () => {
    await disconnectMongo();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("[smoke-nutrition] FAILED:", err);
    await disconnectMongo().catch(() => undefined);
    process.exit(1);
  });
