import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { MealScan } from "../src/models/MealScan";
import { Meal } from "../src/models/Meal";
import nutritionRouter from "../src/routes/nutrition";
import { signAccessToken } from "../src/lib/tokens";
import { setMealVisionConverterForTests, type MealVisionConverter } from "../src/services/mealVisionConverter";

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
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

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
  setMealVisionConverterForTests(null); // reset to default mock adapter each test
});

describe("Meal scan — AI never writes trusted consumed nutrition directly", () => {
  test("upload -> needs_review (never auto-confirmed, even with the mock's output)", async () => {
    const { user } = await makeAthlete("scan-basic");
    const res = await request(buildApp())
      .post("/api/athlete/nutrition/meal-scan")
      .set("Authorization", `Bearer ${tokenFor(user._id)}`)
      .attach("file", PNG_BYTES, { filename: "plate.png", contentType: "image/png" });

    expect(res.status).toBe(201);
    expect(res.body.scan.status).toBe("needs_review");
    expect(res.body.scan.items.length).toBeGreaterThan(0);
    expect(await Meal.countDocuments({})).toBe(0); // nothing became a Meal yet
  });

  test("confirm creates a Meal from the REVIEWED/EDITED items the User submits — not the raw scan values", async () => {
    const { user, profile } = await makeAthlete("scan-edit");
    const app = buildApp();
    const token = `Bearer ${tokenFor(user._id)}`;
    const upload = await request(app)
      .post("/api/athlete/nutrition/meal-scan")
      .set("Authorization", token)
      .attach("file", PNG_BYTES, { filename: "plate.png", contentType: "image/png" });
    const scanId = upload.body.scan.id;
    const rawCalories = upload.body.scan.items[0].calories;

    // User edits the AI's estimate before confirming — this is the review step.
    const editedCalories = rawCalories + 250;
    const confirm = await request(app)
      .post(`/api/athlete/nutrition/meal-scan/${scanId}/confirm`)
      .set("Authorization", token)
      .send({
        date: "2026-08-14",
        mealType: "lunch",
        foods: [{ name: "Corrected Food Name", quantity: 1, unit: "serving", calories: editedCalories, proteinG: 30, carbsG: 40, fatG: 10 }],
      });
    expect(confirm.status).toBe(201);
    expect(confirm.body.meal.foods[0].calories).toBe(editedCalories);
    expect(confirm.body.meal.foods[0].name).toBe("Corrected Food Name");
    expect(confirm.body.meal.source).toBe("meal_scan");

    const scan = await MealScan.findById(scanId).lean();
    expect(scan!.status).toBe("confirmed");
    expect((scan!.confirmedMealId as Types.ObjectId).toString()).toBe(confirm.body.meal.id);
  });

  test("cannot confirm a scan twice, and cannot confirm while still processing", async () => {
    const { user } = await makeAthlete("scan-double");
    const app = buildApp();
    const token = `Bearer ${tokenFor(user._id)}`;
    const upload = await request(app).post("/api/athlete/nutrition/meal-scan").set("Authorization", token).attach("file", PNG_BYTES, { filename: "p.png", contentType: "image/png" });
    const scanId = upload.body.scan.id;
    const body = { date: "2026-08-14", mealType: "lunch", foods: [{ name: "X", quantity: 1, unit: "serving", calories: 300, proteinG: 10, carbsG: 30, fatG: 10 }] };

    const first = await request(app).post(`/api/athlete/nutrition/meal-scan/${scanId}/confirm`).set("Authorization", token).send(body);
    expect(first.status).toBe(201);
    const second = await request(app).post(`/api/athlete/nutrition/meal-scan/${scanId}/confirm`).set("Authorization", token).send(body);
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("already_confirmed");

    const stillProcessing = await MealScan.create({ athleteId: (await AthleteProfile.findOne({ userId: user._id }))!._id, storedFilename: "x.png", originalName: "x.png", mimeType: "image/png", sizeBytes: 10, status: "processing" });
    const res = await request(app).post(`/api/athlete/nutrition/meal-scan/${stillProcessing._id}/confirm`).set("Authorization", token).send(body);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("scan_still_processing");
  });

  test("when the vision call fails, the scan is rejected with an error — never left stuck in 'processing' forever", async () => {
    const failingConverter: MealVisionConverter = {
      async convert() {
        throw new Error("provider_timeout");
      },
    };
    setMealVisionConverterForTests(failingConverter);

    const { user } = await makeAthlete("scan-fail");
    const res = await request(buildApp())
      .post("/api/athlete/nutrition/meal-scan")
      .set("Authorization", `Bearer ${tokenFor(user._id)}`)
      .attach("file", PNG_BYTES, { filename: "plate.png", contentType: "image/png" });

    expect(res.status).toBe(201);
    expect(res.body.scan.status).toBe("rejected");
    expect(res.body.scan.error).toBe("provider_timeout");
  });

  test("when the vision call finds nothing, status is no_food_detected with zero items — never invents a food", async () => {
    const emptyConverter: MealVisionConverter = {
      async convert() {
        return { items: [] };
      },
    };
    setMealVisionConverterForTests(emptyConverter);

    const { user } = await makeAthlete("scan-empty");
    const res = await request(buildApp())
      .post("/api/athlete/nutrition/meal-scan")
      .set("Authorization", `Bearer ${tokenFor(user._id)}`)
      .attach("file", PNG_BYTES, { filename: "plate.png", contentType: "image/png" });

    expect(res.status).toBe(201);
    expect(res.body.scan.status).toBe("no_food_detected");
    expect(res.body.scan.items).toHaveLength(0);
    expect(res.body.scan.overallConfidence).toBe(0);
  });

  test("when the model explicitly reports no food in the image, status is no_food_detected", async () => {
    const noFoodConverter: MealVisionConverter = {
      async convert() {
        return {
          containsFood: false,
          isImageClear: true,
          items: [{ foodName: "Chair", quantity: 1, unit: "serving", calories: 100, proteinG: 1, carbsG: 1, fatG: 1, foodConfidence: 0.9, quantityConfidence: 0.9 }],
        };
      },
    };
    setMealVisionConverterForTests(noFoodConverter);

    const { user } = await makeAthlete("scan-no-food");
    const res = await request(buildApp())
      .post("/api/athlete/nutrition/meal-scan")
      .set("Authorization", `Bearer ${tokenFor(user._id)}`)
      .attach("file", PNG_BYTES, { filename: "plate.png", contentType: "image/png" });

    expect(res.status).toBe(201);
    expect(res.body.scan.status).toBe("no_food_detected");
    expect(res.body.scan.items).toHaveLength(0);
  });

  test("when the model flags the image as too unclear to assess, status is low_quality", async () => {
    const blurryConverter: MealVisionConverter = {
      async convert() {
        return { containsFood: true, isImageClear: false, items: [] };
      },
    };
    setMealVisionConverterForTests(blurryConverter);

    const { user } = await makeAthlete("scan-blurry");
    const res = await request(buildApp())
      .post("/api/athlete/nutrition/meal-scan")
      .set("Authorization", `Bearer ${tokenFor(user._id)}`)
      .attach("file", PNG_BYTES, { filename: "plate.png", contentType: "image/png" });

    expect(res.status).toBe(201);
    expect(res.body.scan.status).toBe("low_quality");
    expect(res.body.scan.items).toHaveLength(0);
  });

  test("when detected items fall below the usable confidence threshold, status is low_confidence and nothing is persisted as reviewable", async () => {
    const uncertainConverter: MealVisionConverter = {
      async convert() {
        return {
          containsFood: true,
          isImageClear: true,
          items: [{ foodName: "Something", quantity: 1, unit: "serving", calories: 100, proteinG: 5, carbsG: 5, fatG: 5, foodConfidence: 0.1, quantityConfidence: 0.1 }],
        };
      },
    };
    setMealVisionConverterForTests(uncertainConverter);

    const { user } = await makeAthlete("scan-uncertain");
    const res = await request(buildApp())
      .post("/api/athlete/nutrition/meal-scan")
      .set("Authorization", `Bearer ${tokenFor(user._id)}`)
      .attach("file", PNG_BYTES, { filename: "plate.png", contentType: "image/png" });

    expect(res.status).toBe(201);
    expect(res.body.scan.status).toBe("low_confidence");
    expect(res.body.scan.items).toHaveLength(0);
    expect(res.body.scan.overallConfidence).toBe(0.1);
  });

  test("a low-confidence/malformed item from the model is dropped, never persisted with an invented value", async () => {
    const partialConverter: MealVisionConverter = {
      async convert() {
        return {
          items: [
            // Missing calories entirely — must be dropped, not defaulted to 0 or guessed.
            { foodName: "Mystery Item", quantity: 1, unit: "serving", proteinG: 10, carbsG: 10, fatG: 5, foodConfidence: 0.3, quantityConfidence: 0.2 } as never,
            { foodName: "Valid Item", quantity: 1, unit: "serving", calories: 200, proteinG: 10, carbsG: 20, fatG: 5, foodConfidence: 0.9, quantityConfidence: 0.9 },
          ],
        };
      },
    };
    setMealVisionConverterForTests(partialConverter);

    const { user } = await makeAthlete("scan-partial");
    const res = await request(buildApp())
      .post("/api/athlete/nutrition/meal-scan")
      .set("Authorization", `Bearer ${tokenFor(user._id)}`)
      .attach("file", PNG_BYTES, { filename: "plate.png", contentType: "image/png" });

    expect(res.body.scan.items).toHaveLength(1);
    expect(res.body.scan.items[0].foodName).toBe("Valid Item");
  });

  test("an unrelated athlete cannot view or confirm someone else's scan", async () => {
    const { user: owner } = await makeAthlete("scan-owner");
    const { user: stranger } = await makeAthlete("scan-stranger");
    const app = buildApp();
    const upload = await request(app).post("/api/athlete/nutrition/meal-scan").set("Authorization", `Bearer ${tokenFor(owner._id)}`).attach("file", PNG_BYTES, { filename: "p.png", contentType: "image/png" });
    const scanId = upload.body.scan.id;

    const view = await request(app).get(`/api/athlete/nutrition/meal-scan/${scanId}`).set("Authorization", `Bearer ${tokenFor(stranger._id)}`);
    expect(view.status).toBe(404);

    const confirm = await request(app)
      .post(`/api/athlete/nutrition/meal-scan/${scanId}/confirm`)
      .set("Authorization", `Bearer ${tokenFor(stranger._id)}`)
      .send({ date: "2026-08-14", mealType: "lunch", foods: [{ name: "X", quantity: 1, unit: "serving", calories: 100, proteinG: 1, carbsG: 1, fatG: 1 }] });
    expect(confirm.status).toBe(404);
  });
});
