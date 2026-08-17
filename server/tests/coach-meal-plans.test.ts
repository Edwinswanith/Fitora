import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { CoachAthleteAssignment } from "../src/models/CoachAthleteAssignment";
import { MealPlan } from "../src/models/MealPlan";
import { MealPlanAssignment } from "../src/models/MealPlanAssignment";
import { PlannedMeal } from "../src/models/PlannedMeal";
import { NutritionTarget } from "../src/models/NutritionTarget";
import coachMealPlansRouter from "../src/routes/coachMealPlans";
import nutritionRouter from "../src/routes/nutrition";
import athleteRouter from "../src/routes/athlete";
import { signAccessToken } from "../src/lib/tokens";

let mongo: MongoMemoryServer;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/coach", coachMealPlansRouter);
  app.use("/api/athlete/nutrition", nutritionRouter);
  app.use("/api/athlete", athleteRouter);
  return app;
}
async function makeUser(role: "coach" | "athlete", name: string) {
  return User.create({ email: `${name}@test.io`, passwordHash: "x", role, name });
}
function tokenFor(id: Types.ObjectId, role: "coach" | "athlete") {
  return signAccessToken({ sub: id.toString(), role });
}
async function makeCoachWithAthlete(coachName: string, athleteName: string) {
  const coach = await makeUser("coach", coachName);
  const athleteUser = await makeUser("athlete", athleteName);
  const profile = await AthleteProfile.create({ userId: athleteUser._id, sport: "general" });
  await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id });
  return { coach, athleteUser, profile };
}

const SIMPLE_DAYS = [
  {
    dayIndex: 0,
    meals: [
      { mealType: "breakfast", foods: [{ name: "Oats", quantity: 1, unit: "bowl", calories: 300, proteinG: 10, carbsG: 50, fatG: 5 }] },
      { mealType: "lunch", foods: [{ name: "Chicken Rice Bowl", quantity: 1, unit: "serving", calories: 620, proteinG: 45, carbsG: 60, fatG: 18 }] },
    ],
  },
];

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
});

describe("MealPlan CRUD, ownership, versioning", () => {
  test("coach creates a 1-day meal plan; only durations 1/7/14/30 accepted", async () => {
    const coach = await makeUser("coach", "plan-coach");
    const app = buildApp();
    const token = `Bearer ${tokenFor(coach._id, "coach")}`;

    const created = await request(app).post("/api/coach/meal-plans").set("Authorization", token).send({ name: "Cut Week 1", durationDays: 1, days: SIMPLE_DAYS });
    expect(created.status).toBe(201);
    expect(created.body.mealPlan.version).toBe(1);

    const badDuration = await request(app).post("/api/coach/meal-plans").set("Authorization", token).send({ name: "Bad", durationDays: 5, days: SIMPLE_DAYS });
    expect(badDuration.status).toBe(400);
    expect(badDuration.body.error).toBe("invalid_durationDays");
  });

  test("editing days bumps version; editing name/description alone does not", async () => {
    const coach = await makeUser("coach", "ver-coach");
    const app = buildApp();
    const token = `Bearer ${tokenFor(coach._id, "coach")}`;
    const created = await request(app).post("/api/coach/meal-plans").set("Authorization", token).send({ name: "V1", durationDays: 1, days: SIMPLE_DAYS });
    const id = created.body.mealPlan.id;

    const renamed = await request(app).patch(`/api/coach/meal-plans/${id}`).set("Authorization", token).send({ description: "tweak" });
    expect(renamed.body.mealPlan.version).toBe(1);

    const edited = await request(app).patch(`/api/coach/meal-plans/${id}`).set("Authorization", token).send({
      days: [{ dayIndex: 0, meals: [{ mealType: "breakfast", foods: [{ name: "New Breakfast", quantity: 1, unit: "bowl", calories: 400, proteinG: 15, carbsG: 50, fatG: 10 }] }] }],
    });
    expect(edited.body.mealPlan.version).toBe(2);
  });

  test("a coach cannot edit another coach's meal plan", async () => {
    const owner = await makeUser("coach", "mp-owner");
    const intruder = await makeUser("coach", "mp-intruder");
    const app = buildApp();
    const created = await request(app).post("/api/coach/meal-plans").set("Authorization", `Bearer ${tokenFor(owner._id, "coach")}`).send({ name: "Mine", durationDays: 1, days: SIMPLE_DAYS });

    const res = await request(app).patch(`/api/coach/meal-plans/${created.body.mealPlan.id}`).set("Authorization", `Bearer ${tokenFor(intruder._id, "coach")}`).send({ name: "Hijack" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("not_meal_plan_owner");
  });
});

describe("Assignment: snapshot immutability + reuses PlannedMeal (zero new athlete-side code)", () => {
  test("editing the plan after assignment does not change the existing assignment's snapshot", async () => {
    const { coach, profile } = await makeCoachWithAthlete("snap-coach", "snap-athlete");
    const app = buildApp();
    const coachToken = `Bearer ${tokenFor(coach._id, "coach")}`;
    const plan = await request(app).post("/api/coach/meal-plans").set("Authorization", coachToken).send({ name: "Week Plan", durationDays: 1, days: SIMPLE_DAYS });

    const assign = await request(app)
      .post(`/api/coach/athletes/${profile._id}/meal-plan-assignments`)
      .set("Authorization", coachToken)
      .send({ mealPlanId: plan.body.mealPlan.id, startDate: "2026-08-14" });
    expect(assign.status).toBe(201);
    expect(assign.body.assignment.mealPlanVersionSnapshot).toBe(1);

    await request(app).patch(`/api/coach/meal-plans/${plan.body.mealPlan.id}`).set("Authorization", coachToken).send({
      days: [{ dayIndex: 0, meals: [{ mealType: "breakfast", foods: [{ name: "Totally Different", quantity: 1, unit: "bowl", calories: 999, proteinG: 1, carbsG: 1, fatG: 1 }] }] }],
    });

    // The athlete's already-planned breakfast for that day is still "Oats" —
    // untouched by the later plan edit.
    const athleteToken = `Bearer ${tokenFor(profile.userId as Types.ObjectId, "athlete")}`;
    const plannedMeals = await request(app).get("/api/athlete/nutrition/planned-meals?date=2026-08-14").set("Authorization", athleteToken);
    const breakfast = plannedMeals.body.plannedMeals.find((m: { mealType: string }) => m.mealType === "breakfast");
    expect(breakfast.foods[0].name).toBe("Oats");
  });

  test("coach-assigned plan appears in the athlete's EXISTING planned-meals endpoint with zero new athlete routes; planning still doesn't affect consumed totals", async () => {
    const { coach, profile } = await makeCoachWithAthlete("reuse-coach", "reuse-athlete");
    const app = buildApp();
    const coachToken = `Bearer ${tokenFor(coach._id, "coach")}`;
    const plan = await request(app).post("/api/coach/meal-plans").set("Authorization", coachToken).send({ name: "Assigned Plan", durationDays: 1, days: SIMPLE_DAYS });
    await request(app).post(`/api/coach/athletes/${profile._id}/meal-plan-assignments`).set("Authorization", coachToken).send({ mealPlanId: plan.body.mealPlan.id, startDate: "2026-08-14" });

    const athleteToken = `Bearer ${tokenFor(profile.userId as Types.ObjectId, "athlete")}`;
    const planned = await request(app).get("/api/athlete/nutrition/planned-meals?date=2026-08-14").set("Authorization", athleteToken);
    expect(planned.body.plannedMeals).toHaveLength(2);
    expect(planned.body.plannedMeals.find((m: { mealType: string }) => m.mealType === "lunch").source).toBe("coach_assigned");

    // Consumed totals are still zero — a coach's plan is a plan, not intake.
    const consumed = await request(app).get("/api/athlete/nutrition/meals?date=2026-08-14").set("Authorization", athleteToken);
    expect(consumed.body.totals.calories).toBe(0);
  });

  test("assigning to an athlete not currently assigned to the coach is rejected", async () => {
    const coach = await makeUser("coach", "unassigned-mp-coach");
    const { profile } = await makeCoachWithAthlete("other-mp-coach", "other-mp-athlete");
    const app = buildApp();
    const plan = await request(app).post("/api/coach/meal-plans").set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`).send({ name: "P", durationDays: 1, days: SIMPLE_DAYS });

    const res = await request(app)
      .post(`/api/coach/athletes/${profile._id}/meal-plan-assignments`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .send({ mealPlanId: plan.body.mealPlan.id, startDate: "2026-08-14" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("not_in_assignments");
  });

  test("cancelling an assignment does not delete the PlannedMeal rows it created", async () => {
    const { coach, profile } = await makeCoachWithAthlete("cancel-coach", "cancel-athlete");
    const app = buildApp();
    const coachToken = `Bearer ${tokenFor(coach._id, "coach")}`;
    const plan = await request(app).post("/api/coach/meal-plans").set("Authorization", coachToken).send({ name: "P", durationDays: 1, days: SIMPLE_DAYS });
    const assign = await request(app).post(`/api/coach/athletes/${profile._id}/meal-plan-assignments`).set("Authorization", coachToken).send({ mealPlanId: plan.body.mealPlan.id, startDate: "2026-08-14" });

    const cancel = await request(app).post(`/api/coach/meal-plan-assignments/${assign.body.assignment.id}/cancel`).set("Authorization", coachToken);
    expect(cancel.status).toBe(200);
    expect(cancel.body.assignment.status).toBe("cancelled");
    expect(await PlannedMeal.countDocuments({})).toBe(2);
  });
});

describe("Validation: allergy hard-block (only for tagged foods) + non-blocking warnings", () => {
  test("a plan containing a food TAGGED with an athlete's allergen is blocked with 422", async () => {
    const { coach, athleteUser, profile } = await makeCoachWithAthlete("allergy-coach", "allergy-athlete");
    await AthleteProfile.updateOne({ _id: profile._id }, { $set: { allergies: ["nuts"] } });
    const app = buildApp();
    const coachToken = `Bearer ${tokenFor(coach._id, "coach")}`;
    const plan = await request(app).post("/api/coach/meal-plans").set("Authorization", coachToken).send({
      name: "Nutty Plan",
      durationDays: 1,
      days: [{ dayIndex: 0, meals: [{ mealType: "snack", foods: [{ name: "Almond Butter Toast", quantity: 1, unit: "serving", calories: 300, proteinG: 10, carbsG: 20, fatG: 15, allergenTags: ["nuts"] }] }] }],
    });

    const res = await request(app)
      .post(`/api/coach/athletes/${profile._id}/meal-plan-assignments`)
      .set("Authorization", coachToken)
      .send({ mealPlanId: plan.body.mealPlan.id, startDate: "2026-08-14" });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("plan_contains_tagged_allergen");
    expect(res.body.violatingFoods).toContain("Almond Butter Toast");
    expect(await MealPlanAssignment.countDocuments({})).toBe(0);
    expect(await PlannedMeal.countDocuments({})).toBe(0);
  });

  test("an UNTAGGED food is never auto-blocked, but the athlete's allergy list is still surfaced as a reminder", async () => {
    const { coach, profile } = await makeCoachWithAthlete("untagged-coach", "untagged-athlete");
    await AthleteProfile.updateOne({ _id: profile._id }, { $set: { allergies: ["shellfish"] } });
    const app = buildApp();
    const coachToken = `Bearer ${tokenFor(coach._id, "coach")}`;
    const plan = await request(app).post("/api/coach/meal-plans").set("Authorization", coachToken).send({ name: "Untagged", durationDays: 1, days: SIMPLE_DAYS });

    const res = await request(app)
      .post(`/api/coach/athletes/${profile._id}/meal-plan-assignments`)
      .set("Authorization", coachToken)
      .send({ mealPlanId: plan.body.mealPlan.id, startDate: "2026-08-14" });
    expect(res.status).toBe(201);
    expect(res.body.warnings).toContainEqual(expect.objectContaining({ type: "allergy_reminder", allergies: ["shellfish"] }));
  });

  test("a day whose calories deviate >20% from the athlete's current target is flagged as a non-blocking warning", async () => {
    const { coach, athleteUser, profile } = await makeCoachWithAthlete("dev-coach", "dev-athlete");
    const app = buildApp();
    const athleteToken = `Bearer ${tokenFor(athleteUser._id, "athlete")}`;
    await request(app).patch("/api/athlete/me").set("Authorization", athleteToken).send({
      heightCm: 175, weightKg: 75, dob: "1994-01-01", biologicalSex: "male", activityLevel: "sedentary", fitnessGoal: "maintain_weight", goalIntensity: "mild",
    });
    await request(app).post("/api/athlete/nutrition/target/recalculate").set("Authorization", athleteToken);
    const target = await NutritionTarget.findOne({ athleteId: profile._id }).lean();

    const coachToken = `Bearer ${tokenFor(coach._id, "coach")}`;
    // Deliberately >20% over target to trigger the deviation warning, capped
    // well under the 5000-calorie per-food-item schema limit.
    const hugeCalories = Math.min(Math.round(target!.calories * 1.6), 4900);
    const plan = await request(app).post("/api/coach/meal-plans").set("Authorization", coachToken).send({
      name: "Huge Plan",
      durationDays: 1,
      days: [{ dayIndex: 0, meals: [{ mealType: "lunch", foods: [{ name: "Massive Meal", quantity: 1, unit: "serving", calories: hugeCalories, proteinG: 100, carbsG: 200, fatG: 100 }] }] }],
    });

    const res = await request(app)
      .post(`/api/coach/athletes/${profile._id}/meal-plan-assignments`)
      .set("Authorization", coachToken)
      .send({ mealPlanId: plan.body.mealPlan.id, startDate: "2026-08-14" });
    expect(res.status).toBe(201);
    expect(res.body.warnings).toContainEqual(expect.objectContaining({ type: "day_calories_deviation", dayIndex: 0 }));
  });
});
