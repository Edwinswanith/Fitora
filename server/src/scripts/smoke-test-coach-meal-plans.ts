/**
 * One-off manual verification against the REAL fitora Atlas database — proves
 * the Phase 4 coach meal-plan system persists correctly, including that a
 * coach-assigned plan produces real PlannedMeal rows the athlete's existing
 * (Phase 3) endpoints already read. Cleans up everything it creates.
 */
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { connectMongo, disconnectMongo } from "../db/mongoose";
import { User } from "../models/User";
import { AthleteProfile } from "../models/AthleteProfile";
import { CoachAthleteAssignment } from "../models/CoachAthleteAssignment";
import { MealPlan } from "../models/MealPlan";
import { MealPlanAssignment } from "../models/MealPlanAssignment";
import { PlannedMeal } from "../models/PlannedMeal";
import { assignMealPlanToAthlete, validatePlanForAthlete, cancelMealPlanAssignment } from "../services/mealPlanAssignment";

async function run() {
  await connectMongo();
  console.log("[smoke-coach-meal-plans] connected to", mongoose.connection.db?.databaseName);

  const passwordHash = await bcrypt.hash("smoketest", 10);
  const coach = await User.create({ email: "smoke-mp-coach@fitora.test", passwordHash, role: "coach", name: "Smoke Coach" });
  const athleteUser = await User.create({ email: "smoke-mp-athlete@fitora.test", passwordHash, role: "athlete", name: "Smoke Athlete" });
  const profile = await AthleteProfile.create({ userId: athleteUser._id, sport: "general", allergies: ["nuts"] });
  const relationship = await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id });

  const plan = await MealPlan.create({
    ownerId: coach._id,
    name: "Smoke Test Plan",
    durationDays: 1,
    days: [{ dayIndex: 0, meals: [{ mealType: "lunch", foods: [{ name: "Grilled Chicken Bowl", quantity: 1, unit: "serving", calories: 550, proteinG: 45, carbsG: 40, fatG: 15 }] }] }],
    version: 1,
  });

  const validation = await validatePlanForAthlete(plan, profile._id);
  console.log("[smoke-coach-meal-plans] validation blocked:", validation.blocked, "(expect false — no tagged allergen)");

  const assignment = await assignMealPlanToAthlete({ plan, assignedTo: profile._id, assignedBy: coach._id, startDate: new Date(Date.UTC(2026, 0, 1)) });
  console.log("[smoke-coach-meal-plans] assignment created:", assignment._id.toString(), "plannedMealIds:", assignment.plannedMealIds.length);

  const persistedPlanned = await PlannedMeal.findOne({ athleteId: profile._id }).lean();
  console.log("[smoke-coach-meal-plans] PlannedMeal persisted — source:", persistedPlanned?.source, "(expect coach_assigned)");

  const cancelled = await cancelMealPlanAssignment(assignment);
  console.log("[smoke-coach-meal-plans] cancelled status:", cancelled.status, "(expect cancelled)");
  const plannedMealsAfterCancel = await PlannedMeal.countDocuments({ athleteId: profile._id });
  console.log("[smoke-coach-meal-plans] PlannedMeal rows still present after cancel:", plannedMealsAfterCancel, "(expect 1 — history preserved)");

  const ok =
    validation.blocked === false &&
    assignment.plannedMealIds.length === 1 &&
    persistedPlanned?.source === "coach_assigned" &&
    cancelled.status === "cancelled" &&
    plannedMealsAfterCancel === 1;

  await Promise.all([
    MealPlanAssignment.deleteMany({ assignedTo: profile._id }),
    PlannedMeal.deleteMany({ athleteId: profile._id }),
    MealPlan.deleteOne({ _id: plan._id }),
    CoachAthleteAssignment.deleteOne({ _id: relationship._id }),
    AthleteProfile.deleteOne({ _id: profile._id }),
    User.deleteOne({ _id: coach._id }),
    User.deleteOne({ _id: athleteUser._id }),
  ]);
  console.log("[smoke-coach-meal-plans] cleanup complete — database left as found");

  if (!ok) throw new Error("smoke test assertions failed");
  console.log("[smoke-coach-meal-plans] ALL ASSERTIONS PASSED");
}

run()
  .then(async () => {
    await disconnectMongo();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("[smoke-coach-meal-plans] FAILED:", err);
    await disconnectMongo().catch(() => undefined);
    process.exit(1);
  });
