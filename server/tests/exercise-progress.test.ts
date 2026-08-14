import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { CoachAthleteAssignment } from "../src/models/CoachAthleteAssignment";
import { WorkoutTemplate } from "../src/models/WorkoutTemplate";
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

describe("Manual/checklist workout — Morning Mobility scenario", () => {
  test("0/4 -> 1/4 -> 2/4 -> 3/4 -> 4/4 -> Completed, with no separate progress system", async () => {
    const coach = await makeUser("coach", "checklist-coach");
    const athleteUser = await makeUser("athlete", "checklist-athlete");
    const profile = await AthleteProfile.create({ userId: athleteUser._id, sport: "general" });
    await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id });

    const template = await WorkoutTemplate.create({
      ownerId: coach._id,
      ownerRole: "coach",
      name: "Morning Mobility",
      exercises: [
        { title: "20 Push-ups", type: "checklist", order: 0 },
        { title: "30 Squats", type: "checklist", order: 1 },
        { title: "60 sec Plank", type: "duration", durationSec: 60, order: 2 },
        { title: "5 min Stretching", type: "duration", durationSec: 300, order: 3 },
      ],
    });

    const app = buildApp();
    const assign = await request(app)
      .post(`/api/coach/athletes/${profile._id}/workout-assignments`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .send({ templateId: template._id.toString(), scheduledDate: "2026-08-14" });
    expect(assign.status).toBe(201);
    const assignmentId = assign.body.assignment.id;
    const athleteToken = `Bearer ${tokenFor(athleteUser._id, "athlete")}`;

    // Not started yet — nothing tapped.
    const initial = await request(app).get(`/api/athlete/workout-assignments/${assignmentId}`).set("Authorization", athleteToken);
    expect(initial.body.assignment.status).toBe("scheduled");
    expect(initial.body.assignment.progress).toHaveLength(0);

    for (let i = 0; i < 4; i++) {
      const res = await request(app)
        .post(`/api/athlete/workout-assignments/${assignmentId}/exercises/${i}/progress`)
        .set("Authorization", athleteToken)
        .send({ status: "completed" });
      expect(res.status).toBe(200);

      const completedCount = res.body.assignment.progress.filter((p: { status: string }) => p.status === "completed").length;
      expect(completedCount).toBe(i + 1);

      if (i === 0) {
        // First tap implicitly starts the assignment — no separate /start call required.
        expect(res.body.assignment.status).toBe("in_progress");
      }
      if (i < 3) {
        expect(res.body.assignment.status).toBe("in_progress");
      } else {
        expect(res.body.assignment.status).toBe("completed");
      }
    }

    // Coach's view shows the same 4/4 completion via the exact same daily-card
    // + assignment-summary path an athlete's own "today" view uses — one
    // coherent source, not a second competing progress system.
    const coachSummary = await request(app)
      .get(`/api/coach/athletes/${profile._id}/workout-assignments?date=2026-08-14`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);
    expect(coachSummary.status).toBe(200);
    expect(coachSummary.body.assignments[0]).toMatchObject({
      status: "completed",
      exerciseCount: 4,
      completedCount: 4,
      progressPercent: 100,
    });
  });

  test("marking an exercise skipped counts toward completion (skipped is terminal, not blocking)", async () => {
    const coach = await makeUser("coach", "skip-coach");
    const athleteUser = await makeUser("athlete", "skip-athlete");
    const profile = await AthleteProfile.create({ userId: athleteUser._id, sport: "general" });
    await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id });
    const template = await WorkoutTemplate.create({
      ownerId: coach._id,
      ownerRole: "coach",
      name: "Two items",
      exercises: [
        { title: "A", type: "checklist", order: 0 },
        { title: "B", type: "checklist", order: 1 },
      ],
    });
    const app = buildApp();
    const assign = await request(app)
      .post(`/api/coach/athletes/${profile._id}/workout-assignments`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .send({ templateId: template._id.toString(), scheduledDate: "2026-08-14" });
    const assignmentId = assign.body.assignment.id;
    const athleteToken = `Bearer ${tokenFor(athleteUser._id, "athlete")}`;

    await request(app).post(`/api/athlete/workout-assignments/${assignmentId}/exercises/0/progress`).set("Authorization", athleteToken).send({ status: "completed" });
    const res = await request(app).post(`/api/athlete/workout-assignments/${assignmentId}/exercises/1/progress`).set("Authorization", athleteToken).send({ status: "skipped" });
    expect(res.body.assignment.status).toBe("completed");
  });

  test("cannot update progress on an already-finished assignment; invalid exercise index rejected", async () => {
    const coach = await makeUser("coach", "final-coach");
    const athleteUser = await makeUser("athlete", "final-athlete");
    const profile = await AthleteProfile.create({ userId: athleteUser._id, sport: "general" });
    await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id });
    const template = await WorkoutTemplate.create({
      ownerId: coach._id,
      ownerRole: "coach",
      name: "One item",
      exercises: [{ title: "A", type: "checklist", order: 0 }],
    });
    const app = buildApp();
    const assign = await request(app)
      .post(`/api/coach/athletes/${profile._id}/workout-assignments`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .send({ templateId: template._id.toString(), scheduledDate: "2026-08-14" });
    const assignmentId = assign.body.assignment.id;
    const athleteToken = `Bearer ${tokenFor(athleteUser._id, "athlete")}`;

    await request(app).post(`/api/athlete/workout-assignments/${assignmentId}/exercises/0/progress`).set("Authorization", athleteToken).send({ status: "completed" });

    const afterFinish = await request(app)
      .post(`/api/athlete/workout-assignments/${assignmentId}/exercises/0/progress`)
      .set("Authorization", athleteToken)
      .send({ status: "in_progress" });
    expect(afterFinish.status).toBe(409);
    expect(afterFinish.body.error).toBe("assignment_already_finished");

    const badIndex = await request(app)
      .post(`/api/coach/athletes/${profile._id}/workout-assignments`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .send({ templateId: template._id.toString(), scheduledDate: "2026-08-15" });
    const res = await request(app)
      .post(`/api/athlete/workout-assignments/${badIndex.body.assignment.id}/exercises/5/progress`)
      .set("Authorization", athleteToken)
      .send({ status: "completed" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_exercise_index");
  });
});
