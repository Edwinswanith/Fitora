import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { PlannedMeal } from "../src/models/PlannedMeal";
import { Meal } from "../src/models/Meal";
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
function tokenFor(id: Types.ObjectId) {
  return signAccessToken({ sub: id.toString(), role: "athlete" });
}
const TODAY = "2026-08-14";
const CHICKEN_RICE_BOWL = [{ name: "Chicken Rice Bowl", quantity: 1, unit: "serving", calories: 620, proteinG: 45, carbsG: 60, fatG: 18 }];

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

describe("PlannedMeal vs Meal — strict separation (Scenario F)", () => {
  test("planning lunch does NOT add calories to consumed totals; logging it 'as eaten' does", async () => {
    const { user, profile } = await makeAthlete("planvconsume");
    const app = buildApp();
    const token = `Bearer ${tokenFor(user._id)}`;

    const planned = await PlannedMeal.create({
      athleteId: profile._id,
      date: new Date(`${TODAY}T00:00:00.000Z`),
      mealType: "lunch",
      source: "deterministic",
      name: "Chicken Rice Bowl",
      foods: CHICKEN_RICE_BOWL,
    });

    // Planned meal exists...
    const plannedRes = await request(app).get(`/api/athlete/nutrition/planned-meals?date=${TODAY}`).set("Authorization", token);
    expect(plannedRes.body.plannedMeals).toHaveLength(1);

    // ...but consumed totals are still zero — a plan is not intake.
    const beforeLog = await request(app).get(`/api/athlete/nutrition/meals?date=${TODAY}`).set("Authorization", token);
    expect(beforeLog.body.totals.calories).toBe(0);
    expect(beforeLog.body.meals).toHaveLength(0);

    // User explicitly logs it as eaten.
    const logRes = await request(app)
      .post("/api/athlete/nutrition/meals")
      .set("Authorization", token)
      .send({ date: TODAY, mealType: "lunch", source: "confirmed_from_plan", plannedMealId: planned._id.toString(), foods: CHICKEN_RICE_BOWL });
    expect(logRes.status).toBe(201);

    const afterLog = await request(app).get(`/api/athlete/nutrition/meals?date=${TODAY}`).set("Authorization", token);
    expect(afterLog.body.totals.calories).toBe(620);
    expect(afterLog.body.meals[0].plannedMealId).toBe(planned._id.toString());
  });

  test("a User can log a completely different meal than what was planned (substitution) — planned row is untouched", async () => {
    const { user, profile } = await makeAthlete("substitute");
    const app = buildApp();
    const token = `Bearer ${tokenFor(user._id)}`;
    const planned = await PlannedMeal.create({
      athleteId: profile._id,
      date: new Date(`${TODAY}T00:00:00.000Z`),
      mealType: "dinner",
      foods: CHICKEN_RICE_BOWL,
    });

    const res = await request(app)
      .post("/api/athlete/nutrition/meals")
      .set("Authorization", token)
      .send({ date: TODAY, mealType: "dinner", source: "ad_hoc", foods: [{ name: "Pizza Slice", quantity: 2, unit: "slice", calories: 500, proteinG: 20, carbsG: 55, fatG: 18 }] });
    expect(res.status).toBe(201);
    expect(res.body.meal.plannedMealId).toBeNull();

    const stillPlanned = await PlannedMeal.findById(planned._id).lean();
    expect(stillPlanned!.foods).toHaveLength(1);
    expect((stillPlanned!.foods[0] as { name: string }).name).toBe("Chicken Rice Bowl");
  });

  test("skipping the plan entirely leaves consumed totals at zero for that day", async () => {
    const { user, profile } = await makeAthlete("skipper");
    await PlannedMeal.create({ athleteId: profile._id, date: new Date(`${TODAY}T00:00:00.000Z`), mealType: "breakfast", foods: CHICKEN_RICE_BOWL });
    const res = await request(buildApp()).get(`/api/athlete/nutrition/meals?date=${TODAY}`).set("Authorization", `Bearer ${tokenFor(user._id)}`);
    expect(res.body.totals).toEqual({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0 });
  });

  test("logging a partial quantity of the planned meal is a User choice, not a system assumption", async () => {
    const { user, profile } = await makeAthlete("partial");
    const app = buildApp();
    const token = `Bearer ${tokenFor(user._id)}`;
    const planned = await PlannedMeal.create({ athleteId: profile._id, date: new Date(`${TODAY}T00:00:00.000Z`), mealType: "lunch", foods: CHICKEN_RICE_BOWL });

    const res = await request(app)
      .post("/api/athlete/nutrition/meals")
      .set("Authorization", token)
      .send({
        date: TODAY, mealType: "lunch", source: "modified_from_plan", plannedMealId: planned._id.toString(),
        foods: [{ name: "Chicken Rice Bowl (half)", quantity: 0.5, unit: "serving", calories: 310, proteinG: 22.5, carbsG: 30, fatG: 9 }],
      });
    expect(res.status).toBe(201);
    expect(res.body.meal.foods[0].calories).toBe(310);
  });
});

describe("Meal PATCH/DELETE and scope", () => {
  test("PATCH edits foods and flips source confirmed_from_plan -> modified_from_plan", async () => {
    const { user } = await makeAthlete("editor");
    const app = buildApp();
    const token = `Bearer ${tokenFor(user._id)}`;
    const created = await request(app).post("/api/athlete/nutrition/meals").set("Authorization", token).send({ date: TODAY, mealType: "lunch", source: "confirmed_from_plan", foods: CHICKEN_RICE_BOWL });

    const patched = await request(app)
      .patch(`/api/athlete/nutrition/meals/${created.body.meal.id}`)
      .set("Authorization", token)
      .send({ foods: [{ name: "Extra rice", quantity: 1, unit: "serving", calories: 700, proteinG: 45, carbsG: 80, fatG: 18 }] });
    expect(patched.status).toBe(200);
    expect(patched.body.meal.source).toBe("modified_from_plan");
    expect(patched.body.meal.foods[0].calories).toBe(700);
  });

  test("DELETE removes the meal and its foods", async () => {
    const { user } = await makeAthlete("deleter");
    const app = buildApp();
    const token = `Bearer ${tokenFor(user._id)}`;
    const created = await request(app).post("/api/athlete/nutrition/meals").set("Authorization", token).send({ date: TODAY, mealType: "snack", source: "ad_hoc", foods: CHICKEN_RICE_BOWL });

    const del = await request(app).delete(`/api/athlete/nutrition/meals/${created.body.meal.id}`).set("Authorization", token);
    expect(del.status).toBe(200);
    expect(await Meal.countDocuments({})).toBe(0);
  });

  test("an athlete cannot view, edit, or delete another athlete's meal", async () => {
    const { user: owner } = await makeAthlete("meal-owner");
    const { user: stranger } = await makeAthlete("meal-stranger");
    const app = buildApp();
    const created = await request(app).post("/api/athlete/nutrition/meals").set("Authorization", `Bearer ${tokenFor(owner._id)}`).send({ date: TODAY, mealType: "lunch", source: "ad_hoc", foods: CHICKEN_RICE_BOWL });

    const strangerToken = `Bearer ${tokenFor(stranger._id)}`;
    const patch = await request(app).patch(`/api/athlete/nutrition/meals/${created.body.meal.id}`).set("Authorization", strangerToken).send({ name: "hijack" });
    expect(patch.status).toBe(404);
    const del = await request(app).delete(`/api/athlete/nutrition/meals/${created.body.meal.id}`).set("Authorization", strangerToken);
    expect(del.status).toBe(404);

    const strangerDaily = await request(app).get(`/api/athlete/nutrition/meals?date=${TODAY}`).set("Authorization", strangerToken);
    expect(strangerDaily.body.meals).toHaveLength(0);
  });

  test("invalid macro values are rejected (out-of-range calories, missing name)", async () => {
    const { user } = await makeAthlete("badinput");
    const res = await request(buildApp())
      .post("/api/athlete/nutrition/meals")
      .set("Authorization", `Bearer ${tokenFor(user._id)}`)
      .send({ date: TODAY, mealType: "lunch", source: "ad_hoc", foods: [{ name: "", quantity: 1, unit: "g", calories: 999999, proteinG: 1, carbsG: 1, fatG: 1 }] });
    expect(res.status).toBe(400);
  });
});
