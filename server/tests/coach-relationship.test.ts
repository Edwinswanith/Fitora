import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { CoachAthleteAssignment } from "../src/models/CoachAthleteAssignment";
import authRouter, { __resetLoginRateLimit } from "../src/routes/auth";
import coachRouter from "../src/routes/coach";
import { athleteJoinRequestsRouter } from "../src/routes/coachJoinRequests";
import { signAccessToken } from "../src/lib/tokens";

let mongo: MongoMemoryServer;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.use("/api/coach", coachRouter);
  app.use("/api/athlete", athleteJoinRequestsRouter);
  return app;
}

async function makeCoach(name: string) {
  return User.create({ email: `${name}@test.io`, passwordHash: "x", role: "coach", name });
}

function coachToken(userId: Types.ObjectId) {
  return signAccessToken({ sub: userId.toString(), role: "coach" });
}

async function selfRegister(app: express.Express, email: string) {
  return request(app)
    .post("/api/auth/register-athlete")
    .send({ name: "Self Athlete", email, password: "longenough1", sport: "Tennis" });
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  // mongoose.connect() resolving does NOT mean every model's indexes (esp.
  // the unique partial index this suite is testing) have finished building —
  // Mongoose builds them in the background. Mirrors the fix in
  // src/db/mongoose.ts so this suite deterministically tests against a fully
  // indexed collection instead of racing the background build.
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  __resetLoginRateLimit();
  await Promise.all(
    Object.values(mongoose.connection.collections).map((c) => c.deleteMany({}))
  );
});

describe("CoachAthleteAssignment schema — one-primary-coach fields", () => {
  test("new assignment defaults status to active and subscriptionId/endedReason to null", async () => {
    const coach = await makeCoach("kumar");
    const athleteUser = await User.create({ email: "solo@test.io", passwordHash: "x", role: "athlete", name: "Solo" });
    const profile = await AthleteProfile.create({ userId: athleteUser._id, sport: "football" });

    const assignment = await CoachAthleteAssignment.create({
      coachId: coach._id,
      athleteId: profile._id,
      assignedBy: coach._id,
    });

    expect(assignment.status).toBe("active");
    expect(assignment.subscriptionId).toBeNull();
    expect(assignment.endedReason).toBeNull();
  });

  test("DB-level unique partial index rejects a second active row for the same athlete even bypassing app checks", async () => {
    const coachA = await makeCoach("direct-a");
    const coachB = await makeCoach("direct-b");
    const athleteUser = await User.create({ email: "direct-athlete@test.io", passwordHash: "x", role: "athlete", name: "Direct" });
    const profile = await AthleteProfile.create({ userId: athleteUser._id, sport: "football" });

    await CoachAthleteAssignment.create({ coachId: coachA._id, athleteId: profile._id, assignedBy: coachA._id });

    // Bypasses every app-level pre-check the route normally runs — proves the
    // DB index itself is the actual enforcement, not just route logic.
    await expect(
      CoachAthleteAssignment.create({ coachId: coachB._id, athleteId: profile._id, assignedBy: coachB._id })
    ).rejects.toThrow(/E11000|duplicate key/i);

    expect(await CoachAthleteAssignment.countDocuments({ athleteId: profile._id, status: "active" })).toBe(1);
  });

  test("an ended relationship (status: ended) does not block a new active one for the same athlete", async () => {
    const formerCoach = await makeCoach("former");
    const newCoach = await makeCoach("new");
    const athleteUser = await User.create({ email: "switcher@test.io", passwordHash: "x", role: "athlete", name: "Switcher" });
    const profile = await AthleteProfile.create({ userId: athleteUser._id, sport: "football" });

    await CoachAthleteAssignment.create({
      coachId: formerCoach._id,
      athleteId: profile._id,
      assignedBy: formerCoach._id,
      endedAt: new Date(),
      status: "ended",
      endedReason: "user_switched",
    });

    const fresh = await CoachAthleteAssignment.create({
      coachId: newCoach._id,
      athleteId: profile._id,
      assignedBy: newCoach._id,
    });

    expect(fresh.status).toBe("active");
    expect(await CoachAthleteAssignment.countDocuments({ athleteId: profile._id })).toBe(2);
    expect(await CoachAthleteAssignment.countDocuments({ athleteId: profile._id, status: "active" })).toBe(1);
  });
});

describe("coach invites: real concurrency race on accept (not just sequential)", () => {
  test("an athlete accepting three coaches' invites at the same instant ends up with exactly one coach", async () => {
    const coachA = await makeCoach("race-a");
    const coachB = await makeCoach("race-b");
    const coachC = await makeCoach("race-c");
    const app = buildApp();
    const reg = await selfRegister(app, "raced@solo.io");
    const athleteToken = reg.body.accessToken as string;

    for (const coach of [coachA, coachB, coachC]) {
      const res = await request(app)
        .post("/api/coach/athletes/link")
        .set("Authorization", `Bearer ${coachToken(coach._id)}`)
        .send({ email: "raced@solo.io" });
      expect(res.status).toBe(202);
    }
    // Inviting alone grants nothing.
    expect(await CoachAthleteAssignment.countDocuments({})).toBe(0);

    const invites = await request(app).get("/api/athlete/coach-invites").set("Authorization", `Bearer ${athleteToken}`);
    expect(invites.body.invites).toHaveLength(3);

    // Fired concurrently via Promise.all, so every accept's claim can land
    // before any assignment exists. The one-active-coach index decides.
    const results = await Promise.all(
      invites.body.invites.map((inv: { id: string }) =>
        request(app).post(`/api/athlete/coach-invites/${inv.id}/accept`).set("Authorization", `Bearer ${athleteToken}`)
      )
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    for (const res of results) {
      if (res.status !== 200) {
        expect([404, 409]).toContain(res.status);
        expect(["already_has_coach", "invite_not_found"]).toContain(res.body.error);
      }
    }

    const profile = await AthleteProfile.findOne({}).lean();
    const activeCount = await CoachAthleteAssignment.countDocuments({ athleteId: profile!._id, status: "active" });
    expect(activeCount).toBe(1);
  });
});
