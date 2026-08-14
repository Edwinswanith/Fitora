import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { PlannedMeal } from "../src/models/PlannedMeal";
import { Routine } from "../src/models/Routine";
import athleteRouter from "../src/routes/athlete";
import nutritionRouter from "../src/routes/nutrition";
import { signAccessToken } from "../src/lib/tokens";
import { MEAL_LIBRARY } from "../src/lib/mealLibrary";

let mongo: MongoMemoryServer;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/athlete", athleteRouter);
  app.use("/api/athlete/nutrition", nutritionRouter);
  return app;
}
async function makeCompleteAthlete(name: string) {
  const user = await User.create({ email: `${name}@test.io`, passwordHash: "x", role: "athlete", name });
  const profile = await AthleteProfile.create({ userId: user._id, sport: "general" });
  return { user, profile };
}
function tokenFor(id: Types.ObjectId) {
  return signAccessToken({ sub: id.toString(), role: "athlete" });
}
async function setupTarget(app: express.Express, token: string, extra: Record<string, unknown> = {}) {
  await request(app).patch("/api/athlete/me").set("Authorization", token).send({
    heightCm: 175, weightKg: 75, dob: "1994-04-04",
    biologicalSex: "male", activityLevel: "moderate", fitnessGoal: "maintain_weight", goalIntensity: "mild",
    ...extra,
  });
  await request(app).post("/api/athlete/nutrition/target/recalculate").set("Authorization", token);
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

describe("Deterministic 7-day routine generation", () => {
  test("requires a current nutrition target to exist first", async () => {
    const { user } = await makeCompleteAthlete("no-target");
    const res = await request(buildApp())
      .post("/api/athlete/nutrition/routine/generate")
      .set("Authorization", `Bearer ${tokenFor(user._id)}`)
      .send({ durationDays: 7 });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("no_active_nutrition_target");
  });

  test("generates exactly 28 planned meals for a 7-day plan (4 slots x 7 days), no AI call in the path", async () => {
    const { user, profile } = await makeCompleteAthlete("routine7");
    const app = buildApp();
    const token = `Bearer ${tokenFor(user._id)}`;
    await setupTarget(app, token);

    const res = await request(app)
      .post("/api/athlete/nutrition/routine/generate")
      .set("Authorization", token)
      .send({ startDate: "2026-08-14", durationDays: 7 });
    expect(res.status).toBe(201);
    expect(res.body.routine.generatedBy).toBe("deterministic");
    expect(res.body.routine.plannedMealIds).toHaveLength(28);
    expect(await PlannedMeal.countDocuments({ athleteId: profile._id })).toBe(28);
  });

  test("regenerating the same range replaces the plan rather than accumulating duplicates", async () => {
    const { user, profile } = await makeCompleteAthlete("regen");
    const app = buildApp();
    const token = `Bearer ${tokenFor(user._id)}`;
    await setupTarget(app, token);

    await request(app).post("/api/athlete/nutrition/routine/generate").set("Authorization", token).send({ startDate: "2026-08-14", durationDays: 7 });
    await request(app).post("/api/athlete/nutrition/routine/generate").set("Authorization", token).send({ startDate: "2026-08-14", durationDays: 7 });

    // Still 28 PlannedMeal rows, not 56 — the (athleteId,date,mealType) unique
    // index + upsert means regeneration overwrites, never duplicates.
    expect(await PlannedMeal.countDocuments({ athleteId: profile._id })).toBe(28);
    expect(await Routine.countDocuments({ athleteId: profile._id })).toBe(2); // two Routine pointer docs, sharing the same PlannedMeal rows
  });

  test("SAFETY: never selects a meal containing an allergen the User has, even across a full 30-day plan", async () => {
    const { user, profile } = await makeCompleteAthlete("allergic");
    const app = buildApp();
    const token = `Bearer ${tokenFor(user._id)}`;
    // Dairy is common enough in the library that this is a meaningful test of
    // the fallback chain actually excluding it rather than silently ignoring
    // the constraint once preferences get relaxed.
    await setupTarget(app, token, { allergies: ["dairy", "gluten"] });

    const res = await request(app)
      .post("/api/athlete/nutrition/routine/generate")
      .set("Authorization", token)
      .send({ startDate: "2026-08-14", durationDays: 30 });
    expect(res.status).toBe(201);

    const plannedMeals = await PlannedMeal.find({ athleteId: profile._id }).lean();
    expect(plannedMeals.length).toBe(120);
    const dairyOrGlutenEntryIds = new Set(
      MEAL_LIBRARY.filter((e) => e.allergens.includes("dairy") || e.allergens.includes("gluten")).map((e) => e.name)
    );
    for (const pm of plannedMeals) {
      expect(dairyOrGlutenEntryIds.has(pm.name as string)).toBe(false);
    }
  });

  test("diet preference filters the pool but never produces an empty/blocked plan even if no meal is a perfect match", async () => {
    const { user, profile } = await makeCompleteAthlete("vegan-cuisine");
    const app = buildApp();
    const token = `Bearer ${tokenFor(user._id)}`;
    // vegan + a cuisine combination unlikely to have many/any exact matches —
    // proves the fallback chain (relax cuisine, then diet) still returns a
    // full plan rather than leaving the User blocked.
    await setupTarget(app, token, { dietaryPreferences: ["vegan"], cuisinePreferences: ["mexican"] });

    const res = await request(app)
      .post("/api/athlete/nutrition/routine/generate")
      .set("Authorization", token)
      .send({ startDate: "2026-08-14", durationDays: 7 });
    expect(res.status).toBe(201);
    expect(await PlannedMeal.countDocuments({ athleteId: profile._id })).toBe(28);
  });

  test("only accepts 7, 14, or 30 as durationDays", async () => {
    const { user } = await makeCompleteAthlete("baddur");
    const app = buildApp();
    const token = `Bearer ${tokenFor(user._id)}`;
    await setupTarget(app, token);
    const res = await request(app).post("/api/athlete/nutrition/routine/generate").set("Authorization", token).send({ durationDays: 5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_durationDays");
  });

  test("GET /routine returns the most recently generated routine", async () => {
    const { user } = await makeCompleteAthlete("getroutine");
    const app = buildApp();
    const token = `Bearer ${tokenFor(user._id)}`;
    await setupTarget(app, token);
    await request(app).post("/api/athlete/nutrition/routine/generate").set("Authorization", token).send({ startDate: "2026-08-14", durationDays: 7 });

    const res = await request(app).get("/api/athlete/nutrition/routine").set("Authorization", token);
    expect(res.status).toBe(200);
    expect(res.body.routine.durationDays).toBe(7);
    expect(res.body.routine.plannedMealIds).toHaveLength(28);
  });
});
