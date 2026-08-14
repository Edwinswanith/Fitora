import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { CoachAthleteAssignment } from "../src/models/CoachAthleteAssignment";
import { Wellness } from "../src/models/Wellness";
import { Attendance } from "../src/models/Attendance";
import { TrainingSession } from "../src/models/TrainingSession";
import { Recovery } from "../src/models/Recovery";
import { AthleteNote } from "../src/models/AthleteNote";
import { CoachComment } from "../src/models/CoachComment";
import { WaterIntake } from "../src/models/WaterIntake";
import athleteRouter from "../src/routes/athlete";
import coachRouter from "../src/routes/coach";
import notificationsRouter from "../src/routes/notifications";
import { signAccessToken } from "../src/lib/tokens";

let mongo: MongoMemoryServer;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/athlete", athleteRouter);
  app.use("/api/coach", coachRouter);
  app.use("/api/notifications", notificationsRouter);
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

async function makeAthlete(name: string, sport = "football") {
  const user = await makeUser("athlete", name);
  const profile = await AthleteProfile.create({
    userId: user._id,
    sport,
  });
  return { user, profile };
}

function tokenFor(userId: Types.ObjectId, role: "athlete" | "coach") {
  return signAccessToken({ sub: userId.toString(), role });
}

const TODAY = new Date(
  Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate()
  )
);
const TODAY_STR = TODAY.toISOString().slice(0, 10);

function daysAgo(days: number): Date {
  return new Date(TODAY.getTime() - days * 24 * 60 * 60 * 1000);
}

function daysAgoStr(days: number): string {
  return daysAgo(days).toISOString().slice(0, 10);
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

describe("Athlete RBAC isolation", () => {
  test("athlete A writes go only to athlete A's collections — never B's", async () => {
    const { user: ua, profile: pa } = await makeAthlete("alpha");
    const { profile: pb } = await makeAthlete("beta");

    const tokenA = tokenFor(ua._id, "athlete");
    const app = buildApp();

    // A submits attendance — even if client tries to spoof athleteId
    const res = await request(app)
      .post("/api/athlete/attendance")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ date: TODAY_STR, status: "present", athleteId: pb._id.toString() });
    expect(res.status).toBe(200);

    // Only A has an Attendance row
    const aCount = await Attendance.countDocuments({ athleteId: pa._id });
    const bCount = await Attendance.countDocuments({ athleteId: pb._id });
    expect(aCount).toBe(1);
    expect(bCount).toBe(0);
  });

  test("coach hitting athlete endpoint → 403 forbidden_role", async () => {
    const coach = await makeUser("coach", "coach-a");
    const token = tokenFor(coach._id, "coach");
    const res = await request(buildApp())
      .get("/api/athlete/daily")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  test("no token → 401 on athlete routes", async () => {
    const res = await request(buildApp()).get("/api/athlete/daily");
    expect(res.status).toBe(401);
  });
});

describe("Athlete profile management", () => {
  test("PATCH /me updates only the signed-in athlete's editable profile fields", async () => {
    const { user, profile } = await makeAthlete("ath-profile", "athletics");
    const app = buildApp();
    const academyId = new Types.ObjectId().toString();

    const res = await request(app)
      .patch("/api/athlete/me")
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({
        name: "Arjun Rao",
        email: "new-email@test.io",
        role: "coach",
        academyId,
        sport: "Athletics",
        position: "400m",
        timezone: "Asia/Kolkata",
        heightCm: 181,
        weightKg: 73,
        hydrationGoalMl: 3500,
        dob: "2001-05-07",
      });

    expect(res.status).toBe(200);
    expect(res.body.athlete).toMatchObject({
      name: "Arjun Rao",
      email: "ath-profile@test.io",
      sport: "Athletics",
      position: "400m",
      timezone: "Asia/Kolkata",
      heightCm: 181,
      weightKg: 73,
      hydrationGoalMl: 3500,
      dob: "2001-05-07",
    });

    const updatedUser = await User.findById(user._id).lean();
    const updatedProfile = await AthleteProfile.findById(profile._id).lean();
    expect(updatedUser?.email).toBe("ath-profile@test.io");
    expect(updatedUser?.role).toBe("athlete");
    expect(updatedProfile?.academyId).toBeFalsy();
  });

  test("invalid profile values are rejected without changing the profile", async () => {
    const { user, profile } = await makeAthlete("ath-profile-bad", "football");
    const res = await request(buildApp())
      .patch("/api/athlete/me")
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ hydrationGoalMl: 100 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_hydrationGoalMl");
    const unchanged = await AthleteProfile.findById(profile._id).lean();
    expect(unchanged?.hydrationGoalMl).toBe(3000);
  });
});

describe("Athlete check-in feeds the coach dashboard", () => {
  test("POST wellness → coach dashboard shows readinessScore & sleep & soreness", async () => {
    const admin = await makeUser("coach", "admin-w");
    const coach = await makeUser("coach", "coach-w");
    const { user: au, profile } = await makeAthlete("ath-w");
    await CoachAthleteAssignment.create({
      coachId: coach._id,
      athleteId: profile._id,
      assignedBy: admin._id,
    });

    const tokenA = tokenFor(au._id, "athlete");
    const tokenC = tokenFor(coach._id, "coach");
    const app = buildApp();

    const post = await request(app)
      .post("/api/athlete/wellness")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({
        date: TODAY_STR,
        sleepHours: 8,
        sleepQuality: 4,
        mood: 4,
        stress: 2,
        soreness: 2,
        fatigue: 2,
      });
    expect(post.status).toBe(200);

    const dash = await request(app)
      .get(`/api/coach/dashboard?date=${TODAY_STR}`)
      .set("Authorization", `Bearer ${tokenC}`);
    expect(dash.status).toBe(200);
    const card = dash.body.cards[0];
    expect(card.readinessScore).toBe(75);
    expect(card.sleep.hours).toBe(8);
    expect(card.sleep.quality).toBe(4);
    expect(card.soreness).toBe(2);
  });
});

describe("Athlete wellness validation", () => {
  test("out-of-range sleepQuality → 400 invalid_sleepQuality, nothing persisted", async () => {
    const { user, profile } = await makeAthlete("ath-wbad");
    const res = await request(buildApp())
      .post("/api/athlete/wellness")
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ date: TODAY_STR, sleepQuality: 9 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_sleepQuality");
    const count = await Wellness.countDocuments({ athleteId: profile._id });
    expect(count).toBe(0);
  });

  test("sleepHours above 14 → 400 invalid_sleepHours", async () => {
    const { user } = await makeAthlete("ath-whours");
    const res = await request(buildApp())
      .post("/api/athlete/wellness")
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ date: TODAY_STR, sleepHours: 30 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_sleepHours");
  });

  test("valid partial wellness still upserts (only provided fields)", async () => {
    const { user, profile } = await makeAthlete("ath-wok");
    const res = await request(buildApp())
      .post("/api/athlete/wellness")
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ date: TODAY_STR, sleepQuality: 4, mood: 5 });
    expect(res.status).toBe(200);
    const row = await Wellness.findOne({ athleteId: profile._id }).lean();
    expect(row?.sleepQuality).toBe(4);
    expect(row?.mood).toBe(5);
    expect(row?.stress ?? null).toBeNull();
  });
});

describe("Athlete water and heart-rate tracking", () => {
  test("water entries, delete, and analytics stay scoped to the signed-in athlete", async () => {
    const { user: ua, profile: pa } = await makeAthlete("water-a");
    const { profile: pb } = await makeAthlete("water-b");
    const tokenA = tokenFor(ua._id, "athlete");
    const app = buildApp();

    const first = await request(app)
      .post("/api/athlete/water")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ date: TODAY_STR, amountMl: 500 });
    expect(first.status).toBe(201);
    expect(first.body.totalMl).toBe(500);
    expect(first.body.entries).toHaveLength(1);

    const second = await request(app)
      .post("/api/athlete/water")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ date: TODAY_STR, amountMl: 250 });
    expect(second.status).toBe(201);
    expect(second.body.totalMl).toBe(750);

    const otherEntry = await WaterIntake.create({
      athleteId: pb._id,
      date: TODAY,
      amountMl: 1000,
      loggedAt: new Date(),
    });
    const blockedDelete = await request(app)
      .delete(`/api/athlete/water/${otherEntry._id.toString()}`)
      .set("Authorization", `Bearer ${tokenA}`);
    expect(blockedDelete.status).toBe(200);
    expect(await WaterIntake.exists({ _id: otherEntry._id })).toBeTruthy();

    const deleted = await request(app)
      .delete(`/api/athlete/water/${first.body.entries[0].id}`)
      .set("Authorization", `Bearer ${tokenA}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.totalMl).toBe(250);
    expect(await WaterIntake.countDocuments({ athleteId: pa._id })).toBe(1);

    const analytics = await request(app)
      .get("/api/athlete/analytics/water?days=30")
      .set("Authorization", `Bearer ${tokenA}`);
    expect(analytics.status).toBe(200);
    expect(analytics.body.goalMl).toBe(3000);
    expect(analytics.body.series.find((p: { date: string }) => p.date === TODAY_STR)?.totalMl).toBe(250);
  });

  test("repeating a water POST with the same clientActionId does not double-log", async () => {
    const { user, profile } = await makeAthlete("water-idem");
    const app = buildApp();
    const auth = `Bearer ${tokenFor(user._id, "athlete")}`;
    const body = { date: TODAY_STR, amountMl: 500, clientActionId: "water-voice-1" };

    const first = await request(app).post("/api/athlete/water").set("Authorization", auth).send(body);
    expect(first.status).toBe(201);
    expect(first.body.totalMl).toBe(500);

    const second = await request(app).post("/api/athlete/water").set("Authorization", auth).send(body);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(await WaterIntake.countDocuments({ athleteId: profile._id })).toBe(1);
  });

  test("heart-rate logs upsert only the athlete's own wellness row", async () => {
    const { user: ua, profile: pa } = await makeAthlete("hr-a");
    const { profile: pb } = await makeAthlete("hr-b");
    const res = await request(buildApp())
      .post("/api/athlete/heart-rate")
      .set("Authorization", `Bearer ${tokenFor(ua._id, "athlete")}`)
      .send({ date: TODAY_STR, athleteId: pb._id.toString(), wakeHr: 52, bedHr: 58 });

    expect(res.status).toBe(200);
    const own = await Wellness.findOne({ athleteId: pa._id }).lean();
    const other = await Wellness.findOne({ athleteId: pb._id }).lean();
    expect(own?.wakeHrBpm).toBe(52);
    expect(own?.bedHrBpm).toBe(58);
    expect(other).toBeNull();
  });

  test("heart-rate rejects invalid bpm without persisting", async () => {
    const { user, profile } = await makeAthlete("hr-bad");
    const res = await request(buildApp())
      .post("/api/athlete/heart-rate")
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ date: TODAY_STR, wakeHr: 10 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_wakeHr");
    expect(await Wellness.countDocuments({ athleteId: profile._id })).toBe(0);
  });
});

describe("Athlete achievements", () => {
  test("GET /achievements derives streak goals only from the signed-in athlete", async () => {
    const { user: ua, profile: pa } = await makeAthlete("ach-a");
    const { profile: pb } = await makeAthlete("ach-b");
    await AthleteProfile.updateOne({ _id: pa._id }, { $set: { hydrationGoalMl: 1000 } });
    await AthleteProfile.updateOne({ _id: pb._id }, { $set: { hydrationGoalMl: 1000 } });

    await Wellness.create(
      [0, 1, 2].map((day) => ({
        athleteId: pa._id,
        date: daysAgo(day),
        sleepQuality: 4,
      }))
    );
    await TrainingSession.create(
      [0, 1].map((day) => ({
        athleteId: pa._id,
        date: daysAgo(day),
        slot: "AM",
        status: "completed",
      }))
    );
    await WaterIntake.create(
      [0, 1, 2].map((day) => ({
        athleteId: pa._id,
        date: daysAgo(day),
        amountMl: 1000,
        loggedAt: daysAgo(day),
      }))
    );

    // Stronger logs for another athlete would inflate the result if scoping regressed.
    await Wellness.create(
      [0, 1, 2, 3, 4, 5, 6].map((day) => ({
        athleteId: pb._id,
        date: daysAgo(day),
        sleepQuality: 5,
      }))
    );
    await TrainingSession.create(
      [0, 1, 2, 3, 4, 5, 6].map((day) => ({
        athleteId: pb._id,
        date: daysAgo(day),
        slot: "AM",
        status: "completed",
      }))
    );
    await WaterIntake.create(
      [0, 1, 2, 3, 4, 5, 6].map((day) => ({
        athleteId: pb._id,
        date: daysAgo(day),
        amountMl: 1000,
        loggedAt: daysAgo(day),
      }))
    );

    const res = await request(buildApp())
      .get("/api/athlete/achievements?days=7")
      .set("Authorization", `Bearer ${tokenFor(ua._id, "athlete")}`);

    expect(res.status).toBe(200);
    expect(res.body.days).toBe(7);
    const goals = Object.fromEntries(
      res.body.goals.map((goal: { key: string }) => [goal.key, goal])
    ) as Record<
      string,
      {
        currentStreak: number;
        completedDays: number;
        longestStreak: number;
        achieved: boolean;
        reward: { title: string; unlocked: boolean };
        history: { date: string; met: boolean }[];
      }
    >;

    expect(goals.check_in.currentStreak).toBe(3);
    expect(goals.check_in.completedDays).toBe(3);
    expect(goals.check_in.longestStreak).toBe(3);
    expect(goals.training.currentStreak).toBe(2);
    expect(goals.hydration.currentStreak).toBe(3);
    expect(goals.all_rounder.currentStreak).toBe(2);
    expect(goals.check_in.achieved).toBe(false);
    expect(goals.check_in.reward).toMatchObject({
      title: "Consistency Badge",
      unlocked: false,
    });
    expect(goals.check_in.history).toHaveLength(7);
    expect(goals.check_in.history[6]).toMatchObject({ date: TODAY_STR, met: true });
    expect(goals.check_in.history[3]).toMatchObject({ date: daysAgoStr(3), met: false });
    expect(res.body.summary.nextGoal).toMatchObject({
      key: "all_rounder",
      remaining: 1,
    });
  });

  test("achievement reward unlocks after the streak target is met", async () => {
    const { user, profile } = await makeAthlete("ach-unlock");
    await Wellness.create(
      [0, 1, 2, 3, 4, 5, 6].map((day) => ({
        athleteId: profile._id,
        date: daysAgo(day),
        sleepQuality: 4,
      }))
    );

    const res = await request(buildApp())
      .get("/api/athlete/achievements?days=7")
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`);

    expect(res.status).toBe(200);
    const checkIn = res.body.goals.find((goal: { key: string }) => goal.key === "check_in");
    expect(checkIn).toMatchObject({
      currentStreak: 7,
      completedDays: 7,
      achieved: true,
      reward: {
        title: "Consistency Badge",
        unlocked: true,
      },
    });
    expect(res.body.summary.unlocked).toBe(1);
  });

  test("coach cannot read athlete achievements", async () => {
    const coach = await makeUser("coach", "ach-coach");
    const res = await request(buildApp())
      .get("/api/athlete/achievements")
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);
    expect(res.status).toBe(403);
  });
});

describe("Athlete attendance flow", () => {
  test("POST rest-day writes rest attendance and can clear it idempotently", async () => {
    const { user, profile } = await makeAthlete("ath-rest");
    const token = tokenFor(user._id, "athlete");
    const app = buildApp();

    const on = await request(app)
      .post("/api/athlete/rest-day")
      .set("Authorization", `Bearer ${token}`)
      .send({ date: TODAY_STR, enabled: true });
    expect(on.status).toBe(200);
    expect(on.body.isRestDay).toBe(true);
    expect(on.body.attendance.status).toBe("rest");

    const row = await Attendance.findOne({ athleteId: profile._id, date: TODAY }).lean();
    expect(row?.status).toBe("rest");

    const off = await request(app)
      .post("/api/athlete/rest-day")
      .set("Authorization", `Bearer ${token}`)
      .send({ date: TODAY_STR, enabled: false });
    expect(off.status).toBe(200);
    expect(off.body.isRestDay).toBe(false);
    expect(await Attendance.findOne({ athleteId: profile._id, date: TODAY }).lean()).toBeNull();
  });

  test("POST attendance accepts rest and coach dashboard marks isRestDay", async () => {
    const admin = await makeUser("coach", "admin-rest");
    const coach = await makeUser("coach", "coach-rest");
    const { user: au, profile } = await makeAthlete("ath-rest-card");
    await CoachAthleteAssignment.create({
      coachId: coach._id,
      athleteId: profile._id,
      assignedBy: admin._id,
    });

    const app = buildApp();
    const post = await request(app)
      .post("/api/athlete/attendance")
      .set("Authorization", `Bearer ${tokenFor(au._id, "athlete")}`)
      .send({ date: TODAY_STR, status: "rest" });
    expect(post.status).toBe(200);

    const dash = await request(app)
      .get(`/api/coach/dashboard?date=${TODAY_STR}`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);
    expect(dash.status).toBe(200);
    expect(dash.body.cards[0].attendance.status).toBe("rest");
    expect(dash.body.cards[0].isRestDay).toBe(true);
  });
  test("POST attendance late → coach dashboard reflects late", async () => {
    const admin = await makeUser("coach", "admin-a");
    const coach = await makeUser("coach", "coach-att");
    const { user: au, profile } = await makeAthlete("ath-att");
    await CoachAthleteAssignment.create({
      coachId: coach._id,
      athleteId: profile._id,
      assignedBy: admin._id,
    });
    const app = buildApp();

    await request(app)
      .post("/api/athlete/attendance")
      .set("Authorization", `Bearer ${tokenFor(au._id, "athlete")}`)
      .send({ date: TODAY_STR, status: "late" });

    const dash = await request(app)
      .get(`/api/coach/dashboard?date=${TODAY_STR}`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);
    expect(dash.body.cards[0].attendance.status).toBe("late");
  });

  test("invalid status → 400", async () => {
    const { user } = await makeAthlete("ath-bad");
    const res = await request(buildApp())
      .post("/api/athlete/attendance")
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ date: TODAY_STR, status: "tardy" });
    expect(res.status).toBe(400);
  });
});

describe("Athlete training completion", () => {
  test("POST /training/AM completed → coach dashboard reflects AM completed", async () => {
    const admin = await makeUser("coach", "admin-t");
    const coach = await makeUser("coach", "coach-t");
    const { user: au, profile } = await makeAthlete("ath-t");
    await CoachAthleteAssignment.create({
      coachId: coach._id,
      athleteId: profile._id,
      assignedBy: admin._id,
    });
    // Coach pre-seeds an AM session with type so we verify athlete only overrides status
    await TrainingSession.create({
      athleteId: profile._id,
      coachId: coach._id,
      date: TODAY,
      slot: "AM",
      type: "strength",
      status: "planned",
    });

    const app = buildApp();
    const post = await request(app)
      .post("/api/athlete/training/AM")
      .set("Authorization", `Bearer ${tokenFor(au._id, "athlete")}`)
      .send({ date: TODAY_STR, status: "completed" });
    expect(post.status).toBe(200);

    const dash = await request(app)
      .get(`/api/coach/dashboard?date=${TODAY_STR}`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);
    expect(dash.body.cards[0].sessions.AM.status).toBe("completed");
    expect(dash.body.cards[0].sessions.AM.type).toBe("strength");
  });

  test("completing a session auto-marks Attendance present → coach 'Present' count reflects it", async () => {
    const admin = await makeUser("coach", "admin-auto");
    const coach = await makeUser("coach", "coach-auto");
    const { user: au, profile } = await makeAthlete("ath-auto");
    await CoachAthleteAssignment.create({
      coachId: coach._id,
      athleteId: profile._id,
      assignedBy: admin._id,
    });

    const app = buildApp();

    // No attendance marked yet — coach should see 0 present.
    const before = await request(app)
      .get(`/api/coach/dashboard?date=${TODAY_STR}`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);
    expect(before.body.cards[0].attendance.status).toBeNull();

    // Athlete completes their AM session (fills in data, "comes to ground").
    const post = await request(app)
      .post("/api/athlete/training/AM")
      .set("Authorization", `Bearer ${tokenFor(au._id, "athlete")}`)
      .send({ date: TODAY_STR, status: "completed" });
    expect(post.status).toBe(200);

    const after = await request(app)
      .get(`/api/coach/dashboard?date=${TODAY_STR}`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);
    expect(after.body.cards[0].attendance.status).toBe("present");
  });

  test("invalid slot → 400", async () => {
    const { user } = await makeAthlete("ath-slot");
    const res = await request(buildApp())
      .post("/api/athlete/training/EVENING")
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ date: TODAY_STR, status: "completed" });
    expect(res.status).toBe(400);
  });
  test("POST /training/AFT persists athlete workout fields and ignores spoofed athleteId", async () => {
    const { user: ua, profile: pa } = await makeAthlete("ath-aft-a");
    const { profile: pb } = await makeAthlete("ath-aft-b");
    const app = buildApp();

    const res = await request(app)
      .post("/api/athlete/training/AFT")
      .set("Authorization", `Bearer ${tokenFor(ua._id, "athlete")}`)
      .send({
        date: TODAY_STR,
        athleteId: pb._id.toString(),
        attended: true,
        workoutType: "Tempo runs",
        sets: 4,
        reps: "100m",
        actualDurationMin: 42,
        effortRating: 8,
        notes: "Felt smooth.",
      });
    expect(res.status).toBe(200);
    expect(res.body.session.status).toBe("completed");
    expect(res.body.session.attended).toBe(true);
    expect(res.body.session.workoutType).toBe("Tempo runs");

    const own = await TrainingSession.findOne({ athleteId: pa._id, slot: "AFT" }).lean();
    const otherCount = await TrainingSession.countDocuments({ athleteId: pb._id });
    expect(own).toMatchObject({
      status: "completed",
      attended: true,
      workoutType: "Tempo runs",
      sets: 4,
      reps: "100m",
      actualDurationMin: 42,
      effortRating: 8,
      notes: "Felt smooth.",
    });
    expect(otherCount).toBe(0);
  });
});

describe("Athlete notes ↔ coach comments", () => {
  test("athlete appends two notes same day; coach can post comment; athlete reads it", async () => {
    const admin = await makeUser("coach", "admin-n");
    const coach = await makeUser("coach", "coach-n");
    const { user: au, profile } = await makeAthlete("ath-n");
    await CoachAthleteAssignment.create({
      coachId: coach._id,
      athleteId: profile._id,
      assignedBy: admin._id,
    });
    const app = buildApp();
    const ta = tokenFor(au._id, "athlete");
    const tc = tokenFor(coach._id, "coach");

    await request(app)
      .post("/api/athlete/notes")
      .set("Authorization", `Bearer ${ta}`)
      .send({ date: TODAY_STR, body: "Calf feels tight" });
    await request(app)
      .post("/api/athlete/notes")
      .set("Authorization", `Bearer ${ta}`)
      .send({ date: TODAY_STR, body: "Sleep was poor" });

    const notes = await request(app)
      .get(`/api/athlete/notes?date=${TODAY_STR}`)
      .set("Authorization", `Bearer ${ta}`);
    expect(notes.body.notes).toHaveLength(2);

    // Coach posts a comment
    const comment = await request(app)
      .post(`/api/coach/athletes/${profile._id.toString()}/comment`)
      .set("Authorization", `Bearer ${tc}`)
      .send({ date: TODAY_STR, body: "Drop intensity 10%; ice after." });
    expect(comment.status).toBe(201);

    // Athlete reads coach feedback
    const feedback = await request(app)
      .get(`/api/athlete/coach-comments?date=${TODAY_STR}`)
      .set("Authorization", `Bearer ${ta}`);
    expect(feedback.body.comments).toHaveLength(1);
    expect(feedback.body.comments[0].body).toBe("Drop intensity 10%; ice after.");
  });

  test("repeating a notes POST with the same clientActionId does not double-append", async () => {
    const { user, profile } = await makeAthlete("notes-idem");
    const app = buildApp();
    const auth = `Bearer ${tokenFor(user._id, "athlete")}`;
    const body = { date: TODAY_STR, body: "Calf feels tight", clientActionId: "notes-voice-1" };

    const first = await request(app).post("/api/athlete/notes").set("Authorization", auth).send(body);
    expect(first.status).toBe(201);

    const second = await request(app).post("/api/athlete/notes").set("Authorization", auth).send(body);
    expect(second.status).toBe(201);
    expect(second.body.note._id).toBe(first.body.note._id);
    expect(await AthleteNote.countDocuments({ athleteId: profile._id })).toBe(1);
  });

  test("coach cannot comment on unassigned athlete → 403", async () => {
    const coach = await makeUser("coach", "coach-x");
    const { profile } = await makeAthlete("ath-other");
    const res = await request(buildApp())
      .post(`/api/coach/athletes/${profile._id.toString()}/comment`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .send({ date: TODAY_STR, body: "hello" });
    expect(res.status).toBe(403);
  });

  test("empty body → 400", async () => {
    const { user } = await makeAthlete("ath-empty");
    const res = await request(buildApp())
      .post("/api/athlete/notes")
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ date: TODAY_STR, body: "" });
    expect(res.status).toBe(400);
  });
});

describe("Athlete write rate limit", () => {
  test("excessive writes from one athlete → 429 too_many_requests", async () => {
    const { user } = await makeAthlete("ath-flood");
    const token = tokenFor(user._id, "athlete");
    const app = buildApp();

    // The limiter allows 40 writes/min/athlete; the 41st is throttled.
    let lastOk = 0;
    for (let i = 0; i < 40; i++) {
      const r = await request(app)
        .post("/api/athlete/wellness")
        .set("Authorization", `Bearer ${token}`)
        .send({ date: TODAY_STR, sleepQuality: 4 });
      if (r.status === 200) lastOk++;
    }
    expect(lastOk).toBe(40);

    const blocked = await request(app)
      .post("/api/athlete/wellness")
      .set("Authorization", `Bearer ${token}`)
      .send({ date: TODAY_STR, sleepQuality: 4 });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe("too_many_requests");
  });

  test("reads are never throttled", async () => {
    const { user } = await makeAthlete("ath-reader");
    const token = tokenFor(user._id, "athlete");
    const app = buildApp();
    for (let i = 0; i < 50; i++) {
      const r = await request(app)
        .get(`/api/athlete/notes?date=${TODAY_STR}`)
        .set("Authorization", `Bearer ${token}`);
      expect(r.status).toBe(200);
    }
  });
});

describe("Athlete announcements and notifications", () => {
  test("coach announcements reach only linked athletes; independent athletes stay clean", async () => {
    const admin = await makeUser("coach", "admin-ann");
    const coach = await makeUser("coach", "coach-ann");
    const { user: linkedUser, profile: linkedProfile } = await makeAthlete("linked-ann");
    const { user: soloUser } = await makeAthlete("solo-ann");
    await CoachAthleteAssignment.create({
      coachId: coach._id,
      athleteId: linkedProfile._id,
      assignedBy: admin._id,
    });

    const app = buildApp();
    const coachPost = await request(app)
      .post("/api/coach/announcements")
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .send({ body: "Recovery session moved to 5 PM." });
    expect(coachPost.status).toBe(201);
    expect(coachPost.body.recipientCount).toBe(1);

    const linkedAnnouncements = await request(app)
      .get("/api/athlete/announcements")
      .set("Authorization", `Bearer ${tokenFor(linkedUser._id, "athlete")}`);
    expect(linkedAnnouncements.status).toBe(200);
    expect(linkedAnnouncements.body.coachCount).toBe(1);
    expect(linkedAnnouncements.body.announcements).toHaveLength(1);

    const soloAnnouncements = await request(app)
      .get("/api/athlete/announcements")
      .set("Authorization", `Bearer ${tokenFor(soloUser._id, "athlete")}`);
    expect(soloAnnouncements.status).toBe(200);
    expect(soloAnnouncements.body).toEqual({ announcements: [], coachCount: 0 });

    const linkedInbox = await request(app)
      .get("/api/notifications")
      .set("Authorization", `Bearer ${tokenFor(linkedUser._id, "athlete")}`);
    expect(linkedInbox.status).toBe(200);
    expect(linkedInbox.body.unreadCount).toBe(1);
    expect(linkedInbox.body.notifications[0]).toMatchObject({
      type: "announcement",
      body: "Recovery session moved to 5 PM.",
    });

    const crossRead = await request(app)
      .post(`/api/notifications/${linkedInbox.body.notifications[0].id}/read`)
      .set("Authorization", `Bearer ${tokenFor(soloUser._id, "athlete")}`);
    expect(crossRead.status).toBe(200);

    const linkedStillUnread = await request(app)
      .get("/api/notifications/unread-count")
      .set("Authorization", `Bearer ${tokenFor(linkedUser._id, "athlete")}`);
    expect(linkedStillUnread.body.unreadCount).toBe(1);

    const soloInbox = await request(app)
      .get("/api/notifications")
      .set("Authorization", `Bearer ${tokenFor(soloUser._id, "athlete")}`);
    expect(soloInbox.status).toBe(200);
    expect(soloInbox.body.unreadCount).toBe(0);
    expect(soloInbox.body.notifications).toHaveLength(0);
  });
});

describe("Athlete recovery", () => {
  test("POST recovery upserts modalities; second POST replaces", async () => {
    const { user, profile } = await makeAthlete("ath-r");
    const t = tokenFor(user._id, "athlete");
    const app = buildApp();

    await request(app)
      .post("/api/athlete/recovery")
      .set("Authorization", `Bearer ${t}`)
      .send({ date: TODAY_STR, modalities: ["stretching", "ice_bath"] });

    await request(app)
      .post("/api/athlete/recovery")
      .set("Authorization", `Bearer ${t}`)
      .send({ date: TODAY_STR, modalities: ["hydration"] });

    const rows = await Recovery.find({ athleteId: profile._id }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0].modalities).toEqual(["hydration"]);
  });

  test("ignores unknown modality strings", async () => {
    const { user, profile } = await makeAthlete("ath-rbad");
    await request(buildApp())
      .post("/api/athlete/recovery")
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ date: TODAY_STR, modalities: ["stretching", "magic_potion"] });

    const row = await Recovery.findOne({ athleteId: profile._id }).lean();
    expect(row?.modalities).toEqual(["stretching"]);
  });
});
