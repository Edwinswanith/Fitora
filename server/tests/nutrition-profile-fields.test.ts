import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import athleteRouter from "../src/routes/athlete";
import { signAccessToken } from "../src/lib/tokens";

let mongo: MongoMemoryServer;
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/athlete", athleteRouter);
  return app;
}
async function makeAthlete(name: string) {
  const user = await User.create({ email: `${name}@test.io`, passwordHash: "x", role: "athlete", name });
  await AthleteProfile.create({ userId: user._id, sport: "general" });
  return user;
}
function tokenFor(id: Types.ObjectId) {
  return signAccessToken({ sub: id.toString(), role: "athlete" });
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
});

describe("PATCH /api/athlete/me — new fitness/nutrition profile fields", () => {
  test("accepts valid enum values for fitnessGoal, goalIntensity, activityLevel, biologicalSex", async () => {
    const user = await makeAthlete("valid-enums");
    const res = await request(buildApp())
      .patch("/api/athlete/me")
      .set("Authorization", `Bearer ${tokenFor(user._id)}`)
      .send({ fitnessGoal: "gain_weight", goalIntensity: "aggressive", activityLevel: "very_active", biologicalSex: "female" });
    expect(res.status).toBe(200);
    expect(res.body.athlete.fitnessGoal).toBe("gain_weight");
    expect(res.body.athlete.goalIntensity).toBe("aggressive");
    expect(res.body.athlete.activityLevel).toBe("very_active");
    expect(res.body.athlete.biologicalSex).toBe("female");
  });

  test("rejects invalid enum values", async () => {
    const user = await makeAthlete("bad-enums");
    const app = buildApp();
    const token = `Bearer ${tokenFor(user._id)}`;

    const badGoal = await request(app).patch("/api/athlete/me").set("Authorization", token).send({ fitnessGoal: "get_shredded" });
    expect(badGoal.status).toBe(400);
    expect(badGoal.body.error).toBe("invalid_fitnessGoal");

    const badIntensity = await request(app).patch("/api/athlete/me").set("Authorization", token).send({ goalIntensity: "extreme" });
    expect(badIntensity.status).toBe(400);
    expect(badIntensity.body.error).toBe("invalid_goalIntensity");

    const badActivity = await request(app).patch("/api/athlete/me").set("Authorization", token).send({ activityLevel: "superhuman" });
    expect(badActivity.status).toBe(400);
    expect(badActivity.body.error).toBe("invalid_activityLevel");

    const badSex = await request(app).patch("/api/athlete/me").set("Authorization", token).send({ biologicalSex: "other" });
    expect(badSex.status).toBe(400);
    expect(badSex.body.error).toBe("invalid_biologicalSex");
  });

  test("array fields: accepts a clean list, rejects duplicates (case-insensitive) and malformed entries", async () => {
    const user = await makeAthlete("arrays");
    const app = buildApp();
    const token = `Bearer ${tokenFor(user._id)}`;

    const ok = await request(app)
      .patch("/api/athlete/me")
      .set("Authorization", token)
      .send({ dietaryPreferences: ["vegetarian", "vegan"], allergies: ["nuts", "dairy"], cuisinePreferences: ["indian"] });
    expect(ok.status).toBe(200);
    expect(ok.body.athlete.dietaryPreferences).toEqual(["vegetarian", "vegan"]);

    const dup = await request(app).patch("/api/athlete/me").set("Authorization", token).send({ allergies: ["nuts", "Nuts"] });
    expect(dup.status).toBe(400);
    expect(dup.body.error).toBe("invalid_allergies");

    const malformed = await request(app).patch("/api/athlete/me").set("Authorization", token).send({ dietaryPreferences: ["vegan", 123] });
    expect(malformed.status).toBe(400);
    expect(malformed.body.error).toBe("invalid_dietaryPreferences");

    const emptyString = await request(app).patch("/api/athlete/me").set("Authorization", token).send({ cuisinePreferences: ["indian", "  "] });
    expect(emptyString.status).toBe(400);
  });

  test("sending null/empty clears a field back to default", async () => {
    const user = await makeAthlete("clear-fields");
    const app = buildApp();
    const token = `Bearer ${tokenFor(user._id)}`;
    await request(app).patch("/api/athlete/me").set("Authorization", token).send({ fitnessGoal: "lose_weight", allergies: ["nuts"] });

    const cleared = await request(app).patch("/api/athlete/me").set("Authorization", token).send({ fitnessGoal: null, allergies: [] });
    expect(cleared.status).toBe(200);
    expect(cleared.body.athlete.fitnessGoal).toBeNull();
    expect(cleared.body.athlete.allergies).toEqual([]);
  });
});
