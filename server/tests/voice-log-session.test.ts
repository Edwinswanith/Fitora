import mongoose, { Types } from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { CoachAthleteAssignment } from "../src/models/CoachAthleteAssignment";
import { TrainingSession } from "../src/models/TrainingSession";
import { RpeMonitoring } from "../src/models/RpeMonitoring";
import { Attendance } from "../src/models/Attendance";
import { Wellness } from "../src/models/Wellness";
import { VoicePendingState } from "../src/models/VoicePendingState";
import { VoiceActionReceipt } from "../src/models/VoiceActionReceipt";
import athleteVoiceV2Router from "../src/routes/athleteVoiceV2";
import { signAccessToken } from "../src/lib/tokens";

// Transactions require a replica set — standalone MongoMemoryServer (used by
// most other test files) rejects them outright. This is the one suite that
// exercises the /log-session orchestration endpoint's actual transactional
// path (plan §5 step 6), not just its sequential-fallback behavior.
let mongo: MongoMemoryReplSet;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/athlete/voice", athleteVoiceV2Router);
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

function tokenFor(userId: Types.ObjectId, role: "athlete" | "coach") {
  return signAccessToken({ sub: userId.toString(), role });
}

const TODAY_STR = (() => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10);
})();

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
}, 60_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
});

describe("POST /api/athlete/voice/log-session", () => {
  test("rejects a request with no clientActionId", async () => {
    const { user } = await makeAthlete("Arjun");
    const res = await request(buildApp())
      .post("/api/athlete/voice/log-session")
      .set("Cookie", [`accessToken=${tokenFor(user._id as Types.ObjectId, "athlete")}`])
      .send({ sessionType: "AM", status: "completed", date: TODAY_STR });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("missing_clientActionId");
  });

  test("rejects non-athlete roles", async () => {
    const coach = await makeUser("coach", "Coach");
    const res = await request(buildApp())
      .post("/api/athlete/voice/log-session")
      .set("Cookie", [`accessToken=${tokenFor(coach._id as Types.ObjectId, "coach")}`])
      .send({ sessionType: "AM", status: "completed", date: TODAY_STR, clientActionId: "a1" });
    expect(res.status).toBe(403);
  });

  test("session-only log (no rpe) creates a TrainingSession, marks attendance present, and writes no RpeMonitoring row", async () => {
    const { user, profile } = await makeAthlete("Bala");
    const res = await request(buildApp())
      .post("/api/athlete/voice/log-session")
      .set("Cookie", [`accessToken=${tokenFor(user._id as Types.ObjectId, "athlete")}`])
      .send({
        sessionType: "AM",
        status: "completed",
        workoutType: "Sprints",
        actualDurationMin: 45,
        date: TODAY_STR,
        clientActionId: "bala-1",
      });
    expect(res.status).toBe(200);
    expect(res.body.session.status).toBe("completed");
    expect(res.body.session.workoutType).toBe("Sprints");
    expect(res.body.rpeEntry).toBeNull();
    expect(res.body.mode).toBe("transactional");

    const rpeCount = await RpeMonitoring.countDocuments({ athleteId: profile._id });
    expect(rpeCount).toBe(0);
    const attendance = await Attendance.findOne({ athleteId: profile._id }).lean();
    expect(attendance?.status).toBe("present");
  });

  test("effortScore alone never populates rpe and never creates an RpeMonitoring row (correction #3)", async () => {
    const { user, profile } = await makeAthlete("Chetan");
    const res = await request(buildApp())
      .post("/api/athlete/voice/log-session")
      .set("Cookie", [`accessToken=${tokenFor(user._id as Types.ObjectId, "athlete")}`])
      .send({
        sessionType: "PM",
        status: "completed",
        effortScore: 9,
        date: TODAY_STR,
        clientActionId: "chetan-1",
      });
    expect(res.status).toBe(200);
    expect(res.body.session.effortRating).toBe(9);
    expect(res.body.rpeEntry).toBeNull();
    expect(await RpeMonitoring.countDocuments({ athleteId: profile._id })).toBe(0);
  });

  test("rpe without trainingCategory is rejected — never defaulted or invented", async () => {
    const { user } = await makeAthlete("Diya");
    const res = await request(buildApp())
      .post("/api/athlete/voice/log-session")
      .set("Cookie", [`accessToken=${tokenFor(user._id as Types.ObjectId, "athlete")}`])
      .send({
        sessionType: "AM",
        status: "completed",
        rpe: 8,
        plannedIntensityPercent: 80,
        date: TODAY_STR,
        clientActionId: "diya-1",
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_trainingCategory");
  });

  test("session + rpe creates both rows transactionally, keeping effortRating unset when effortScore wasn't given", async () => {
    const { user, profile } = await makeAthlete("Esha");
    const res = await request(buildApp())
      .post("/api/athlete/voice/log-session")
      .set("Cookie", [`accessToken=${tokenFor(user._id as Types.ObjectId, "athlete")}`])
      .send({
        sessionType: "AM",
        status: "completed",
        workoutType: "Sprints",
        actualDurationMin: 45,
        rpe: 8,
        trainingCategory: "MAX SPEED",
        plannedIntensityPercent: 80,
        date: TODAY_STR,
        clientActionId: "esha-1",
      });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("transactional");
    expect(res.body.session.effortRating).toBeUndefined();
    expect(res.body.rpeEntry.rpe).toBe(8);
    expect(res.body.rpeEntry.trainingCategory).toBe("MAX SPEED");
    expect(res.body.rpeEntry.plannedIntensityPercent).toBe(80);

    const rpeDoc = await RpeMonitoring.findOne({ athleteId: profile._id }).lean();
    expect(rpeDoc?.rpe).toBe(8);
    const sessionDoc = await TrainingSession.findOne({ athleteId: profile._id }).lean();
    expect(sessionDoc?.effortRating).toBeUndefined();
  });

  test("sources today's real wellness sub-scores into the RpeMonitoring row instead of inventing them", async () => {
    const { user, profile } = await makeAthlete("Farhan");
    await Wellness.create({
      athleteId: profile._id,
      date: new Date(TODAY_STR),
      sleepQuality: 5,
      mood: 5,
      stress: 1,
      soreness: 1,
      fatigue: 1,
    });

    const res = await request(buildApp())
      .post("/api/athlete/voice/log-session")
      .set("Cookie", [`accessToken=${tokenFor(user._id as Types.ObjectId, "athlete")}`])
      .send({
        sessionType: "AM",
        status: "completed",
        rpe: 6,
        trainingCategory: "ENDURANCE",
        plannedIntensityPercent: 60,
        date: TODAY_STR,
        clientActionId: "farhan-1",
      });
    expect(res.status).toBe(200);
    expect(res.body.rpeEntry.sleepQuality).toBe(5);
    expect(res.body.rpeEntry.muscleSoreness).toBe(1);
    expect(res.body.rpeEntry.fatigue).toBe(1);
    expect(res.body.rpeEntry.moodMotivation).toBe(5);
  });

  test("defaults wellness sub-scores to a neutral 3 when no check-in exists today", async () => {
    const { user } = await makeAthlete("Gowri");
    const res = await request(buildApp())
      .post("/api/athlete/voice/log-session")
      .set("Cookie", [`accessToken=${tokenFor(user._id as Types.ObjectId, "athlete")}`])
      .send({
        sessionType: "AM",
        status: "completed",
        rpe: 6,
        trainingCategory: "ENDURANCE",
        plannedIntensityPercent: 60,
        date: TODAY_STR,
        clientActionId: "gowri-1",
      });
    expect(res.status).toBe(200);
    expect(res.body.rpeEntry.sleepQuality).toBe(3);
    expect(res.body.rpeEntry.muscleSoreness).toBe(3);
    expect(res.body.rpeEntry.fatigue).toBe(3);
    expect(res.body.rpeEntry.moodMotivation).toBe(3);
  });

  test("denormalizes coachId onto the RpeMonitoring row when exactly one active assignment exists", async () => {
    const { user, profile } = await makeAthlete("Harini");
    const coach = await makeUser("coach", "Coach2");
    await CoachAthleteAssignment.create({
      coachId: coach._id,
      athleteId: profile._id,
      endedAt: null,
      assignedBy: coach._id,
    });

    const res = await request(buildApp())
      .post("/api/athlete/voice/log-session")
      .set("Cookie", [`accessToken=${tokenFor(user._id as Types.ObjectId, "athlete")}`])
      .send({
        sessionType: "AM",
        status: "completed",
        rpe: 6,
        trainingCategory: "ENDURANCE",
        plannedIntensityPercent: 60,
        date: TODAY_STR,
        clientActionId: "harini-1",
      });
    expect(res.status).toBe(200);
    expect(res.body.rpeEntry.coachId).toBe((coach._id as Types.ObjectId).toString());
  });

  test("clears server-persisted VoicePendingState after a successful save", async () => {
    const { user, profile } = await makeAthlete("Ibrahim");
    await VoicePendingState.create({
      athleteProfileId: profile._id,
      intent: "log_session",
      entities: { sessionType: "AM", status: "completed" },
      missingFields: [],
      lastTranscript: "I completed my session",
    });

    const res = await request(buildApp())
      .post("/api/athlete/voice/log-session")
      .set("Cookie", [`accessToken=${tokenFor(user._id as Types.ObjectId, "athlete")}`])
      .send({ sessionType: "AM", status: "completed", date: TODAY_STR, clientActionId: "ibrahim-1" });
    expect(res.status).toBe(200);
    expect(await VoicePendingState.findOne({ athleteProfileId: profile._id })).toBeNull();
  });

  test("idempotency: repeating the same clientActionId does not create a second write", async () => {
    const { user, profile } = await makeAthlete("Jaya");
    const app = buildApp();
    const auth = `accessToken=${tokenFor(user._id as Types.ObjectId, "athlete")}`;
    const body = {
      sessionType: "AM",
      status: "completed",
      workoutType: "Sprints",
      rpe: 8,
      trainingCategory: "MAX SPEED",
      plannedIntensityPercent: 80,
      date: TODAY_STR,
      clientActionId: "jaya-dup-1",
    };

    const first = await request(app).post("/api/athlete/voice/log-session").set("Cookie", [auth]).send(body);
    expect(first.status).toBe(200);

    const second = await request(app).post("/api/athlete/voice/log-session").set("Cookie", [auth]).send(body);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);

    expect(await TrainingSession.countDocuments({ athleteId: profile._id })).toBe(1);
    expect(await RpeMonitoring.countDocuments({ athleteId: profile._id })).toBe(1);
    expect(await VoiceActionReceipt.countDocuments({ clientActionId: "jaya-dup-1" })).toBe(1);
  });

  test("a different clientActionId for the same athlete/day is a distinct write, not deduped", async () => {
    const { user, profile } = await makeAthlete("Kavya");
    const app = buildApp();
    const auth = `accessToken=${tokenFor(user._id as Types.ObjectId, "athlete")}`;

    await request(app)
      .post("/api/athlete/voice/log-session")
      .set("Cookie", [auth])
      .send({ sessionType: "AM", status: "completed", date: TODAY_STR, clientActionId: "kavya-1" });
    await request(app)
      .post("/api/athlete/voice/log-session")
      .set("Cookie", [auth])
      .send({ sessionType: "PM", status: "completed", date: TODAY_STR, clientActionId: "kavya-2" });

    expect(await TrainingSession.countDocuments({ athleteId: profile._id })).toBe(2);
  });
});
