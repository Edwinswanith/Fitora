import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { NutritionTarget } from "../src/models/NutritionTarget";
import athleteRouter from "../src/routes/athlete";
import nutritionRouter from "../src/routes/nutrition";
import { signAccessToken } from "../src/lib/tokens";
import { calculateNutritionTarget, computeBMR, macrosReconcileToCalories } from "../src/services/nutritionEngine";

let mongo: MongoMemoryServer;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/athlete", athleteRouter);
  app.use("/api/athlete/nutrition", nutritionRouter);
  return app;
}
async function makeAthlete(name: string) {
  const user = await User.create({ email: `${name}@test.io`, passwordHash: "x", role: "athlete", name });
  const profile = await AthleteProfile.create({ userId: user._id, sport: "general" });
  return { user, profile };
}
function tokenFor(id: Types.ObjectId) {
  return signAccessToken({ sub: id.toString(), role: "athlete" });
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

describe("Deterministic calculation (services/nutritionEngine.ts)", () => {
  test("BMR (Mifflin-St Jeor) matches hand-computed values for known inputs", () => {
    // Male, 80kg, 180cm, 30yo: 10*80 + 6.25*180 - 5*30 + 5 = 800+1125-150+5 = 1780
    expect(computeBMR({ weightKg: 80, heightCm: 180, age: 30, biologicalSex: "male" })).toBe(1780);
    // Female, 60kg, 165cm, 25yo: 10*60 + 6.25*165 - 5*25 - 161 = 600+1031.25-125-161 = 1345.25
    expect(computeBMR({ weightKg: 60, heightCm: 165, age: 25, biologicalSex: "female" })).toBeCloseTo(1345.25, 1);
  });

  test("same input always produces the same output (deterministic, not AI)", () => {
    const input = {
      weightKg: 75, heightCm: 175, age: 28, biologicalSex: "male" as const,
      activityLevel: "moderate" as const, goal: "lose_weight" as const, goalIntensity: "moderate" as const,
    };
    const r1 = calculateNutritionTarget(input);
    const r2 = calculateNutritionTarget(input);
    expect(r1).toEqual(r2);
  });

  test("macros reconcile to calories within tolerance for every goal/intensity combination", () => {
    const goals = ["lose_weight", "maintain_weight", "gain_weight"] as const;
    const intensities = ["mild", "moderate", "aggressive"] as const;
    for (const goal of goals) {
      for (const goalIntensity of intensities) {
        const result = calculateNutritionTarget({
          weightKg: 70, heightCm: 170, age: 35, biologicalSex: "female",
          activityLevel: "light", goal, goalIntensity,
        });
        expect(macrosReconcileToCalories(result.calories, result.proteinG, result.carbsG, result.fatG)).toBe(true);
      }
    }
  });

  test("safety guardrail: an aggressive deficit never drops below the absolute floor or BMR", () => {
    // A very light, low-BMI-adjacent input pushed to aggressive weight loss —
    // the raw TDEE-750 formula would go dangerously low without the guardrail.
    const result = calculateNutritionTarget({
      weightKg: 45, heightCm: 150, age: 55, biologicalSex: "female",
      activityLevel: "sedentary", goal: "lose_weight", goalIntensity: "aggressive",
    });
    const bmr = computeBMR({ weightKg: 45, heightCm: 150, age: 55, biologicalSex: "female" });
    expect(result.calories).toBeGreaterThanOrEqual(1200);
    expect(result.calories).toBeGreaterThanOrEqual(Math.round(bmr));
  });
});

describe("POST /api/athlete/nutrition/target/recalculate", () => {
  test("requires a complete profile — 422 with a clear error when fields are missing", async () => {
    const { user } = await makeAthlete("incomplete");
    const res = await request(buildApp())
      .post("/api/athlete/nutrition/target/recalculate")
      .set("Authorization", `Bearer ${tokenFor(user._id)}`);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("profile_incomplete_for_nutrition_target");
  });

  test("computes and persists a target once the profile is complete", async () => {
    const { user, profile } = await makeAthlete("complete");
    const app = buildApp();
    const token = `Bearer ${tokenFor(user._id)}`;

    await request(app).patch("/api/athlete/me").set("Authorization", token).send({
      heightCm: 178, weightKg: 75, dob: "1995-06-15",
      biologicalSex: "male", activityLevel: "moderate", fitnessGoal: "lose_weight", goalIntensity: "moderate",
    });

    const res = await request(app).post("/api/athlete/nutrition/target/recalculate").set("Authorization", token);
    expect(res.status).toBe(201);
    expect(res.body.target.calories).toBeGreaterThan(0);
    expect(res.body.target.effectiveTo).toBeNull();
    expect(await NutritionTarget.countDocuments({ athleteId: profile._id })).toBe(1);
  });
});

describe("Versioning — changing the goal must not rewrite history", () => {
  test("recalculating closes the prior target (effectiveTo set) and creates a new current one; historical date resolves the OLD target", async () => {
    const { user, profile } = await makeAthlete("versioned");
    const app = buildApp();
    const token = `Bearer ${tokenFor(user._id)}`;
    await request(app).patch("/api/athlete/me").set("Authorization", token).send({
      heightCm: 170, weightKg: 70, dob: "1990-01-01",
      biologicalSex: "female", activityLevel: "light", fitnessGoal: "lose_weight", goalIntensity: "moderate",
    });

    const august = await request(app).post("/api/athlete/nutrition/target/recalculate").set("Authorization", token);
    const augustCalories = august.body.target.calories;
    const augustId = august.body.target.id;

    // Manually backdate the August target's effectiveFrom so a later "historical
    // date" query in August genuinely predates the September recalculation.
    await NutritionTarget.updateOne({ _id: augustId }, { $set: { effectiveFrom: new Date("2026-08-01T00:00:00.000Z") } });

    await request(app).patch("/api/athlete/me").set("Authorization", token).send({ fitnessGoal: "maintain_weight", goalIntensity: "mild" });
    const september = await request(app).post("/api/athlete/nutrition/target/recalculate").set("Authorization", token);
    expect(september.body.target.calories).not.toBe(augustCalories);

    expect(await NutritionTarget.countDocuments({ athleteId: profile._id })).toBe(2);
    const closedAugust = await NutritionTarget.findById(augustId).lean();
    expect(closedAugust!.effectiveTo).not.toBeNull();

    // Current target is the September one.
    const current = await request(app).get("/api/athlete/nutrition/target").set("Authorization", token);
    expect(current.body.target.calories).toBe(september.body.target.calories);

    // A historical query for a date between the backdated effectiveFrom and
    // the real "now" the September recalculation closed it at resolves the
    // OLD (closed) target.
    const historical = await request(app)
      .get("/api/athlete/nutrition/target?date=2026-08-02")
      .set("Authorization", token);
    expect(historical.body.target.calories).toBe(augustCalories);
  });
});

describe("Stays in step with the profile (no manual recalculate)", () => {
  test("a weight change is picked up on the next read: new target, old one closed, breakdown explains it", async () => {
    const { user, profile } = await makeAthlete("auto-refresh");
    const app = buildApp();
    const token = `Bearer ${tokenFor(user._id)}`;
    await request(app).patch("/api/athlete/me").set("Authorization", token).send({
      heightCm: 178, weightKg: 75, dob: "1995-06-15",
      biologicalSex: "male", activityLevel: "moderate", fitnessGoal: "lose_weight", goalIntensity: "moderate",
    });

    // No explicit recalculate: the first read creates the target from the profile.
    const first = await request(app).get("/api/athlete/nutrition/target").set("Authorization", token);
    expect(first.body.target.calories).toBeGreaterThan(0);
    expect(first.body.target.breakdown).toMatchObject({ activityFactor: 1.55, goalDelta: -500, inputs: { weightKg: 75 } });
    expect(first.body.target.breakdown.calories).toBe(first.body.target.calories);

    await request(app).patch("/api/athlete/me").set("Authorization", token).send({ weightKg: 70 });
    const second = await request(app).get(`/api/athlete/nutrition/target?date=${new Date().toISOString().slice(0, 10)}`).set("Authorization", token);
    expect(second.body.target.calories).toBeLessThan(first.body.target.calories);
    expect(second.body.target.breakdown.inputs.weightKg).toBe(70);
    expect(await NutritionTarget.countDocuments({ athleteId: profile._id })).toBe(2);
    expect(await NutritionTarget.countDocuments({ athleteId: profile._id, effectiveTo: null })).toBe(1);

    // Reading again with nothing changed does not create another version.
    await request(app).get("/api/athlete/nutrition/target").set("Authorization", token);
    expect(await NutritionTarget.countDocuments({ athleteId: profile._id })).toBe(2);
  });

  test("clearing a required field keeps the last target instead of removing it", async () => {
    const { user } = await makeAthlete("incomplete-later");
    const app = buildApp();
    const token = `Bearer ${tokenFor(user._id)}`;
    await request(app).patch("/api/athlete/me").set("Authorization", token).send({
      heightCm: 165, weightKg: 60, dob: "1997-02-01",
      biologicalSex: "female", activityLevel: "light", fitnessGoal: "maintain_weight", goalIntensity: "mild",
    });
    const before = await request(app).get("/api/athlete/nutrition/target").set("Authorization", token);
    await request(app).patch("/api/athlete/me").set("Authorization", token).send({ weightKg: null });
    const after = await request(app).get("/api/athlete/nutrition/target").set("Authorization", token);
    expect(after.body.target.id).toBe(before.body.target.id);
  });
});

describe("Scope", () => {
  test("an athlete cannot see another athlete's nutrition target", async () => {
    const { user: userA } = await makeAthlete("scope-a");
    const { user: userB } = await makeAthlete("scope-b");
    const app = buildApp();
    await request(app).patch("/api/athlete/me").set("Authorization", `Bearer ${tokenFor(userA._id)}`).send({
      heightCm: 170, weightKg: 65, dob: "1992-03-03",
      biologicalSex: "female", activityLevel: "moderate", fitnessGoal: "maintain_weight", goalIntensity: "mild",
    });
    await request(app).post("/api/athlete/nutrition/target/recalculate").set("Authorization", `Bearer ${tokenFor(userA._id)}`);

    const asB = await request(app).get("/api/athlete/nutrition/target").set("Authorization", `Bearer ${tokenFor(userB._id)}`);
    expect(asB.status).toBe(200);
    expect(asB.body.target).toBeNull();
  });
});
