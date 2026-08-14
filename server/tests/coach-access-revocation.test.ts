import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { CoachAthleteAssignment } from "../src/models/CoachAthleteAssignment";
import coachRouter from "../src/routes/coach";
import { signAccessToken } from "../src/lib/tokens";

/**
 * The coach-scope invariant's whole point is that ending an assignment takes
 * effect IMMEDIATELY — not on next login, not eventually. `loadScope` re-runs
 * its CoachAthleteAssignment query on every single request (see
 * middleware/coachAthleteAccess.ts), so this should already hold; this suite
 * proves it end-to-end through real coach.ts HTTP routes rather than only at
 * the unit level (assertCanAccessAthlete called directly), which is what
 * existing coverage was previously limited to.
 *
 * There is currently no product route that ends a CoachAthleteAssignment
 * (that's Phase 10 / Coach Switching) — so "ending" here is done directly
 * against the model, matching the exact shape a real switch/unassign flow
 * will produce (status:"ended" in sync with endedAt, per the model's own
 * documented invariant).
 */

let mongo: MongoMemoryServer;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/coach", coachRouter);
  return app;
}

function coachToken(id: Types.ObjectId) {
  return signAccessToken({ sub: id.toString(), role: "coach" });
}

async function seedActivePair() {
  const coach = await User.create({ email: "revoke-coach@test.io", passwordHash: "x", role: "coach", name: "Coach Revoke" });
  const athleteUser = await User.create({ email: "revoke-athlete@test.io", passwordHash: "x", role: "athlete", name: "Athlete Revoke" });
  const profile = await AthleteProfile.create({ userId: athleteUser._id, sport: "football" });
  const assignment = await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id });
  return { coach, athleteUser, profile, assignment };
}

async function endAssignment(assignmentId: Types.ObjectId) {
  await CoachAthleteAssignment.updateOne(
    { _id: assignmentId },
    { $set: { endedAt: new Date(), status: "ended", endedReason: "coach_ended" } }
  );
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

describe("Ending a CoachAthleteAssignment instantly revokes coach access (real HTTP routes)", () => {
  test("daily-card: 200 while active, 403 not_in_assignments immediately after ending", async () => {
    const { coach, profile, assignment } = await seedActivePair();
    const app = buildApp();
    const token = `Bearer ${coachToken(coach._id)}`;

    const before = await request(app).get(`/api/coach/athletes/${profile._id}/daily-card`).set("Authorization", token);
    expect(before.status).toBe(200);

    await endAssignment(assignment._id as Types.ObjectId);

    const after = await request(app).get(`/api/coach/athletes/${profile._id}/daily-card`).set("Authorization", token);
    expect(after.status).toBe(403);
    expect(after.body.error).toBe("not_in_assignments");
  });

  test("coach feedback comment: allowed while active, blocked immediately after ending", async () => {
    const { coach, profile, assignment } = await seedActivePair();
    const app = buildApp();
    const token = `Bearer ${coachToken(coach._id)}`;

    const before = await request(app)
      .post(`/api/coach/athletes/${profile._id}/comment`)
      .set("Authorization", token)
      .send({ body: "Great session today" });
    expect(before.status).toBe(201);

    await endAssignment(assignment._id as Types.ObjectId);

    const after = await request(app)
      .post(`/api/coach/athletes/${profile._id}/comment`)
      .set("Authorization", token)
      .send({ body: "Should not be allowed" });
    expect(after.status).toBe(403);
    expect(after.body.error).toBe("not_in_assignments");
  });

  test("injury logging: allowed while active, blocked immediately after ending", async () => {
    const { coach, profile, assignment } = await seedActivePair();
    const app = buildApp();
    const token = `Bearer ${coachToken(coach._id)}`;

    const before = await request(app)
      .post(`/api/coach/athletes/${profile._id}/injuries`)
      .set("Authorization", token)
      .send({ bodyPart: "ankle", severity: "mild" });
    expect(before.status).toBe(201);

    await endAssignment(assignment._id as Types.ObjectId);

    const after = await request(app)
      .post(`/api/coach/athletes/${profile._id}/injuries`)
      .set("Authorization", token)
      .send({ bodyPart: "knee", severity: "mild" });
    expect(after.status).toBe(403);
    expect(after.body.error).toBe("not_in_assignments");
  });

  test("messaging: coach can message while active, is rejected immediately after ending", async () => {
    const { coach, profile, assignment } = await seedActivePair();
    const app = buildApp();
    const token = `Bearer ${coachToken(coach._id)}`;

    const before = await request(app)
      .post(`/api/coach/athletes/${profile._id}/messages`)
      .set("Authorization", token)
      .send({ body: "Hi, how did you feel today?" });
    expect(before.status).toBe(201);

    await endAssignment(assignment._id as Types.ObjectId);

    const after = await request(app)
      .post(`/api/coach/athletes/${profile._id}/messages`)
      .set("Authorization", token)
      .send({ body: "Are you still there?" });
    expect(after.status).toBe(403);
    expect(after.body.error).toBe("not_in_assignments");
  });

  test("roster (GET /athletes) drops the athlete the instant the assignment ends", async () => {
    const { coach, profile, assignment } = await seedActivePair();
    const app = buildApp();
    const token = `Bearer ${coachToken(coach._id)}`;

    const before = await request(app).get("/api/coach/athletes").set("Authorization", token);
    expect(before.body.athletes.map((a: { athleteId: string }) => a.athleteId)).toContain(profile._id.toString());

    await endAssignment(assignment._id as Types.ObjectId);

    const after = await request(app).get("/api/coach/athletes").set("Authorization", token);
    expect(after.body.athletes.map((a: { athleteId: string }) => a.athleteId)).not.toContain(profile._id.toString());
  });
});
