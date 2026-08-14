import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { CoachAthleteAssignment } from "../src/models/CoachAthleteAssignment";
import { Attendance } from "../src/models/Attendance";
import { TrainingSession } from "../src/models/TrainingSession";
import { Performance } from "../src/models/Performance";
import coachRouter from "../src/routes/coach";
import { signAccessToken } from "../src/lib/tokens";

let mongo: MongoMemoryServer;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/coach", coachRouter);
  return app;
}

async function makeUser(role: "coach" | "athlete", name: string) {
  return User.create({ email: `${name}@test.io`, passwordHash: "x", role, name });
}

async function makeAthlete(name: string) {
  const user = await makeUser("athlete", name);
  const profile = await AthleteProfile.create({ userId: user._id, sport: "football" });
  return { user, profile };
}

function tokenFor(userId: Types.ObjectId, role: "coach") {
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

async function assignedCoachAndAthlete() {
  const admin = await makeUser("coach", "ad");
  const coach = await makeUser("coach", "kumar");
  const { profile } = await makeAthlete("arjun");
  await CoachAthleteAssignment.create({
    coachId: coach._id,
    athleteId: profile._id,
    assignedBy: admin._id,
  });
  return { coach, profile };
}

describe("Coach attendance write", () => {
  test("assigned coach records attendance; upsert per day", async () => {
    const { coach, profile } = await assignedCoachAndAthlete();
    const app = buildApp();
    const token = tokenFor(coach._id, "coach");

    const res = await request(app)
      .post(`/api/coach/athletes/${profile._id}/attendance`)
      .set("Authorization", `Bearer ${token}`)
      .send({ date: TODAY_STR, status: "present" });
    expect(res.status).toBe(200);
    expect(res.body.attendance.status).toBe("present");
    expect(res.body.attendance.recordedBy).toBe(coach._id.toString());

    // Same day again replaces, no duplicate
    await request(app)
      .post(`/api/coach/athletes/${profile._id}/attendance`)
      .set("Authorization", `Bearer ${token}`)
      .send({ date: TODAY_STR, status: "late" });
    const count = await Attendance.countDocuments({ athleteId: profile._id });
    expect(count).toBe(1);
  });

  test("invalid status → 400", async () => {
    const { coach, profile } = await assignedCoachAndAthlete();
    const res = await request(buildApp())
      .post(`/api/coach/athletes/${profile._id}/attendance`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .send({ date: TODAY_STR, status: "tardy" });
    expect(res.status).toBe(400);
  });

  test("unassigned coach → 403 not_in_assignments", async () => {
    const coach = await makeUser("coach", "singh");
    const { profile } = await makeAthlete("other");
    const res = await request(buildApp())
      .post(`/api/coach/athletes/${profile._id}/attendance`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .send({ date: TODAY_STR, status: "present" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("not_in_assignments");
  });
});

describe("Coach training plan write", () => {
  test("coach sets type/plan/intensity; stored with coachId", async () => {
    const { coach, profile } = await assignedCoachAndAthlete();
    const res = await request(buildApp())
      .post(`/api/coach/athletes/${profile._id}/training/AM`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .send({
        date: TODAY_STR,
        type: "strength",
        status: "planned",
        intensityRpe: 7,
        plan: { blocks: ["squat", "bench"] },
      });
    expect(res.status).toBe(200);
    expect(res.body.session.type).toBe("strength");
    expect(res.body.session.intensityRpe).toBe(7);
    expect(res.body.session.coachId).toBe(coach._id.toString());
    const count = await TrainingSession.countDocuments({ athleteId: profile._id });
    expect(count).toBe(1);
  });

  test("invalid slot → 400; invalid intensityRpe → 400", async () => {
    const { coach, profile } = await assignedCoachAndAthlete();
    const app = buildApp();
    const token = tokenFor(coach._id, "coach");

    const badSlot = await request(app)
      .post(`/api/coach/athletes/${profile._id}/training/EVENING`)
      .set("Authorization", `Bearer ${token}`)
      .send({ date: TODAY_STR, type: "strength" });
    expect(badSlot.status).toBe(400);
    expect(badSlot.body.error).toBe("invalid_slot");

    const badRpe = await request(app)
      .post(`/api/coach/athletes/${profile._id}/training/AM`)
      .set("Authorization", `Bearer ${token}`)
      .send({ date: TODAY_STR, intensityRpe: 101 });
    expect(badRpe.status).toBe(400);
    expect(badRpe.body.error).toBe("invalid_intensityRpe");
  });
});

describe("Coach performance write + read", () => {
  test("coach logs performance, then reads it back (newest first)", async () => {
    const { coach, profile } = await assignedCoachAndAthlete();
    const app = buildApp();
    const token = tokenFor(coach._id, "coach");

    const post = await request(app)
      .post(`/api/coach/athletes/${profile._id}/performance`)
      .set("Authorization", `Bearer ${token}`)
      .send({ date: TODAY_STR, metric: "100m", value: 11.2, unit: "s", context: "test" });
    expect(post.status).toBe(201);
    expect(post.body.performance.metric).toBe("100m");

    const list = await request(app)
      .get(`/api/coach/athletes/${profile._id}/performance`)
      .set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.entries).toHaveLength(1);
    expect(list.body.entries[0].value).toBe(11.2);
  });

  test("missing metric → 400; non-numeric value → 400", async () => {
    const { coach, profile } = await assignedCoachAndAthlete();
    const app = buildApp();
    const token = tokenFor(coach._id, "coach");

    const noMetric = await request(app)
      .post(`/api/coach/athletes/${profile._id}/performance`)
      .set("Authorization", `Bearer ${token}`)
      .send({ value: 10, unit: "s" });
    expect(noMetric.status).toBe(400);
    expect(noMetric.body.error).toBe("invalid_metric");

    const badValue = await request(app)
      .post(`/api/coach/athletes/${profile._id}/performance`)
      .set("Authorization", `Bearer ${token}`)
      .send({ metric: "100m", value: "fast", unit: "s" });
    expect(badValue.status).toBe(400);
    expect(badValue.body.error).toBe("invalid_value");
  });

  test("unassigned coach cannot write performance → 403", async () => {
    const coach = await makeUser("coach", "singh");
    const { profile } = await makeAthlete("other");
    const res = await request(buildApp())
      .post(`/api/coach/athletes/${profile._id}/performance`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .send({ metric: "100m", value: 11.2, unit: "s" });
    expect(res.status).toBe(403);
  });
});
