import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { Academy } from "../src/models/Academy";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { CoachAthleteAssignment } from "../src/models/CoachAthleteAssignment";
import { GuardianAthleteLink } from "../src/models/GuardianAthleteLink";
import { Wellness } from "../src/models/Wellness";
import { Attendance } from "../src/models/Attendance";
import { TrainingSession } from "../src/models/TrainingSession";
import { Performance } from "../src/models/Performance";
import { RpeMonitoring } from "../src/models/RpeMonitoring";
import { AthleteNote } from "../src/models/AthleteNote";
import { CoachComment } from "../src/models/CoachComment";
import athleteRouter from "../src/routes/athlete";
import coachRouter from "../src/routes/coach";
import guardianRouter from "../src/routes/guardian";
import {
  buildWellnessSeries,
  buildSessionSeries,
  buildAttendanceSeries,
  buildPerformanceSeries,
  buildSquadSeries,
  buildCoachNotesInbox,
} from "../src/services/analytics";
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

async function makeUser(role: string, name: string, academyId?: Types.ObjectId) {
  return User.create({ email: `${name}@test.io`, passwordHash: "x", role, name, academyId });
}
async function makeAthlete(name: string, academyId?: Types.ObjectId) {
  const user = await makeUser("athlete", name, academyId);
  const profile = await AthleteProfile.create({ userId: user._id, sport: "athletics", academyId });
  return { user, profile };
}
function tokenFor(userId: Types.ObjectId, role: string) {
  return signAccessToken({ sub: userId.toString(), role: role as never });
}

const DAY_MS = 24 * 60 * 60 * 1000;
function utcMidnight(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
const TODAY = utcMidnight();
const TODAY_STR = TODAY.toISOString().slice(0, 10);

async function seedWellness(athleteId: Types.ObjectId, date: Date, sq: number) {
  await Wellness.create({
    athleteId, date, sleepHours: 8, sleepQuality: sq, mood: sq, stress: 6 - sq, soreness: 6 - sq, fatigue: 6 - sq,
  });
}
async function seedAttendance(athleteId: Types.ObjectId, date: Date, status: string) {
  await Attendance.create({ athleteId, date, status, recordedBy: new Types.ObjectId() });
}
async function seedSession(athleteId: Types.ObjectId, date: Date, slot: "AM" | "PM", status: string) {
  await TrainingSession.create({ athleteId, coachId: new Types.ObjectId(), date, slot, type: "strength", status });
}
async function seedPerformance(athleteId: Types.ObjectId, date: Date, metric: string, value: number) {
  await Performance.create({ athleteId, date, metric, value, unit: "s", context: "test" });
}
async function seedRpe(athleteId: Types.ObjectId, date: Date, slot: "AM" | "PM", intensity: number, rpe: number) {
  await RpeMonitoring.create({
    athleteId, date, day: dayOfWeek(date), sessionType: slot, trainingCategory: "MAX SPEED",
    plannedIntensityPercent: intensity, rpe, sleepQuality: 4, muscleSoreness: 2, fatigue: 2, moodMotivation: 4,
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

describe("analytics service builders", () => {
  test("wellness series: N points oldest→newest, today populated, gaps null", async () => {
    const { profile } = await makeAthlete("w");
    await seedWellness(profile._id, TODAY, 4);
    const series = await buildWellnessSeries(profile._id, 5, TODAY);
    expect(series).toHaveLength(5);
    expect(series[4]).toMatchObject({ date: TODAY_STR, sleepHours: 8, sleepQuality: 4, mood: 4, stress: 2 });
    expect(series[0]).toMatchObject({ sleepHours: null, mood: null });
  });

  test("session series: completion rate from AM/PM statuses", async () => {
    const { profile } = await makeAthlete("s");
    await seedSession(profile._id, TODAY, "AM", "completed");
    await seedSession(profile._id, TODAY, "PM", "skipped");
    const series = await buildSessionSeries(profile._id, 3, TODAY);
    expect(series[2]).toMatchObject({ completed: 1, skipped: 1, completionRate: 50 });
  });

  test("attendance series: status per day + present rate", async () => {
    const { profile } = await makeAthlete("a");
    await seedAttendance(profile._id, TODAY, "present");
    await seedAttendance(profile._id, new Date(TODAY.getTime() - DAY_MS), "late");
    const out = await buildAttendanceSeries(profile._id, 3, TODAY);
    expect(out.series[2].status).toBe("present");
    expect(out.presentRate).toBe(50); // 1 present of 2 rows
  });

  test("performance series: metrics list + sorted points", async () => {
    const { profile } = await makeAthlete("p");
    await seedPerformance(profile._id, new Date(TODAY.getTime() - 2 * DAY_MS), "100m", 11.4);
    await seedPerformance(profile._id, TODAY, "100m", 11.2);
    const out = await buildPerformanceSeries(profile._id, undefined, 7, TODAY);
    expect(out.metrics).toContain("100m");
    expect(out.series).toHaveLength(2);
    expect(out.series[1].value).toBe(11.2);
  });

  test("squad series: averages across multiple athletes", async () => {
    const a = await makeAthlete("sq-a");
    const b = await makeAthlete("sq-b");
    await seedWellness(a.profile._id, TODAY, 5); // readiness 100
    await seedWellness(b.profile._id, TODAY, 1); // readiness 0
    await seedRpe(a.profile._id, TODAY, "AM", 80, 5); // load 400
    await seedRpe(b.profile._id, TODAY, "AM", 60, 5); // load 300
    const series = await buildSquadSeries([a.profile._id, b.profile._id], 3, TODAY);
    expect(series[2]).toMatchObject({ avgReadiness: 50, avgLoad: 350, athleteCount: 2 });
  });
});

describe("athlete analytics endpoints (self)", () => {
  test("wellness + performance return shaped data", async () => {
    const { user, profile } = await makeAthlete("self");
    await seedWellness(profile._id, TODAY, 4);
    await seedPerformance(profile._id, TODAY, "vertical_jump", 58);
    const app = buildApp();
    const t = tokenFor(user._id, "athlete");

    const w = await request(app).get("/api/athlete/analytics/wellness?days=7").set("Authorization", `Bearer ${t}`);
    expect(w.status).toBe(200);
    expect(w.body.series).toHaveLength(7);
    expect(w.body.series[6].sleepQuality).toBe(4);

    const p = await request(app).get("/api/athlete/analytics/performance").set("Authorization", `Bearer ${t}`);
    expect(p.status).toBe(200);
    expect(p.body.metrics).toContain("vertical_jump");
    expect(p.body.series[0].value).toBe(58);
  });
});

describe("coach analytics (scoped)", () => {
  test("per-athlete analytics: assigned → 200, unassigned → 403", async () => {
    const admin = await makeUser("coach", "ad");
    const coachA = await makeUser("coach", "kumar");
    const coachB = await makeUser("coach", "singh");
    const { profile } = await makeAthlete("ca");
    await seedWellness(profile._id, TODAY, 4);
    await CoachAthleteAssignment.create({ coachId: coachA._id, athleteId: profile._id, assignedBy: admin._id });
    const app = buildApp();

    const ok = await request(app)
      .get(`/api/coach/athletes/${profile._id}/analytics/wellness`)
      .set("Authorization", `Bearer ${tokenFor(coachA._id, "coach")}`);
    expect(ok.status).toBe(200);
    expect(ok.body.series.at(-1).sleepQuality).toBe(4);

    const denied = await request(app)
      .get(`/api/coach/athletes/${profile._id}/analytics/wellness`)
      .set("Authorization", `Bearer ${tokenFor(coachB._id, "coach")}`);
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe("not_in_assignments");
  });

  test("squad rollup is limited to the coach's own assigned athletes", async () => {
    const admin = await makeUser("coach", "ad2");
    const coachA = await makeUser("coach", "kumar2");
    const coachB = await makeUser("coach", "singh2");
    const mine = await makeAthlete("mine");
    const theirs = await makeAthlete("theirs");
    await CoachAthleteAssignment.create({ coachId: coachA._id, athleteId: mine.profile._id, assignedBy: admin._id });
    await CoachAthleteAssignment.create({ coachId: coachB._id, athleteId: theirs.profile._id, assignedBy: admin._id });
    await seedRpe(mine.profile._id, TODAY, "AM", 80, 5); // load 400
    await seedRpe(theirs.profile._id, TODAY, "AM", 90, 6); // load 540 (must NOT appear for coachA)
    const app = buildApp();

    const res = await request(app)
      .get("/api/coach/analytics/squad?days=2")
      .set("Authorization", `Bearer ${tokenFor(coachA._id, "coach")}`);
    expect(res.status).toBe(200);
    const today = res.body.series.at(-1);
    expect(today.athleteCount).toBe(1);
    expect(today.avgLoad).toBe(400); // only `mine`, not 540
  });
});

describe("guardian analytics (removed)", () => {
  test("guardians have no analytics access — endpoint doesn't exist", async () => {
    // Guardians are scoped to Sleep quality / Water intake / Attendance only
    // (see server/src/routes/guardian.ts); analytics/chart endpoints were
    // deliberately removed from the guardian router.
    const guardian = await makeUser("guardian", "parent");
    const child = await makeAthlete("child");
    await GuardianAthleteLink.create({ guardianId: guardian._id, athleteId: child.profile._id });
    const app = buildApp();
    const t = tokenFor(guardian._id, "guardian");

    const res = await request(app).get(`/api/guardian/athletes/${child.profile._id}/analytics/wellness`).set("Authorization", `Bearer ${t}`);
    expect(res.status).toBe(404);
  });
});

describe("coach notes inbox (scoped)", () => {
  test("flags needsReply until the coach replies on/after the note date", async () => {
    const a = await makeAthlete("noteA");
    await AthleteNote.create({ athleteId: a.profile._id, date: TODAY, body: "knee tight" });

    let inbox = await buildCoachNotesInbox([a.profile._id], 7, TODAY);
    expect(inbox.openCount).toBe(1);
    expect(inbox.notes[0]).toMatchObject({ body: "knee tight", athleteName: "noteA", needsReply: true });

    // coach replies same day → resolved
    await CoachComment.create({ athleteId: a.profile._id, coachId: new Types.ObjectId(), date: TODAY, body: "rest it" });
    inbox = await buildCoachNotesInbox([a.profile._id], 7, TODAY);
    expect(inbox.openCount).toBe(0);
    expect(inbox.notes[0].needsReply).toBe(false);
  });

  test("endpoint returns only the coach's own roster notes", async () => {
    const admin = await makeUser("coach", "adN");
    const coachA = await makeUser("coach", "kaN");
    const coachB = await makeUser("coach", "kbN");
    const mine = await makeAthlete("mineN");
    const theirs = await makeAthlete("theirsN");
    await CoachAthleteAssignment.create({ coachId: coachA._id, athleteId: mine.profile._id, assignedBy: admin._id });
    await CoachAthleteAssignment.create({ coachId: coachB._id, athleteId: theirs.profile._id, assignedBy: admin._id });
    await AthleteNote.create({ athleteId: mine.profile._id, date: TODAY, body: "mine note" });
    await AthleteNote.create({ athleteId: theirs.profile._id, date: TODAY, body: "theirs note" });

    const res = await request(buildApp())
      .get("/api/coach/notes-inbox")
      .set("Authorization", `Bearer ${tokenFor(coachA._id, "coach")}`);
    expect(res.status).toBe(200);
    expect(res.body.notes).toHaveLength(1);
    expect(res.body.notes[0].body).toBe("mine note");
    expect(res.body.openCount).toBe(1);
  });
});

