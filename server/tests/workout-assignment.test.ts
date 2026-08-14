import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { CoachAthleteAssignment } from "../src/models/CoachAthleteAssignment";
import { WorkoutTemplate } from "../src/models/WorkoutTemplate";
import { WorkoutAssignment } from "../src/models/WorkoutAssignment";
import { TrainingSession } from "../src/models/TrainingSession";
import { Attendance } from "../src/models/Attendance";
import coachWorkoutRouter from "../src/routes/coachWorkout";
import athleteWorkoutRouter from "../src/routes/athleteWorkout";
import { signAccessToken } from "../src/lib/tokens";

let mongo: MongoMemoryServer;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/coach", coachWorkoutRouter);
  app.use("/api/athlete", athleteWorkoutRouter);
  return app;
}

async function makeUser(role: "coach" | "athlete", name: string) {
  return User.create({ email: `${name}@test.io`, passwordHash: "x", role, name });
}
function tokenFor(id: Types.ObjectId, role: "coach" | "athlete") {
  return signAccessToken({ sub: id.toString(), role });
}
async function makeCoachWithAthlete(coachName: string, athleteName: string) {
  const coach = await makeUser("coach", coachName);
  const athleteUser = await makeUser("athlete", athleteName);
  const profile = await AthleteProfile.create({ userId: athleteUser._id, sport: "football" });
  await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id });
  return { coach, athleteUser, profile };
}
async function makeTemplate(coachId: Types.ObjectId, exercises: unknown[]) {
  return WorkoutTemplate.create({
    ownerId: coachId,
    ownerRole: "coach",
    name: "Push Day",
    exercises: exercises.map((e, i) => ({ ...(e as object), order: i })),
    version: 1,
  });
}

const TODAY = "2026-08-14";

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
});

describe("Assignment creation and snapshot immutability", () => {
  test("THE critical scenario: editing the source template after assignment does not change the existing assignment", async () => {
    const { coach, profile } = await makeCoachWithAthlete("kumar", "arjun");
    const template = await makeTemplate(coach._id, [{ title: "Bench Press", type: "sets_reps", sets: 4, reps: "10" }]);
    const app = buildApp();
    const coachToken = `Bearer ${tokenFor(coach._id, "coach")}`;

    const assignRes = await request(app)
      .post(`/api/coach/athletes/${profile._id}/workout-assignments`)
      .set("Authorization", coachToken)
      .send({ templateId: template._id.toString(), scheduledDate: TODAY });
    expect(assignRes.status).toBe(201);
    const assignmentId = assignRes.body.assignment.id;
    expect(assignRes.body.assignment.exercises[0].sets).toBe(4);
    expect(assignRes.body.assignment.exercises[0].reps).toBe("10");
    expect(assignRes.body.assignment.templateVersionSnapshot).toBe(1);

    // Athlete starts the workout (in progress) before the coach edits the template.
    const athleteToken = `Bearer ${tokenFor(profile.userId as Types.ObjectId, "athlete")}`;
    const startRes = await request(app)
      .post(`/api/athlete/workout-assignments/${assignmentId}/start`)
      .set("Authorization", athleteToken);
    expect(startRes.status).toBe(200);
    expect(startRes.body.assignment.status).toBe("in_progress");

    // Coach edits the template: 4x10 -> 5x8.
    const doc = await WorkoutTemplate.findById(template._id);
    doc!.exercises = [{ title: "Bench Press", type: "sets_reps", sets: 5, reps: "8", order: 0 }] as never;
    doc!.version = 2;
    await doc!.save();

    // The existing assignment must remain 4x10 — unaffected by the template edit.
    const check = await request(app)
      .get(`/api/athlete/workout-assignments/${assignmentId}`)
      .set("Authorization", athleteToken);
    expect(check.status).toBe(200);
    expect(check.body.assignment.exercises[0].sets).toBe(4);
    expect(check.body.assignment.exercises[0].reps).toBe("10");
    expect(check.body.assignment.templateVersionSnapshot).toBe(1);

    // A NEW assignment created from the (now-edited) template picks up 5x8.
    const secondAssign = await request(app)
      .post(`/api/coach/athletes/${profile._id}/workout-assignments`)
      .set("Authorization", coachToken)
      .send({ templateId: template._id.toString(), scheduledDate: "2026-08-15" });
    expect(secondAssign.status).toBe(201);
    expect(secondAssign.body.assignment.exercises[0].sets).toBe(5);
    expect(secondAssign.body.assignment.exercises[0].reps).toBe("8");
    expect(secondAssign.body.assignment.templateVersionSnapshot).toBe(2);
  });

  test("a coach cannot assign a template they don't own", async () => {
    const { coach, profile } = await makeCoachWithAthlete("a", "ath-a");
    const otherCoach = await makeUser("coach", "b");
    const template = await makeTemplate(otherCoach._id, [{ title: "X", type: "checklist" }]);

    const res = await request(buildApp())
      .post(`/api/coach/athletes/${profile._id}/workout-assignments`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .send({ templateId: template._id.toString(), scheduledDate: TODAY });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("template_not_found");
  });

  test("a coach cannot assign to an athlete not currently assigned to them", async () => {
    const coach = await makeUser("coach", "unassigned-coach");
    const { profile } = await makeCoachWithAthlete("other", "someone-elses");
    const template = await makeTemplate(coach._id, [{ title: "X", type: "checklist" }]);

    const res = await request(buildApp())
      .post(`/api/coach/athletes/${profile._id}/workout-assignments`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .send({ templateId: template._id.toString(), scheduledDate: TODAY });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("not_in_assignments");
  });

  test("an athlete cannot view or act on another athlete's assignment", async () => {
    const { coach, profile } = await makeCoachWithAthlete("shared-coach", "owner-athlete");
    const { athleteUser: stranger } = await makeCoachWithAthlete("other-coach2", "stranger-athlete");
    const template = await makeTemplate(coach._id, [{ title: "X", type: "checklist" }]);
    const app = buildApp();

    const assigned = await request(app)
      .post(`/api/coach/athletes/${profile._id}/workout-assignments`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .send({ templateId: template._id.toString(), scheduledDate: TODAY });
    const assignmentId = assigned.body.assignment.id;

    const res = await request(app)
      .get(`/api/athlete/workout-assignments/${assignmentId}`)
      .set("Authorization", `Bearer ${tokenFor(stranger._id, "athlete")}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("assignment_not_found");
  });
});

describe("Multi-athlete (bulk) assignment", () => {
  test("assigning one template to multiple Clients creates independent assignments; each has its own progress", async () => {
    const coach = await makeUser("coach", "bulkcoach");
    const a1 = await makeUser("athlete", "bulk-a1");
    const a2 = await makeUser("athlete", "bulk-a2");
    const p1 = await AthleteProfile.create({ userId: a1._id, sport: "football" });
    const p2 = await AthleteProfile.create({ userId: a2._id, sport: "football" });
    await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: p1._id, assignedBy: coach._id });
    await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: p2._id, assignedBy: coach._id });
    const template = await makeTemplate(coach._id, [
      { title: "Squats", type: "checklist" },
      { title: "Lunges", type: "checklist" },
    ]);
    const app = buildApp();

    const bulk = await request(app)
      .post("/api/coach/workout-assignments/bulk")
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .send({ templateId: template._id.toString(), athleteIds: [p1._id.toString(), p2._id.toString()], scheduledDate: TODAY });
    expect(bulk.status).toBe(207);
    expect(bulk.body.results.every((r: { ok: boolean }) => r.ok)).toBe(true);
    expect(await WorkoutAssignment.countDocuments({ templateId: template._id })).toBe(2);

    const [id1, id2] = bulk.body.results.map((r: { assignmentId: string }) => r.assignmentId);

    // Athlete 1 completes both exercises; athlete 2 hasn't touched theirs.
    const token1 = `Bearer ${tokenFor(a1._id, "athlete")}`;
    await request(app).post(`/api/athlete/workout-assignments/${id1}/exercises/0/progress`).set("Authorization", token1).send({ status: "completed" });
    await request(app).post(`/api/athlete/workout-assignments/${id1}/exercises/1/progress`).set("Authorization", token1).send({ status: "completed" });

    const a1State = await WorkoutAssignment.findById(id1);
    const a2State = await WorkoutAssignment.findById(id2);
    expect(a1State!.status).toBe("completed");
    expect(a2State!.status).toBe("scheduled");
  });

  test("bulk assignment reports a per-item failure for an athlete not assigned to the coach, without failing the whole batch", async () => {
    const { coach, profile } = await makeCoachWithAthlete("partial-coach", "partial-athlete");
    const strangerProfile = new Types.ObjectId();
    const template = await makeTemplate(coach._id, [{ title: "X", type: "checklist" }]);

    const res = await request(buildApp())
      .post("/api/coach/workout-assignments/bulk")
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .send({ templateId: template._id.toString(), athleteIds: [profile._id.toString(), strangerProfile.toString()], scheduledDate: TODAY });

    expect(res.status).toBe(207);
    const ok = res.body.results.find((r: { athleteId: string }) => r.athleteId === profile._id.toString());
    const failed = res.body.results.find((r: { athleteId: string }) => r.athleteId === strangerProfile.toString());
    expect(ok.ok).toBe(true);
    expect(failed.ok).toBe(false);
    expect(failed.error).toBe("not_in_assignments");
  });
});

describe("One slot-linked assignment per athlete/date/slot (DB-level)", () => {
  test("assigning two templates to the same athlete/date/slot is rejected at the DB layer, not just app logic", async () => {
    const { coach, profile } = await makeCoachWithAthlete("slotcoach", "slotathlete");
    const t1 = await makeTemplate(coach._id, [{ title: "A", type: "checklist" }]);
    const t2 = await makeTemplate(coach._id, [{ title: "B", type: "checklist" }]);
    const app = buildApp();
    const token = `Bearer ${tokenFor(coach._id, "coach")}`;

    const first = await request(app)
      .post(`/api/coach/athletes/${profile._id}/workout-assignments`)
      .set("Authorization", token)
      .send({ templateId: t1._id.toString(), scheduledDate: TODAY, slot: "AM" });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`/api/coach/athletes/${profile._id}/workout-assignments`)
      .set("Authorization", token)
      .send({ templateId: t2._id.toString(), scheduledDate: TODAY, slot: "AM" });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("slot_already_assigned");

    // But two DIFFERENT unslotted assignments the same day are fine.
    const third = await request(app)
      .post(`/api/coach/athletes/${profile._id}/workout-assignments`)
      .set("Authorization", token)
      .send({ templateId: t2._id.toString(), scheduledDate: TODAY });
    expect(third.status).toBe(201);
  });

  test("real concurrency: two simultaneous assignment requests for the same slot — exactly one wins", async () => {
    const { coach, profile } = await makeCoachWithAthlete("race-coach", "race-athlete");
    const t1 = await makeTemplate(coach._id, [{ title: "A", type: "checklist" }]);
    const t2 = await makeTemplate(coach._id, [{ title: "B", type: "checklist" }]);
    const app = buildApp();
    const token = `Bearer ${tokenFor(coach._id, "coach")}`;

    const [r1, r2] = await Promise.all([
      request(app).post(`/api/coach/athletes/${profile._id}/workout-assignments`).set("Authorization", token).send({ templateId: t1._id.toString(), scheduledDate: TODAY, slot: "AFT" }),
      request(app).post(`/api/coach/athletes/${profile._id}/workout-assignments`).set("Authorization", token).send({ templateId: t2._id.toString(), scheduledDate: TODAY, slot: "AFT" }),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 409]);
    expect(await WorkoutAssignment.countDocuments({ assignedTo: profile._id, slot: "AFT" })).toBe(1);
  });
});

describe("Slot-linked assignment integrates with the existing TrainingSession system", () => {
  test("starting a slot-linked assignment creates/links a TrainingSession row; completing it marks that session completed and Attendance present", async () => {
    const { coach, profile } = await makeCoachWithAthlete("integ-coach", "integ-athlete");
    const template = await makeTemplate(coach._id, [{ title: "Only exercise", type: "checklist" }]);
    const app = buildApp();

    const assign = await request(app)
      .post(`/api/coach/athletes/${profile._id}/workout-assignments`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .send({ templateId: template._id.toString(), scheduledDate: TODAY, slot: "PM" });
    const assignmentId = assign.body.assignment.id;
    const athleteToken = `Bearer ${tokenFor(profile.userId as Types.ObjectId, "athlete")}`;

    const complete = await request(app)
      .post(`/api/athlete/workout-assignments/${assignmentId}/exercises/0/progress`)
      .set("Authorization", athleteToken)
      .send({ status: "completed" });
    expect(complete.status).toBe(200);
    expect(complete.body.assignment.status).toBe("completed");
    expect(complete.body.assignment.trainingSessionId).toBeTruthy();

    const session = await TrainingSession.findOne({ athleteId: profile._id, date: new Date(`${TODAY}T00:00:00.000Z`), slot: "PM" });
    expect(session).toBeTruthy();
    expect(session!.status).toBe("completed");
    expect((session!.workoutAssignmentId as Types.ObjectId).toString()).toBe(assignmentId);

    const attendance = await Attendance.findOne({ athleteId: profile._id, date: new Date(`${TODAY}T00:00:00.000Z`) });
    expect(attendance!.status).toBe("present");
  });
});
