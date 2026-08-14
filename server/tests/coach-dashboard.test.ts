import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { CoachAthleteAssignment } from "../src/models/CoachAthleteAssignment";
import { Attendance } from "../src/models/Attendance";
import { TrainingSession } from "../src/models/TrainingSession";
import { Wellness } from "../src/models/Wellness";
import { Recovery } from "../src/models/Recovery";
import { Performance } from "../src/models/Performance";
import { Injury } from "../src/models/Injury";
import coachRouter from "../src/routes/coach";
import { signAccessToken } from "../src/lib/tokens";
import { computeReadiness } from "../src/services/dashboard";

let mongo: MongoMemoryServer;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/coach", coachRouter);
  return app;
}

async function makeUser(
  role: "coach" | "athlete",
  name: string
) {
  return User.create({
    email: `${name}@test.io`,
    passwordHash: "x",
    role,
    name,
  });
}

async function makeAthlete(name: string, sport = "football", position?: string) {
  const user = await makeUser("athlete", name);
  const profile = await AthleteProfile.create({
    userId: user._id,
    sport,
    position,
  });
  return { user, profile };
}

async function assign(
  coachUserId: Types.ObjectId,
  athleteProfileId: Types.ObjectId,
  adminId: Types.ObjectId
) {
  await CoachAthleteAssignment.create({
    coachId: coachUserId,
    athleteId: athleteProfileId,
    assignedBy: adminId,
  });
}

function utcDay(iso: string) {
  return new Date(iso + "T00:00:00.000Z");
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
  await Promise.all(
    Object.values(mongoose.connection.collections).map((c) => c.deleteMany({}))
  );
});

describe("computeReadiness", () => {
  test("returns null when no inputs", () => {
    expect(computeReadiness(null)).toBeNull();
    expect(computeReadiness({} as never)).toBeNull();
  });
  test("perfect inputs → 100", () => {
    const r = computeReadiness({
      sleepQuality: 5,
      mood: 5,
      stress: 1,
      soreness: 1,
      fatigue: 1,
    } as never);
    expect(r).toBe(100);
  });
  test("worst inputs → 0", () => {
    const r = computeReadiness({
      sleepQuality: 1,
      mood: 1,
      stress: 5,
      soreness: 5,
      fatigue: 5,
    } as never);
    expect(r).toBe(0);
  });
});

describe("GET /api/coach/athletes", () => {
  test("returns only assigned athletes for the coach", async () => {
    const admin = await makeUser("coach", "admin1");
    const coachA = await makeUser("coach", "coach-a");
    const coachB = await makeUser("coach", "coach-b");
    const { profile: a1 } = await makeAthlete("a1");
    const { profile: a2 } = await makeAthlete("a2");
    const { profile: b1 } = await makeAthlete("b1");

    await assign(coachA._id, a1._id, admin._id);
    await assign(coachA._id, a2._id, admin._id);
    await assign(coachB._id, b1._id, admin._id);

    const token = signAccessToken({ sub: coachA._id.toString(), role: "coach" });
    const res = await request(buildApp())
      .get("/api/coach/athletes")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const ids = (res.body.athletes as { athleteId: string }[])
      .map((a) => a.athleteId)
      .sort();
    expect(ids).toEqual([a1._id.toString(), a2._id.toString()].sort());
  });

  test("401 without token", async () => {
    const res = await request(buildApp()).get("/api/coach/athletes");
    expect(res.status).toBe(401);
  });

  test("403 for athlete role", async () => {
    const { user } = await makeAthlete("athlete-403");
    const token = signAccessToken({ sub: user._id.toString(), role: "athlete" });
    const res = await request(buildApp())
      .get("/api/coach/athletes")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/coach/dashboard", () => {
  test("returns daily cards limited to assigned athletes with all required fields", async () => {
    const date = "2026-05-27";
    const dateObj = utcDay(date);
    const admin = await makeUser("coach", "admin-d");
    const coach = await makeUser("coach", "coach-d");
    const otherCoach = await makeUser("coach", "coach-other");

    const { profile: mine } = await makeAthlete("mine", "football", "striker");
    const { profile: notMine } = await makeAthlete("not-mine");

    await assign(coach._id, mine._id, admin._id);
    await assign(otherCoach._id, notMine._id, admin._id);

    await Attendance.create({
      athleteId: mine._id,
      date: dateObj,
      status: "present",
      recordedBy: coach._id,
    });
    await TrainingSession.create({
      athleteId: mine._id,
      coachId: coach._id,
      date: dateObj,
      slot: "AM",
      type: "strength",
      status: "completed",
      attended: true,
      workoutType: "Gym strength",
      sets: 5,
      reps: "5",
      actualDurationMin: 55,
      effortRating: 7,
    });
    await TrainingSession.create({
      athleteId: mine._id,
      coachId: coach._id,
      date: dateObj,
      slot: "PM",
      type: "skill",
      status: "planned",
    });
    await Wellness.create({
      athleteId: mine._id,
      date: dateObj,
      sleepHours: 8,
      sleepQuality: 4,
      mood: 4,
      stress: 2,
      soreness: 2,
      fatigue: 2,
    });
    await Recovery.create({
      athleteId: mine._id,
      date: dateObj,
      recoveryScore: 78,
      status: "green",
      restingHr: 54,
      hrv: 88,
    });
    await Performance.create({
      athleteId: mine._id,
      date: dateObj,
      metric: "100m",
      value: 11.2,
      unit: "s",
      context: "test",
    });
    await Injury.create({
      athleteId: mine._id,
      bodyPart: "hamstring",
      severity: "mild",
      status: "monitoring",
      restriction: "no sprints",
    });

    const token = signAccessToken({ sub: coach._id.toString(), role: "coach" });
    const res = await request(buildApp())
      .get(`/api/coach/dashboard?date=${date}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.date).toBe(date);
    expect(res.body.count).toBe(1);
    expect(res.body.cards).toHaveLength(1);

    const card = res.body.cards[0];
    expect(card.athleteId).toBe(mine._id.toString());
    expect(card.name).toBe("mine");
    expect(card.position).toBe("striker");
    expect(card.attendance.status).toBe("present");
    expect(card.sessions.AM.status).toBe("completed");
    expect(card.sessions.PM.status).toBe("planned");
    expect(card.sessions.AM).toMatchObject({
      attended: true,
      workoutType: "Gym strength",
      sets: 5,
      reps: "5",
      actualDurationMin: 55,
      effortRating: 7,
    });
    expect(card.readinessScore).toBe(75);
    expect(card.sleep).toEqual({ hours: 8, quality: 4 });
    expect(card.soreness).toBe(2);
    // The daily card intentionally omits performance — it's loaded on demand by
    // the athlete-detail performance tab, not surfaced on the dashboard cards.
    expect(card.performance).toBeUndefined();
    expect(card.recovery).toMatchObject({ status: "green", score: 78 });
    expect(card.injury).toMatchObject({
      active: true,
      bodyPart: "hamstring",
      restriction: "no sprints",
    });

    // Critical: the other coach's athlete must not appear
    const allIds = (res.body.cards as { athleteId: string }[]).map((c) => c.athleteId);
    expect(allIds).not.toContain(notMine._id.toString());
  });

  test("empty array when coach has no assignments", async () => {
    const coach = await makeUser("coach", "lonely-coach");
    const token = signAccessToken({ sub: coach._id.toString(), role: "coach" });

    const res = await request(buildApp())
      .get("/api/coach/dashboard")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.cards).toEqual([]);
  });

});

describe("GET /api/coach/athletes/:athleteId/daily-card", () => {
  test("assigned coach gets the card", async () => {
    const date = "2026-05-27";
    const dateObj = utcDay(date);
    const admin = await makeUser("coach", "admin-c");
    const coach = await makeUser("coach", "coach-c");
    const { profile } = await makeAthlete("athlete-c");
    await assign(coach._id, profile._id, admin._id);
    await Wellness.create({
      athleteId: profile._id,
      date: dateObj,
      sleepHours: 7,
      sleepQuality: 3,
      mood: 3,
      stress: 3,
      soreness: 3,
      fatigue: 3,
    });

    const token = signAccessToken({ sub: coach._id.toString(), role: "coach" });
    const res = await request(buildApp())
      .get(`/api/coach/athletes/${profile._id.toString()}/daily-card?date=${date}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.card.athleteId).toBe(profile._id.toString());
    expect(res.body.card.readinessScore).toBe(50);
  });

  test("unassigned coach gets 403 not_in_assignments", async () => {
    const coach = await makeUser("coach", "coach-no");
    const { profile } = await makeAthlete("athlete-no");
    const token = signAccessToken({ sub: coach._id.toString(), role: "coach" });

    const res = await request(buildApp())
      .get(`/api/coach/athletes/${profile._id.toString()}/daily-card`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("not_in_assignments");
  });

  test("invalid id → 400", async () => {
    const coach = await makeUser("coach", "coach-bad");
    const token = signAccessToken({ sub: coach._id.toString(), role: "coach" });
    const res = await request(buildApp())
      .get(`/api/coach/athletes/not-an-id/daily-card`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});
