import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { CoachAthleteAssignment } from "../src/models/CoachAthleteAssignment";
import { GuardianAthleteLink } from "../src/models/GuardianAthleteLink";
import { Wellness } from "../src/models/Wellness";
import { RpeMonitoring } from "../src/models/RpeMonitoring";
import athleteRouter from "../src/routes/athlete";
import coachRouter from "../src/routes/coach";
import guardianRouter from "../src/routes/guardian";
import { buildTrendSeries } from "../src/services/trends";
import { dayOfWeek } from "../src/lib/trainingCategories";
import { signAccessToken } from "../src/lib/tokens";

let mongo: MongoMemoryServer;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/athlete", athleteRouter);
  app.use("/api/coach", coachRouter);
  app.use("/api/guardian", guardianRouter);
  return app;
}

async function makeUser(role: "coach" | "athlete" | "guardian", name: string) {
  return User.create({ email: `${name}@test.io`, passwordHash: "x", role, name });
}
async function makeAthlete(name: string) {
  const user = await makeUser("athlete", name);
  const profile = await AthleteProfile.create({ userId: user._id, sport: "athletics" });
  return { user, profile };
}
function tokenFor(userId: Types.ObjectId, role: "athlete" | "coach" | "guardian") {
  return signAccessToken({ sub: userId.toString(), role });
}

const DAY_MS = 24 * 60 * 60 * 1000;
function utcMidnight(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
const TODAY = utcMidnight();
const TODAY_STR = TODAY.toISOString().slice(0, 10);

async function seedWellness(athleteId: Types.ObjectId, date: Date, sq: number) {
  await Wellness.create({
    athleteId,
    date,
    sleepHours: 8,
    sleepQuality: sq,
    mood: sq,
    stress: 6 - sq,
    soreness: 6 - sq,
    fatigue: 6 - sq,
  });
}
async function seedRpe(athleteId: Types.ObjectId, date: Date, slot: "AM" | "PM", intensity: number, rpe: number) {
  await RpeMonitoring.create({
    athleteId,
    date,
    day: dayOfWeek(date),
    sessionType: slot,
    trainingCategory: "MAX SPEED",
    plannedIntensityPercent: intensity,
    rpe,
    sleepQuality: 4,
    muscleSoreness: 2,
    fatigue: 2,
    moodMotivation: 4,
  });
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

describe("buildTrendSeries", () => {
  test("emits `days` points oldest→newest, gap-fills nulls, sums daily load", async () => {
    const { profile } = await makeAthlete("trend-a");
    // Today: perfect wellness (readiness 100) + AM 80*5 and PM 90*6 load → 940.
    await seedWellness(profile._id, TODAY, 5);
    await seedRpe(profile._id, TODAY, "AM", 80, 5);
    await seedRpe(profile._id, TODAY, "PM", 90, 6);

    const series = await buildTrendSeries(profile._id, 3, TODAY);
    expect(series).toHaveLength(3);
    expect(series.map((p) => p.date)).toEqual([
      new Date(TODAY.getTime() - 2 * DAY_MS).toISOString().slice(0, 10),
      new Date(TODAY.getTime() - 1 * DAY_MS).toISOString().slice(0, 10),
      TODAY_STR,
    ]);
    // Oldest two days have no data → null.
    expect(series[0]).toMatchObject({ readiness: null, load: null });
    expect(series[1]).toMatchObject({ readiness: null, load: null });
    // Today.
    expect(series[2].readiness).toBe(100);
    expect(series[2].load).toBe(80 * 5 + 90 * 6);
    expect(series[2].sleepHours).toBe(8);
  });
});

describe("GET /api/athlete/trends (self)", () => {
  test("returns the self series", async () => {
    const { user, profile } = await makeAthlete("self-trend");
    await seedWellness(profile._id, TODAY, 4);
    const res = await request(buildApp())
      .get("/api/athlete/trends?days=7")
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`);
    expect(res.status).toBe(200);
    expect(res.body.days).toBe(7);
    expect(res.body.series).toHaveLength(7);
    expect(res.body.series[6].date).toBe(TODAY_STR);
    expect(res.body.series[6].readiness).toBe(75);
  });

  test("days param is clamped (0 → 1, 999 → 30)", async () => {
    const { user } = await makeAthlete("clamp-trend");
    const app = buildApp();
    const t = tokenFor(user._id, "athlete");
    const lo = await request(app).get("/api/athlete/trends?days=0").set("Authorization", `Bearer ${t}`);
    expect(lo.body.series).toHaveLength(1);
    const hi = await request(app).get("/api/athlete/trends?days=999").set("Authorization", `Bearer ${t}`);
    expect(hi.body.series).toHaveLength(30);
  });
});

describe("GET /api/coach/athletes/:id/trends (scoped)", () => {
  test("assigned coach → 200; unassigned → 403", async () => {
    const admin = await makeUser("coach", "ad");
    const coachA = await makeUser("coach", "kumar");
    const coachB = await makeUser("coach", "singh");
    const { profile } = await makeAthlete("scoped-trend");
    await seedWellness(profile._id, TODAY, 5);
    await CoachAthleteAssignment.create({ coachId: coachA._id, athleteId: profile._id, assignedBy: admin._id });
    const app = buildApp();

    const ok = await request(app)
      .get(`/api/coach/athletes/${profile._id}/trends?days=7`)
      .set("Authorization", `Bearer ${tokenFor(coachA._id, "coach")}`);
    expect(ok.status).toBe(200);
    expect(ok.body.series[6].readiness).toBe(100);

    const denied = await request(app)
      .get(`/api/coach/athletes/${profile._id}/trends?days=7`)
      .set("Authorization", `Bearer ${tokenFor(coachB._id, "coach")}`);
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe("not_in_assignments");
  });
});

describe("GET /api/guardian/athletes/:id/trends (removed)", () => {
  test("guardians have no trends access — endpoint doesn't exist", async () => {
    // Guardians are scoped to Sleep quality / Water intake / Attendance only
    // (see server/src/routes/guardian.ts); the trends endpoint was
    // deliberately removed from the guardian router.
    const guardian = await makeUser("guardian", "parent");
    const { profile: child } = await makeAthlete("g-child");
    await GuardianAthleteLink.create({ guardianId: guardian._id, athleteId: child._id });
    const app = buildApp();
    const t = tokenFor(guardian._id, "guardian");

    const res = await request(app).get(`/api/guardian/athletes/${child._id}/trends`).set("Authorization", `Bearer ${t}`);
    expect(res.status).toBe(404);
  });
});
