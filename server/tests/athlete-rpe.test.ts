import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { CoachAthleteAssignment } from "../src/models/CoachAthleteAssignment";
import { RpeMonitoring } from "../src/models/RpeMonitoring";
import athleteRouter from "../src/routes/athlete";
import coachRouter from "../src/routes/coach";
import { signAccessToken } from "../src/lib/tokens";
import { deriveLoadAndRisk } from "../src/lib/trainingCategories";

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

function tokenFor(
  userId: Types.ObjectId,
  role: "athlete" | "coach"
) {
  return signAccessToken({ sub: userId.toString(), role });
}

const TODAY_STR = (() => {
  const d = new Date();
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  )
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
  bodyConditionFeedback: "Felt good.",
  restingHeartRate: 55,
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

describe("deriveLoadAndRisk", () => {
  test("red via rpe + fatigue", () => {
    expect(
      deriveLoadAndRisk({
        plannedIntensityPercent: 80,
        rpe: 8,
        fatigue: 4,
        muscleSoreness: 2,
        sleepQuality: 4,
        moodMotivation: 4,
      })
    ).toMatchObject({ calculatedTrainingLoad: 640, riskFlag: "red" });
  });
  test("red via soreness + fatigue", () => {
    expect(
      deriveLoadAndRisk({
        plannedIntensityPercent: 50,
        rpe: 5,
        fatigue: 5,
        muscleSoreness: 4,
        sleepQuality: 4,
        moodMotivation: 4,
      })
    ).toMatchObject({ calculatedTrainingLoad: 250, riskFlag: "red" });
  });
  test("amber via sleepQuality", () => {
    expect(
      deriveLoadAndRisk({
        plannedIntensityPercent: 50,
        rpe: 5,
        fatigue: 2,
        muscleSoreness: 2,
        sleepQuality: 2,
        moodMotivation: 4,
      }).riskFlag
    ).toBe("amber");
  });
  test("amber via moodMotivation", () => {
    expect(
      deriveLoadAndRisk({
        plannedIntensityPercent: 50,
        rpe: 5,
        fatigue: 2,
        muscleSoreness: 2,
        sleepQuality: 4,
        moodMotivation: 1,
      }).riskFlag
    ).toBe("amber");
  });
  test("green when balanced", () => {
    expect(
      deriveLoadAndRisk({
        plannedIntensityPercent: 60,
        rpe: 6,
        fatigue: 2,
        muscleSoreness: 2,
        sleepQuality: 4,
        moodMotivation: 4,
      })
    ).toMatchObject({ calculatedTrainingLoad: 360, riskFlag: "green" });
  });
  test("amber via restingHeartRate >= 100", () => {
    const out = deriveLoadAndRisk({
      plannedIntensityPercent: 60,
      rpe: 6,
      fatigue: 2,
      muscleSoreness: 2,
      sleepQuality: 4,
      moodMotivation: 4,
      restingHeartRate: 100,
    });
    expect(out.riskFlag).toBe("amber");
  });
  test("riskReasons includes an elevated resting heart rate reason", () => {
    const out = deriveLoadAndRisk({
      plannedIntensityPercent: 60,
      rpe: 6,
      fatigue: 2,
      muscleSoreness: 2,
      sleepQuality: 4,
      moodMotivation: 4,
      restingHeartRate: 110,
    });
    expect(
      out.riskReasons.some((r) => /resting heart rate/i.test(r))
    ).toBe(true);
  });
  test("restingHeartRate below 100 does not raise risk on its own", () => {
    const out = deriveLoadAndRisk({
      plannedIntensityPercent: 60,
      rpe: 6,
      fatigue: 2,
      muscleSoreness: 2,
      sleepQuality: 4,
      moodMotivation: 4,
      restingHeartRate: 99,
    });
    expect(out.riskFlag).toBe("green");
    expect(out.riskReasons).toHaveLength(0);
  });
});

describe("POST /api/athlete/rpe-monitoring", () => {
  test("athlete submits own RPE → row exists with computed load + flag", async () => {
    const { user, profile } = await makeAthlete("alpha");
    const res = await request(buildApp())
      .post("/api/athlete/rpe-monitoring")
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send(baseBody);
    expect(res.status).toBe(201);
    expect(res.body.entry.calculatedTrainingLoad).toBe(560);
    expect(res.body.entry.riskFlag).toBe("green");
    expect(res.body.wasNew).toBe(true);
    const rows = await RpeMonitoring.find({ athleteId: profile._id }).lean();
    expect(rows).toHaveLength(1);
  });

  test("elevated restingHeartRate surfaces amber + reason through the route", async () => {
    const { user } = await makeAthlete("rhr");
    const res = await request(buildApp())
      .post("/api/athlete/rpe-monitoring")
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ ...baseBody, restingHeartRate: 105 });
    expect(res.status).toBe(201);
    expect(res.body.entry.riskFlag).toBe("amber");
    expect(
      (res.body.entry.riskReasons as string[]).some((r) =>
        /resting heart rate/i.test(r)
      )
    ).toBe(true);
  });

  test("athlete cannot submit for another athlete — body athleteId ignored", async () => {
    const { user: ua } = await makeAthlete("alpha");
    const { profile: pb } = await makeAthlete("beta");
    const res = await request(buildApp())
      .post("/api/athlete/rpe-monitoring")
      .set("Authorization", `Bearer ${tokenFor(ua._id, "athlete")}`)
      .send({ ...baseBody, athleteId: pb._id.toString() });
    expect(res.status).toBe(201);
    const otherRows = await RpeMonitoring.countDocuments({
      athleteId: pb._id,
    });
    expect(otherRows).toBe(0);
  });

  test("duplicate AM same date upserts and keeps a single row", async () => {
    const { user, profile } = await makeAthlete("alpha");
    const t = tokenFor(user._id, "athlete");
    const app = buildApp();

    const first = await request(app)
      .post("/api/athlete/rpe-monitoring")
      .set("Authorization", `Bearer ${t}`)
      .send({ ...baseBody, rpe: 5 });
    expect(first.status).toBe(201);
    expect(first.body.wasNew).toBe(true);

    const second = await request(app)
      .post("/api/athlete/rpe-monitoring")
      .set("Authorization", `Bearer ${t}`)
      .send({ ...baseBody, rpe: 9, fatigue: 4 });
    expect(second.status).toBe(200);
    expect(second.body.wasNew).toBe(false);
    expect(second.body.entry.rpe).toBe(9);
    expect(second.body.entry.riskFlag).toBe("red");

    const count = await RpeMonitoring.countDocuments({
      athleteId: profile._id,
    });
    expect(count).toBe(1);
  });

  test("invalid input → 400", async () => {
    const { user } = await makeAthlete("alpha");
    const t = tokenFor(user._id, "athlete");
    const app = buildApp();

    const badCat = await request(app)
      .post("/api/athlete/rpe-monitoring")
      .set("Authorization", `Bearer ${t}`)
      .send({ ...baseBody, trainingCategory: "NOT_A_CATEGORY" });
    expect(badCat.status).toBe(400);
    expect(badCat.body.error).toBe("invalid_trainingCategory");

    const badRpe = await request(app)
      .post("/api/athlete/rpe-monitoring")
      .set("Authorization", `Bearer ${t}`)
      .send({ ...baseBody, rpe: 11 });
    expect(badRpe.status).toBe(400);
    expect(badRpe.body.error).toBe("invalid_rpe");
  });
});

describe("Coach RPE visibility", () => {
  test("coach can read assigned athlete RPE; cannot read unassigned", async () => {
    const admin = await makeUser("coach", "ad");
    const coachA = await makeUser("coach", "kumar");
    const coachB = await makeUser("coach", "singh");
    const { user: ua, profile: pa } = await makeAthlete("arjun");
    const { profile: pb } = await makeAthlete("diya");
    await CoachAthleteAssignment.create({
      coachId: coachA._id,
      athleteId: pa._id,
      assignedBy: admin._id,
    });
    await CoachAthleteAssignment.create({
      coachId: coachB._id,
      athleteId: pb._id,
      assignedBy: admin._id,
    });
    const app = buildApp();

    // Arjun submits AM RPE
    await request(app)
      .post("/api/athlete/rpe-monitoring")
      .set("Authorization", `Bearer ${tokenFor(ua._id, "athlete")}`)
      .send(baseBody);

    const ok = await request(app)
      .get(`/api/coach/athletes/${pa._id.toString()}/rpe-monitoring?date=${TODAY_STR}`)
      .set("Authorization", `Bearer ${tokenFor(coachA._id, "coach")}`);
    expect(ok.status).toBe(200);
    expect(ok.body.entries).toHaveLength(1);
    expect(ok.body.entries[0].riskFlag).toBe("green");

    const forbidden = await request(app)
      .get(`/api/coach/athletes/${pa._id.toString()}/rpe-monitoring?date=${TODAY_STR}`)
      .set("Authorization", `Bearer ${tokenFor(coachB._id, "coach")}`);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error).toBe("not_in_assignments");
  });
});

describe("Coach dashboard reflects submitted RPE", () => {
  test("after athlete posts RPE, /api/coach/dashboard cards[i].rpe is populated", async () => {
    const admin = await makeUser("coach", "ad");
    const coach = await makeUser("coach", "kumar");
    const { user: ua, profile } = await makeAthlete("arjun");
    await CoachAthleteAssignment.create({
      coachId: coach._id,
      athleteId: profile._id,
      assignedBy: admin._id,
    });
    const app = buildApp();

    // Arjun submits PM (red flag)
    await request(app)
      .post("/api/athlete/rpe-monitoring")
      .set("Authorization", `Bearer ${tokenFor(ua._id, "athlete")}`)
      .send({
        ...baseBody,
        sessionType: "PM",
        trainingCategory: "MAX SPEED",
        plannedIntensityPercent: 90,
        rpe: 9,
        fatigue: 4,
      });

    const dash = await request(app)
      .get(`/api/coach/dashboard?date=${TODAY_STR}`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);
    expect(dash.status).toBe(200);
    const card = dash.body.cards[0];
    expect(card.rpe).not.toBeNull();
    expect(card.rpe.sessionType).toBe("PM");
    expect(card.rpe.trainingCategory).toBe("MAX SPEED");
    expect(card.rpe.calculatedTrainingLoad).toBe(810);
    expect(card.rpe.riskFlag).toBe("red");
  });

  test("PM RPE preferred over AM when both exist", async () => {
    const admin = await makeUser("coach", "ad");
    const coach = await makeUser("coach", "kumar");
    const { user: ua, profile } = await makeAthlete("arjun");
    await CoachAthleteAssignment.create({
      coachId: coach._id,
      athleteId: profile._id,
      assignedBy: admin._id,
    });
    const app = buildApp();
    const t = tokenFor(ua._id, "athlete");

    await request(app)
      .post("/api/athlete/rpe-monitoring")
      .set("Authorization", `Bearer ${t}`)
      .send({ ...baseBody, sessionType: "AM", trainingCategory: "ENDURANCE" });
    await request(app)
      .post("/api/athlete/rpe-monitoring")
      .set("Authorization", `Bearer ${t}`)
      .send({ ...baseBody, sessionType: "PM", trainingCategory: "MAX SPEED" });

    const dash = await request(app)
      .get(`/api/coach/dashboard?date=${TODAY_STR}`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);
    expect(dash.body.cards[0].rpe.sessionType).toBe("PM");
    expect(dash.body.cards[0].rpe.trainingCategory).toBe("MAX SPEED");
    expect(dash.body.cards[0].rpeEntries.AM.trainingCategory).toBe("ENDURANCE");
    expect(dash.body.cards[0].rpeEntries.AFT).toBeNull();
    expect(dash.body.cards[0].rpeEntries.PM.trainingCategory).toBe("MAX SPEED");
  });
});

describe("GET /api/athlete/rpe-monitoring (self)", () => {
  test("returns own entries sorted AM, PM", async () => {
    const { user } = await makeAthlete("alpha");
    const t = tokenFor(user._id, "athlete");
    const app = buildApp();
    await request(app)
      .post("/api/athlete/rpe-monitoring")
      .set("Authorization", `Bearer ${t}`)
      .send({ ...baseBody, sessionType: "PM" });
    await request(app)
      .post("/api/athlete/rpe-monitoring")
      .set("Authorization", `Bearer ${t}`)
      .send({ ...baseBody, sessionType: "AM" });
    const res = await request(app)
      .get(`/api/athlete/rpe-monitoring?date=${TODAY_STR}`)
      .set("Authorization", `Bearer ${t}`);
    expect(res.status).toBe(200);
    expect(res.body.entries.map((e: { sessionType: string }) => e.sessionType)).toEqual([
      "AM",
      "PM",
    ]);
  });
});
