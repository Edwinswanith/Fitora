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

async function logMeal(athleteId: Types.ObjectId, day: string, calories: number, proteinG: number, macrosTracked = true) {
  const meal = await Meal.create({ athleteId, date: new Date(`${day}T00:00:00.000Z`), mealType: "lunch", source: "ad_hoc" });
  await MealFood.create({ mealId: meal._id, name: "Food", quantity: 1, unit: "serving", calories, proteinG, carbsG: 0, fatG: 0, macrosTracked });
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

describe("meals whose protein, carbs and fat were never entered", () => {
  test("are counted, so a 0 g total isn't read as real", async () => {
    const app = buildApp();
    const { user, profile } = await makeAthlete("macros-a");
    await logMeal(profile._id, "2026-09-02", 400, 0, false);
    await logMeal(profile._id, "2026-09-02", 500, 35);

    const summary = await request(app).get("/api/athlete/nutrition/daily-summary?from=2026-09-02&to=2026-09-02").set("Authorization", auth(user._id));
    expect(summary.body.days).toEqual([{ date: "2026-09-02", loggedMeals: 2, calories: 900, proteinG: 35, mealsMissingMacros: 1 }]);

    const day = await request(app).get("/api/athlete/nutrition/meals?date=2026-09-02").set("Authorization", auth(user._id));
    expect(day.body.totals).toMatchObject({ calories: 900, proteinG: 35, mealsMissingMacros: 1 });
    expect(day.body.meals.map((m: { foods: { macrosTracked: boolean }[] }) => m.foods[0].macrosTracked).sort()).toEqual([false, true]);
  });

  test("a meal logged with blank macros keeps that flag", async () => {
    const app = buildApp();
    const { user, profile } = await makeAthlete("macros-b");
    const food = { name: "Rice", quantity: 1, unit: "serving", calories: 300, proteinG: 0, carbsG: 0, fatG: 0 };
    const blank = await request(app).post("/api/athlete/nutrition/meals").set("Authorization", auth(user._id))
      .send({ date: "2026-09-03", mealType: "lunch", foods: [{ ...food, macrosTracked: false }] });
    expect(blank.status).toBe(201);
    const entered = await request(app).post("/api/athlete/nutrition/meals").set("Authorization", auth(user._id))
      .send({ date: "2026-09-03", mealType: "dinner", foods: [food] });
    expect(entered.status).toBe(201);
    const foods = await MealFood.find({ mealId: { $in: (await Meal.find({ athleteId: profile._id })).map((m) => m._id) } }).lean();
    expect(foods.map((f) => f.macrosTracked).sort()).toEqual([false, true]);
  });
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
      { date: "2026-09-01", loggedMeals: 2, calories: 800, proteinG: 50, mealsMissingMacros: 0 },
      { date: "2026-09-10", loggedMeals: 1, calories: 700, proteinG: 40, mealsMissingMacros: 0 },
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
