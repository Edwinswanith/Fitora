import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { CoachAthleteAssignment } from "../src/models/CoachAthleteAssignment";
import { RpeMonitoring } from "../src/models/RpeMonitoring";
import { AuditLog } from "../src/models/AuditLog";
import athleteRouter from "../src/routes/athlete";
import coachRouter from "../src/routes/coach";
import { signAccessToken } from "../src/lib/tokens";
import {
  computeRpeReadiness,
  deriveLoadAndRisk,
} from "../src/lib/trainingCategories";

let mongo: MongoMemoryServer;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/athlete", athleteRouter);
  app.use("/api/coach", coachRouter);
  return app;
}

async function makeUser(role: "coach" | "athlete", name: string) {
  return User.create({
    email: `${name}@test.io`,
    passwordHash: "x",
    role,
    name,
  });
}

async function makeAthlete(name: string, sport = "athletics") {
  const user = await makeUser("athlete", name);
  const profile = await AthleteProfile.create({ userId: user._id, sport });
  return { user, profile };
}

function tokenFor(userId: Types.ObjectId, role: "athlete" | "coach") {
  return signAccessToken({ sub: userId.toString(), role });
}

const TODAY_STR = (() => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    .toISOString()
    .slice(0, 10);
})();

const baseBody = {
  date: TODAY_STR,
  sessionType: "AM",
  trainingCategory: "MAX SPEED",
  plannedIntensityPercent: 80,
  rpe: 7,
  sleepQuality: 4,
  muscleSoreness: 2,
  fatigue: 2,
  moodMotivation: 4,
};

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

// ---------- Readiness calculation ----------

describe("computeRpeReadiness", () => {
  test("perfect (sq=5, mood=5, fatigue=0, soreness=0) → 100, green", () => {
    expect(
      computeRpeReadiness({
        sleepQuality: 5,
        moodMotivation: 5,
        fatigue: 0,
        muscleSoreness: 0,
      })
    ).toEqual({ readinessScore: 100, readinessBand: "green" });
  });

  test("worst (sq=0, mood=0, fatigue=5, soreness=5) → 0, red", () => {
    expect(
      computeRpeReadiness({
        sleepQuality: 0,
        moodMotivation: 0,
        fatigue: 5,
        muscleSoreness: 5,
      })
    ).toEqual({ readinessScore: 0, readinessBand: "red" });
  });

  test("mid (sq=3, mood=3, fatigue=2, soreness=2) → 60, amber", () => {
    expect(
      computeRpeReadiness({
        sleepQuality: 3,
        moodMotivation: 3,
        fatigue: 2,
        muscleSoreness: 2,
      })
    ).toEqual({ readinessScore: 60, readinessBand: "amber" });
  });

  test("band boundary 80 → green, 79 → amber, 59 → red", () => {
    // 80 exactly: sq=5 (25) + mood=5 (25) + fatigue=1 (20) + soreness=1 (20) → wait that's 90
    // Let's pick sq=4 (20) + mood=4 (20) + fatigue=1 (20) + soreness=1 (20) = 80
    expect(
      computeRpeReadiness({
        sleepQuality: 4,
        moodMotivation: 4,
        fatigue: 1,
        muscleSoreness: 1,
      }).readinessBand
    ).toBe("green");
    // amber just below 80: sq=4 + mood=4 + fatigue=2 + soreness=1 → 20+20+15+20=75 amber
    expect(
      computeRpeReadiness({
        sleepQuality: 4,
        moodMotivation: 4,
        fatigue: 2,
        muscleSoreness: 1,
      }).readinessBand
    ).toBe("amber");
    // red just below 60: sq=2 + mood=3 + fatigue=2 + soreness=3 → 10+15+15+10=50 red
    expect(
      computeRpeReadiness({
        sleepQuality: 2,
        moodMotivation: 3,
        fatigue: 2,
        muscleSoreness: 3,
      }).readinessBand
    ).toBe("red");
  });

  test("rounds to integer", () => {
    // sq=1 (5) + mood=2 (10) + fatigue=4 (5) + soreness=4 (5) = 25
    expect(
      computeRpeReadiness({
        sleepQuality: 1,
        moodMotivation: 2,
        fatigue: 4,
        muscleSoreness: 4,
      }).readinessScore
    ).toBe(25);
  });
});

describe("deriveLoadAndRisk → risk reasons", () => {
  test("red via rpe+fatigue lists the rule", () => {
    const r = deriveLoadAndRisk({
      plannedIntensityPercent: 80,
      rpe: 8,
      fatigue: 4,
      muscleSoreness: 2,
      sleepQuality: 4,
      moodMotivation: 4,
    });
    expect(r.riskFlag).toBe("red");
    expect(r.riskReasons.some((s) => s.includes("RPE 8") && s.includes("fatigue 4"))).toBe(true);
  });

  test("red via soreness+fatigue lists the rule", () => {
    const r = deriveLoadAndRisk({
      plannedIntensityPercent: 50,
      rpe: 5,
      fatigue: 5,
      muscleSoreness: 4,
      sleepQuality: 4,
      moodMotivation: 4,
    });
    expect(r.riskFlag).toBe("red");
    expect(r.riskReasons.some((s) => s.toLowerCase().includes("muscle soreness"))).toBe(true);
  });

  test("amber lists which signal triggered", () => {
    const lowSleep = deriveLoadAndRisk({
      plannedIntensityPercent: 50,
      rpe: 5,
      fatigue: 2,
      muscleSoreness: 2,
      sleepQuality: 2,
      moodMotivation: 4,
    });
    expect(lowSleep.riskFlag).toBe("amber");
    expect(lowSleep.riskReasons.some((s) => s.toLowerCase().includes("sleep"))).toBe(true);

    const lowMood = deriveLoadAndRisk({
      plannedIntensityPercent: 50,
      rpe: 5,
      fatigue: 2,
      muscleSoreness: 2,
      sleepQuality: 4,
      moodMotivation: 1,
    });
    expect(lowMood.riskFlag).toBe("amber");
    expect(lowMood.riskReasons.some((s) => s.toLowerCase().includes("mood"))).toBe(true);
  });

  test("green has empty riskReasons", () => {
    const r = deriveLoadAndRisk({
      plannedIntensityPercent: 60,
      rpe: 6,
      fatigue: 2,
      muscleSoreness: 2,
      sleepQuality: 4,
      moodMotivation: 4,
    });
    expect(r.riskFlag).toBe("green");
    expect(r.riskReasons).toEqual([]);
  });
});

// ---------- F9: 400 paths + AuditLog ----------

describe("RPE input validation (400 paths)", () => {
  test("invalid sessionType → 400 invalid_sessionType", async () => {
    const { user } = await makeAthlete("a1");
    const res = await request(buildApp())
      .post("/api/athlete/rpe-monitoring")
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ ...baseBody, sessionType: "EVENING" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_sessionType");
  });

  test("invalid trainingCategory → 400 invalid_trainingCategory", async () => {
    const { user } = await makeAthlete("a2");
    const res = await request(buildApp())
      .post("/api/athlete/rpe-monitoring")
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ ...baseBody, trainingCategory: "GYM YOGA" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_trainingCategory");
  });

  test("rpe out of range → 400 invalid_rpe", async () => {
    const { user } = await makeAthlete("a3");
    const res = await request(buildApp())
      .post("/api/athlete/rpe-monitoring")
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ ...baseBody, rpe: 11 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_rpe");
  });

  test("restingHeartRate = 0 is treated as missing (no 500)", async () => {
    const { user, profile } = await makeAthlete("a4");
    const res = await request(buildApp())
      .post("/api/athlete/rpe-monitoring")
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ ...baseBody, restingHeartRate: 0 });
    expect(res.status).toBe(201);
    expect(res.body.entry.restingHeartRate ?? null).toBeNull();
    const row = await RpeMonitoring.findOne({ athleteId: profile._id }).lean();
    expect(row?.restingHeartRate ?? null).toBeNull();
  });

  test("restingHeartRate out of range → 400 invalid_restingHeartRate", async () => {
    const { user } = await makeAthlete("a5");
    const res = await request(buildApp())
      .post("/api/athlete/rpe-monitoring")
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ ...baseBody, restingHeartRate: 19 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_restingHeartRate");
  });

  test("invalid date string → 400 invalid_date", async () => {
    const { user } = await makeAthlete("a6");
    const res = await request(buildApp())
      .post("/api/athlete/rpe-monitoring")
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ ...baseBody, date: "not-a-date" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_date");
  });

  test("invalid date on coach dashboard → 400 invalid_date", async () => {
    const coach = await makeUser("coach", "c-bad-date");
    const res = await request(buildApp())
      .get("/api/coach/dashboard?date=garbage")
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_date");
  });
});

describe("AuditLog: coach RPE deny is recorded", () => {
  test("coach hitting unassigned athlete's RPE → 403 + audit row", async () => {
    const coach = await makeUser("coach", "c-deny");
    const { profile } = await makeAthlete("ath-other");

    const res = await request(buildApp())
      .get(`/api/coach/athletes/${profile._id.toString()}/rpe-monitoring?date=${TODAY_STR}`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("not_in_assignments");

    const logs = await AuditLog.find({
      actorId: coach._id,
      outcome: "deny",
    }).lean();
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].targetType).toBe("athlete");
    expect((logs[0].targetId as Types.ObjectId).toString()).toBe(profile._id.toString());
  });
});

// ---------- Persisted fields surface through to coach dashboard ----------

describe("Readiness + riskReasons flow through to coach dashboard", () => {
  test("RED RPE includes riskReasons and readinessScore on coach card", async () => {
    const admin = await makeUser("coach", "ad");
    const coach = await makeUser("coach", "kumar");
    const { user: ua, profile } = await makeAthlete("arjun");
    await CoachAthleteAssignment.create({
      coachId: coach._id,
      athleteId: profile._id,
      assignedBy: admin._id,
    });

    const post = await request(buildApp())
      .post("/api/athlete/rpe-monitoring")
      .set("Authorization", `Bearer ${tokenFor(ua._id, "athlete")}`)
      .send({
        ...baseBody,
        sessionType: "PM",
        rpe: 9,
        fatigue: 4,
        muscleSoreness: 4,
        sleepQuality: 1,
        moodMotivation: 1,
      });
    expect(post.status).toBe(201);
    expect(post.body.entry.riskFlag).toBe("red");
    expect(post.body.entry.riskReasons.length).toBeGreaterThan(0);
    expect(typeof post.body.entry.readinessScore).toBe("number");
    expect(["green", "amber", "red"]).toContain(post.body.entry.readinessBand);

    const dash = await request(buildApp())
      .get(`/api/coach/dashboard?date=${TODAY_STR}`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);
    expect(dash.status).toBe(200);
    const rpe = dash.body.cards[0].rpe;
    expect(rpe.riskFlag).toBe("red");
    expect(Array.isArray(rpe.riskReasons)).toBe(true);
    expect(rpe.riskReasons.length).toBeGreaterThan(0);
    expect(typeof rpe.readinessScore).toBe("number");
    expect(rpe.readinessBand).toBe("red");
  });
});
