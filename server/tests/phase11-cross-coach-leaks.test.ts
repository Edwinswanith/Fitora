import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { CoachAthleteAssignment } from "../src/models/CoachAthleteAssignment";
import { WorkoutTemplate } from "../src/models/WorkoutTemplate";
import { MealPlan } from "../src/models/MealPlan";
import coachRouter from "../src/routes/coach";
import coachWorkoutRouter from "../src/routes/coachWorkout";
import coachMealPlansRouter from "../src/routes/coachMealPlans";
import { signAccessToken } from "../src/lib/tokens";
import { assignTemplateToAthlete } from "../src/services/workoutAssignment";
import { assignMealPlanToAthlete } from "../src/services/mealPlanAssignment";

// Phase 11 hardening: two confirmed cross-coach data leaks. requireAthleteAccess
// only proves the athlete is CURRENTLY assigned to the requesting coach — it
// says nothing about who authored a given historical assignment. Without an
// assignedBy scope, a coach who inherits an athlete from a prior relationship
// could read that previous coach's programmed workouts/meal plans.
let mongo: MongoMemoryServer;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/coach", coachRouter);
  app.use("/api/coach", coachWorkoutRouter);
  app.use("/api/coach", coachMealPlansRouter);
  return app;
}
async function makeCoach(name: string) {
  return User.create({ email: `${name}@test.io`, passwordHash: "x", role: "coach", name });
}
async function makeAthlete(name: string) {
  const user = await User.create({ email: `${name}@test.io`, passwordHash: "x", role: "athlete", name });
  const profile = await AthleteProfile.create({ userId: user._id, sport: "general" });
  return { user, profile };
}
function tokenFor(id: Types.ObjectId, role: "coach" | "athlete") {
  return signAccessToken({ sub: id.toString(), role });
}

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

async function setupSwitchedAthlete() {
  const oldCoach = await makeCoach("leak-old-coach");
  const newCoach = await makeCoach("leak-new-coach");
  const { profile } = await makeAthlete("leak-athlete");
  // Old (ended) relationship — this is who actually created the historical assignments.
  await CoachAthleteAssignment.create({ coachId: oldCoach._id, athleteId: profile._id, assignedBy: oldCoach._id, status: "ended", endedAt: new Date() });
  // New (active) relationship — the coach making the request today.
  await CoachAthleteAssignment.create({ coachId: newCoach._id, athleteId: profile._id, assignedBy: newCoach._id, status: "active" });
  return { oldCoach, newCoach, profile };
}

describe("workout-assignment cross-coach leak (fixed)", () => {
  test("the new coach's list view does NOT include the previous coach's assignment", async () => {
    const { oldCoach, newCoach, profile } = await setupSwitchedAthlete();
    const template = await WorkoutTemplate.create({ ownerId: oldCoach._id, ownerRole: "coach", name: "Old Coach's Program", exercises: [{ title: "Squat", type: "reps", reps: "10", order: 0 }] });
    const scheduledDate = new Date();
    const oldAssignment = await assignTemplateToAthlete({
      template,
      assignedTo: profile._id,
      assignedBy: oldCoach._id,
      assignedByRole: "coach",
      scheduledDate,
      slot: null,
    });

    const res = await request(buildApp())
      .get(`/api/coach/athletes/${profile._id.toString()}/workout-assignments?date=${scheduledDate.toISOString().slice(0, 10)}`)
      .set("Authorization", `Bearer ${tokenFor(newCoach._id, "coach")}`);
    expect(res.status).toBe(200);
    expect(res.body.assignments.some((a: { id: string }) => a.id === oldAssignment._id.toString())).toBe(false);
  });

  test("the new coach cannot fetch the previous coach's assignment by id directly", async () => {
    const { oldCoach, newCoach, profile } = await setupSwitchedAthlete();
    const template = await WorkoutTemplate.create({ ownerId: oldCoach._id, ownerRole: "coach", name: "Old Coach's Program", exercises: [{ title: "Squat", type: "reps", reps: "10", order: 0 }] });
    const oldAssignment = await assignTemplateToAthlete({
      template,
      assignedTo: profile._id,
      assignedBy: oldCoach._id,
      assignedByRole: "coach",
      scheduledDate: new Date(),
      slot: null,
    });

    const res = await request(buildApp())
      .get(`/api/coach/workout-assignments/${oldAssignment._id.toString()}`)
      .set("Authorization", `Bearer ${tokenFor(newCoach._id, "coach")}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("not_in_assignments");
  });

  test("the daily-card endpoint's embedded workoutAssignments also excludes the previous coach's assignment", async () => {
    const { oldCoach, newCoach, profile } = await setupSwitchedAthlete();
    const template = await WorkoutTemplate.create({ ownerId: oldCoach._id, ownerRole: "coach", name: "Old Coach's Program", exercises: [{ title: "Squat", type: "reps", reps: "10", order: 0 }] });
    const scheduledDate = new Date();
    const oldAssignment = await assignTemplateToAthlete({
      template,
      assignedTo: profile._id,
      assignedBy: oldCoach._id,
      assignedByRole: "coach",
      scheduledDate,
      slot: null,
    });

    const res = await request(buildApp())
      .get(`/api/coach/athletes/${profile._id.toString()}/daily-card?date=${scheduledDate.toISOString().slice(0, 10)}`)
      .set("Authorization", `Bearer ${tokenFor(newCoach._id, "coach")}`);
    expect(res.status).toBe(200);
    expect(res.body.workoutAssignments.some((a: { id: string }) => a.id === oldAssignment._id.toString())).toBe(false);
  });

  test("the coach who actually created the assignment still sees it fine (no over-correction)", async () => {
    const coach = await makeCoach("own-assignment-coach");
    const { profile } = await makeAthlete("own-assignment-athlete");
    await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id, status: "active" });
    const template = await WorkoutTemplate.create({ ownerId: coach._id, ownerRole: "coach", name: "My Program", exercises: [{ title: "Squat", type: "reps", reps: "10", order: 0 }] });
    const assignment = await assignTemplateToAthlete({
      template,
      assignedTo: profile._id,
      assignedBy: coach._id,
      assignedByRole: "coach",
      scheduledDate: new Date(),
      slot: null,
    });

    const res = await request(buildApp())
      .get(`/api/coach/workout-assignments/${assignment._id.toString()}`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);
    expect(res.status).toBe(200);
    expect(res.body.assignment.id).toBe(assignment._id.toString());
  });
});

describe("meal-plan-assignment cross-coach leak (fixed)", () => {
  test("the new coach's list view does NOT include the previous coach's meal plan assignment", async () => {
    const { oldCoach, newCoach, profile } = await setupSwitchedAthlete();
    const plan = await MealPlan.create({
      ownerId: oldCoach._id,
      name: "Old Coach's Plan",
      durationDays: 1,
      days: [{ dayIndex: 0, meals: [{ mealType: "lunch", foods: [{ name: "Chicken Bowl", quantity: 1, unit: "serving", calories: 500, proteinG: 40, carbsG: 30, fatG: 15 }] }] }],
      version: 1,
    });
    const oldAssignment = await assignMealPlanToAthlete({ plan, assignedTo: profile._id, assignedBy: oldCoach._id, startDate: new Date() });

    const res = await request(buildApp())
      .get(`/api/coach/athletes/${profile._id.toString()}/meal-plan-assignments`)
      .set("Authorization", `Bearer ${tokenFor(newCoach._id, "coach")}`);
    expect(res.status).toBe(200);
    expect(res.body.assignments.some((a: { id: string }) => a.id === oldAssignment._id.toString())).toBe(false);
  });

  test("the coach who actually created the meal-plan assignment still sees it (no over-correction)", async () => {
    const coach = await makeCoach("own-meal-plan-coach");
    const { profile } = await makeAthlete("own-meal-plan-athlete");
    await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id, status: "active" });
    const plan = await MealPlan.create({
      ownerId: coach._id,
      name: "My Plan",
      durationDays: 1,
      days: [{ dayIndex: 0, meals: [{ mealType: "lunch", foods: [{ name: "Chicken Bowl", quantity: 1, unit: "serving", calories: 500, proteinG: 40, carbsG: 30, fatG: 15 }] }] }],
      version: 1,
    });
    const assignment = await assignMealPlanToAthlete({ plan, assignedTo: profile._id, assignedBy: coach._id, startDate: new Date() });

    const res = await request(buildApp())
      .get(`/api/coach/athletes/${profile._id.toString()}/meal-plan-assignments`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);
    expect(res.status).toBe(200);
    expect(res.body.assignments.some((a: { id: string }) => a.id === assignment._id.toString())).toBe(true);
  });
});
