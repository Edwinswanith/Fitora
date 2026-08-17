import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { CoachAthleteAssignment } from "../src/models/CoachAthleteAssignment";
import { CoachSession } from "../src/models/CoachSession";
import coachSessionsRouter from "../src/routes/coachSessions";
import athleteSessionsRouter from "../src/routes/athleteSessions";
import { signAccessToken } from "../src/lib/tokens";
import { setVideoProviderForTests, MockVideoProvider } from "../src/services/videoProvider";

// Phase 11 hardening: confirm/reschedule/complete/join-token previously only
// checked that the requester equals session.coachId/session.athleteId — never
// that the underlying CoachAthleteAssignment relationship was still active.
// After a relationship ended, both parties could still confirm, reschedule,
// complete, and — most concerning — join a live video call together. cancel
// is deliberately exempt: it must always stay available to clean up a stale
// booking regardless of relationship state.
let mongo: MongoMemoryServer;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/coach", coachSessionsRouter);
  app.use("/api/athlete", athleteSessionsRouter);
  return app;
}
async function makeCoach(name: string) {
  return User.create({ email: `${name}@test.io`, passwordHash: "x", role: "coach", name });
}
async function makeAthlete(name: string) {
  const user = await User.create({ email: `${name}@test.io`, passwordHash: "x", role: "athlete", name });
  const profile = await AthleteProfile.create({ userId: user._id, sport: "general" });
  return { user, profile };
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
  setVideoProviderForTests(new MockVideoProvider());
});

async function setupEndedRelationshipWithSession(status: "requested" | "confirmed" = "confirmed") {
  const coach = await makeCoach("guard-coach");
  const { user, profile } = await makeAthlete("guard-athlete");
  const relationship = await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id, status: "ended", endedAt: new Date() });
  const session = await CoachSession.create({
    coachId: coach._id,
    athleteId: profile._id,
    relationshipId: relationship._id,
    type: "general",
    scheduledStart: new Date(Date.now() - 5 * 60_000),
    scheduledEnd: new Date(Date.now() + 25 * 60_000),
    bufferMin: 0,
    status,
    events: [],
  });
  return { coach, user, profile, relationship, session };
}

describe("session actions after the relationship has ended", () => {
  test("confirm is blocked", async () => {
    const { coach, session } = await setupEndedRelationshipWithSession("requested");
    const res = await request(buildApp()).post(`/api/coach/sessions/${session._id.toString()}/confirm`).set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("relationship_ended");
  });

  test("reschedule is blocked", async () => {
    const { coach, session } = await setupEndedRelationshipWithSession("confirmed");
    const res = await request(buildApp())
      .post(`/api/coach/sessions/${session._id.toString()}/reschedule`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .send({ scheduledStart: new Date(Date.now() + 60 * 60_000).toISOString() });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("relationship_ended");
  });

  test("complete is blocked", async () => {
    const { coach, session } = await setupEndedRelationshipWithSession("confirmed");
    const res = await request(buildApp()).post(`/api/coach/sessions/${session._id.toString()}/complete`).set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("relationship_ended");
  });

  test("join-token is blocked for both the coach and the athlete", async () => {
    const { coach, user, session } = await setupEndedRelationshipWithSession("confirmed");
    const app = buildApp();

    const coachRes = await request(app).post(`/api/coach/sessions/${session._id.toString()}/join-token`).set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);
    expect(coachRes.status).toBe(409);
    expect(coachRes.body.error).toBe("relationship_ended");

    const athleteRes = await request(app).post(`/api/athlete/sessions/${session._id.toString()}/join-token`).set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`);
    expect(athleteRes.status).toBe(409);
    expect(athleteRes.body.error).toBe("relationship_ended");
  });

  test("cancel is NOT blocked — cleanup must always stay available", async () => {
    const { coach, session } = await setupEndedRelationshipWithSession("confirmed");
    const res = await request(buildApp()).post(`/api/coach/sessions/${session._id.toString()}/cancel`).set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);
    expect(res.status).toBe(200);
    expect(res.body.session.status).toBe("cancelled");
  });

  test("actions still work normally while the relationship IS active (no over-correction)", async () => {
    const coach = await makeCoach("active-guard-coach");
    const { profile } = await makeAthlete("active-guard-athlete");
    const relationship = await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id, status: "active" });
    const session = await CoachSession.create({
      coachId: coach._id,
      athleteId: profile._id,
      relationshipId: relationship._id,
      type: "general",
      scheduledStart: new Date(Date.now() - 5 * 60_000),
      scheduledEnd: new Date(Date.now() + 25 * 60_000),
      bufferMin: 0,
      status: "requested",
      events: [],
    });

    const res = await request(buildApp()).post(`/api/coach/sessions/${session._id.toString()}/confirm`).set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);
    expect(res.status).toBe(200);
    expect(res.body.session.status).toBe("confirmed");
  });
});
