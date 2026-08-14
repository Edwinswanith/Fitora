import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { GuardianAthleteLink } from "../src/models/GuardianAthleteLink";
import { Wellness } from "../src/models/Wellness";
import { Attendance } from "../src/models/Attendance";
import { WaterIntake } from "../src/models/WaterIntake";
import guardianRouter from "../src/routes/guardian";
import { signAccessToken } from "../src/lib/tokens";

let mongo: MongoMemoryServer;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/guardian", guardianRouter);
  return app;
}

async function makeUser(role: "guardian" | "athlete" | "coach", name: string) {
  return User.create({ email: `${name}@test.io`, passwordHash: "x", role, name });
}

async function makeAthlete(name: string) {
  const user = await makeUser("athlete", name);
  const profile = await AthleteProfile.create({ userId: user._id, sport: "football" });
  return { user, profile };
}

function tokenFor(userId: Types.ObjectId, role: "guardian" | "athlete" | "coach") {
  return signAccessToken({ sub: userId.toString(), role });
}

const TODAY_STR = (() => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    .toISOString()
    .slice(0, 10);
})();

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  await Promise.all(
    Object.values(mongoose.connection.collections).map((c) => c.deleteMany({}))
  );
});

async function guardianWithChild() {
  const guardian = await makeUser("guardian", "parent");
  const { profile: child } = await makeAthlete("child");
  await GuardianAthleteLink.create({
    guardianId: guardian._id,
    athleteId: child._id,
    relationship: "parent",
  });
  return { guardian, child };
}

describe("Guardian roster", () => {
  test("guardian lists only linked athletes", async () => {
    const { guardian, child } = await guardianWithChild();
    await makeAthlete("not-my-child"); // unlinked

    const res = await request(buildApp())
      .get("/api/guardian/athletes")
      .set("Authorization", `Bearer ${tokenFor(guardian._id, "guardian")}`);
    expect(res.status).toBe(200);
    expect(res.body.athletes).toHaveLength(1);
    expect(res.body.athletes[0].athleteId).toBe(child._id.toString());
    expect(res.body.athletes[0].name).toBe("child");
  });

  test("guardian with no links → empty roster", async () => {
    const guardian = await makeUser("guardian", "lonely");
    const res = await request(buildApp())
      .get("/api/guardian/athletes")
      .set("Authorization", `Bearer ${tokenFor(guardian._id, "guardian")}`);
    expect(res.status).toBe(200);
    expect(res.body.athletes).toEqual([]);
  });
});

describe("Guardian auth gate", () => {
  test("athlete role hitting guardian endpoint → 403", async () => {
    const { user } = await makeAthlete("a1");
    const res = await request(buildApp())
      .get("/api/guardian/athletes")
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`);
    expect(res.status).toBe(403);
  });

  test("no token → 401", async () => {
    const res = await request(buildApp()).get("/api/guardian/athletes");
    expect(res.status).toBe(401);
  });
});

describe("Guardian summary access", () => {
  test("linked child summary → 200 with only sleep/water/attendance; unlinked → 403", async () => {
    const { guardian, child } = await guardianWithChild();
    const { profile: stranger } = await makeAthlete("stranger");
    const day = new Date(`${TODAY_STR}T00:00:00.000Z`);
    await Wellness.create({
      athleteId: child._id,
      date: day,
      sleepHours: 8,
      sleepQuality: 4,
      mood: 4,
      stress: 2,
      soreness: 2,
      fatigue: 2,
    });
    await Attendance.create({ athleteId: child._id, date: day, status: "present" });
    await WaterIntake.create({ athleteId: child._id, date: day, amountMl: 500, loggedAt: new Date() });
    await WaterIntake.create({ athleteId: child._id, date: day, amountMl: 750, loggedAt: new Date() });

    const app = buildApp();
    const token = tokenFor(guardian._id, "guardian");

    const ok = await request(app)
      .get(`/api/guardian/athletes/${child._id}/summary?date=${TODAY_STR}`)
      .set("Authorization", `Bearer ${token}`);
    expect(ok.status).toBe(200);
    expect(ok.body.sleep.quality).toBe(4);
    expect(ok.body.attendance.status).toBe("present");
    expect(ok.body.water.totalMl).toBe(1250);
    // Only these three data points — no readiness/training/coach data leaks through.
    expect(ok.body).not.toHaveProperty("readinessScore");
    expect(ok.body).not.toHaveProperty("sessions");
    expect(ok.body).not.toHaveProperty("injury");

    const forbidden = await request(app)
      .get(`/api/guardian/athletes/${stranger._id}/summary?date=${TODAY_STR}`)
      .set("Authorization", `Bearer ${token}`);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error).toBe("not_linked_guardian");
  });

  test("no data logged yet → nulls, not an error", async () => {
    const { guardian, child } = await guardianWithChild();
    const res = await request(buildApp())
      .get(`/api/guardian/athletes/${child._id}/summary?date=${TODAY_STR}`)
      .set("Authorization", `Bearer ${tokenFor(guardian._id, "guardian")}`);
    expect(res.status).toBe(200);
    expect(res.body.sleep.quality).toBeNull();
    expect(res.body.attendance.status).toBeNull();
    expect(res.body.water.totalMl).toBe(0);
  });

  test("removed endpoints are gone (daily-card, coach-comments → 404)", async () => {
    const { guardian, child } = await guardianWithChild();
    const token = tokenFor(guardian._id, "guardian");
    const app = buildApp();

    const dailyCard = await request(app)
      .get(`/api/guardian/athletes/${child._id}/daily-card?date=${TODAY_STR}`)
      .set("Authorization", `Bearer ${token}`);
    expect(dailyCard.status).toBe(404);

    const comments = await request(app)
      .get(`/api/guardian/athletes/${child._id}/coach-comments?date=${TODAY_STR}`)
      .set("Authorization", `Bearer ${token}`);
    expect(comments.status).toBe(404);
  });

  test("guardian has no write endpoint (POST → 404)", async () => {
    const { guardian, child } = await guardianWithChild();
    const res = await request(buildApp())
      .post(`/api/guardian/athletes/${child._id}/summary`)
      .set("Authorization", `Bearer ${tokenFor(guardian._id, "guardian")}`)
      .send({ foo: "bar" });
    expect(res.status).toBe(404);
  });
});
