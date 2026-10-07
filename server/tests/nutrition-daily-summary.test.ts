import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { Meal } from "../src/models/Meal";
import { MealFood } from "../src/models/MealFood";
import nutritionRouter from "../src/routes/nutrition";
import { signAccessToken } from "../src/lib/tokens";

let mongo: MongoMemoryServer;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/athlete/nutrition", nutritionRouter);
  return app;
}
async function makeAthlete(name: string) {
  const user = await User.create({ email: `${name}@test.io`, passwordHash: "x", role: "athlete", name });
  const profile = await AthleteProfile.create({ userId: user._id, sport: "general" });
  return { user, profile };
}
const auth = (id: Types.ObjectId) => `Bearer ${signAccessToken({ sub: id.toString(), role: "athlete" })}`;

async function logMeal(athleteId: Types.ObjectId, day: string, calories: number, proteinG: number) {
  const meal = await Meal.create({ athleteId, date: new Date(`${day}T00:00:00.000Z`), mealType: "lunch", source: "ad_hoc" });
  await MealFood.create({ mealId: meal._id, name: "Food", quantity: 1, unit: "serving", calories, proteinG, carbsG: 0, fatG: 0 });
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

describe("GET /nutrition/daily-summary", () => {
  test("sums each day in the range, inclusive, and only for the requesting athlete", async () => {
    const app = buildApp();
    const { user, profile } = await makeAthlete("sum-a");
    const other = await makeAthlete("sum-b");
    await logMeal(profile._id, "2026-09-01", 500, 30);
    await logMeal(profile._id, "2026-09-01", 300, 20);
    await logMeal(profile._id, "2026-09-10", 700, 40);
    await logMeal(profile._id, "2026-09-11", 900, 50); // outside the range
    await logMeal(other.profile._id, "2026-09-01", 1000, 60);

    const res = await request(app).get("/api/athlete/nutrition/daily-summary?from=2026-09-01&to=2026-09-10").set("Authorization", auth(user._id));
    expect(res.status).toBe(200);
    expect(res.body.days).toEqual([
      { date: "2026-09-01", loggedMeals: 2, calories: 800, proteinG: 50 },
      { date: "2026-09-10", loggedMeals: 1, calories: 700, proteinG: 40 },
    ]);
  });

  test("rejects a missing, reversed or too-long range", async () => {
    const app = buildApp();
    const { user } = await makeAthlete("sum-c");
    const get = (q: string) => request(app).get(`/api/athlete/nutrition/daily-summary${q}`).set("Authorization", auth(user._id));
    expect((await get("")).status).toBe(400);
    expect((await get("?from=2026-09-10&to=2026-09-01")).status).toBe(400);
    expect((await get("?from=2026-01-01&to=2026-09-01")).body.error).toBe("range_too_long");
  });
});
