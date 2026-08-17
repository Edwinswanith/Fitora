import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { CoachAthleteAssignment } from "../src/models/CoachAthleteAssignment";
import { CoachSession, type CoachSessionStatus } from "../src/models/CoachSession";
import coachSessionsRouter from "../src/routes/coachSessions";
import athleteSessionsRouter from "../src/routes/athleteSessions";
import { signAccessToken } from "../src/lib/tokens";
import { setVideoProviderForTests, MockVideoProvider } from "../src/services/videoProvider";

let mongo: MongoMemoryServer;
let mockProvider: MockVideoProvider;

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

async function makeSession(opts: {
  coachId: Types.ObjectId;
  athleteId: Types.ObjectId;
  relationshipId: Types.ObjectId;
  status: CoachSessionStatus;
  scheduledStart: Date;
  scheduledEnd?: Date;
}) {
  return CoachSession.create({
    coachId: opts.coachId,
    athleteId: opts.athleteId,
    relationshipId: opts.relationshipId,
    type: "general",
    scheduledStart: opts.scheduledStart,
    scheduledEnd: opts.scheduledEnd ?? new Date(opts.scheduledStart.getTime() + 30 * 60_000),
    bufferMin: 10,
    status: opts.status,
    events: [],
  });
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
  mockProvider = new MockVideoProvider();
  setVideoProviderForTests(mockProvider);
});

async function setupPair() {
  const coach = await makeCoach("video-coach");
  const { user, profile } = await makeAthlete("video-athlete");
  const relationship = await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id, status: "active" });
  return { coach, user, profile, relationship };
}

describe("POST .../sessions/:id/join-token", () => {
  test("both participants get a token for the same room within the join window", async () => {
    const { coach, user, profile, relationship } = await setupPair();
    const session = await makeSession({
      coachId: coach._id,
      athleteId: profile._id,
      relationshipId: relationship._id,
      status: "confirmed",
      scheduledStart: new Date(Date.now() + 5 * 60_000),
    });
    const app = buildApp();

    const coachRes = await request(app).post(`/api/coach/sessions/${session._id.toString()}/join-token`).set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);
    expect(coachRes.status).toBe(200);
    expect(coachRes.body.video.serverUrl).toBe(MockVideoProvider.MOCK_SERVER_URL);

    const athleteRes = await request(app).post(`/api/athlete/sessions/${session._id.toString()}/join-token`).set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`);
    expect(athleteRes.status).toBe(200);

    const coachClaims = jwt.decode(coachRes.body.video.token) as { sub: string; video: { room: string } };
    const athleteClaims = jwt.decode(athleteRes.body.video.token) as { sub: string; video: { room: string } };
    expect(coachClaims.sub).toBe(`coach:${coach._id.toString()}`);
    expect(athleteClaims.sub).toBe(`athlete:${user._id.toString()}`);
    expect(coachClaims.video.room).toBe(athleteClaims.video.room);

    const updated = await CoachSession.findById(session._id).lean();
    expect(updated!.videoRoomRef).toBeTruthy();
    expect(mockProvider.wasCreated(updated!.videoRoomRef!)).toBe(true);
  });

  test("a stranger coach cannot obtain a token for someone else's session", async () => {
    const { coach, profile, relationship } = await setupPair();
    const session = await makeSession({ coachId: coach._id, athleteId: profile._id, relationshipId: relationship._id, status: "confirmed", scheduledStart: new Date(Date.now() + 5 * 60_000) });
    const stranger = await makeCoach("stranger-video-coach");

    const res = await request(buildApp()).post(`/api/coach/sessions/${session._id.toString()}/join-token`).set("Authorization", `Bearer ${tokenFor(stranger._id, "coach")}`);
    expect(res.status).toBe(404);
  });

  test("a session still in 'requested' (never confirmed) cannot issue a token", async () => {
    const { coach, relationship, profile } = await setupPair();
    const session = await makeSession({ coachId: coach._id, athleteId: profile._id, relationshipId: relationship._id, status: "requested", scheduledStart: new Date(Date.now() + 5 * 60_000) });
    const res = await request(buildApp()).post(`/api/coach/sessions/${session._id.toString()}/join-token`).set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("session_not_joinable");
  });

  test("too early — outside the join window before scheduledStart", async () => {
    const { coach, relationship, profile } = await setupPair();
    const session = await makeSession({ coachId: coach._id, athleteId: profile._id, relationshipId: relationship._id, status: "confirmed", scheduledStart: new Date(Date.now() + 60 * 60_000) });
    const res = await request(buildApp()).post(`/api/coach/sessions/${session._id.toString()}/join-token`).set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("outside_join_window");
  });

  test("too late — past the grace period after scheduledEnd", async () => {
    const { coach, relationship, profile } = await setupPair();
    const session = await makeSession({
      coachId: coach._id,
      athleteId: profile._id,
      relationshipId: relationship._id,
      status: "confirmed",
      scheduledStart: new Date(Date.now() - 120 * 60_000),
      scheduledEnd: new Date(Date.now() - 90 * 60_000),
    });
    const res = await request(buildApp()).post(`/api/coach/sessions/${session._id.toString()}/join-token`).set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("outside_join_window");
  });

  test("a cancelled session can never issue a fresh token", async () => {
    const { coach, user, relationship, profile } = await setupPair();
    const session = await makeSession({ coachId: coach._id, athleteId: profile._id, relationshipId: relationship._id, status: "confirmed", scheduledStart: new Date(Date.now() + 5 * 60_000) });
    const app = buildApp();

    const cancel = await request(app).post(`/api/coach/sessions/${session._id.toString()}/cancel`).set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);
    expect(cancel.status).toBe(200);

    const res = await request(app).post(`/api/athlete/sessions/${session._id.toString()}/join-token`).set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("session_not_joinable");
  });

  test("a completed session can never issue a fresh token", async () => {
    const { coach, user, relationship, profile } = await setupPair();
    const session = await makeSession({ coachId: coach._id, athleteId: profile._id, relationshipId: relationship._id, status: "confirmed", scheduledStart: new Date(Date.now() - 5 * 60_000) });
    const app = buildApp();

    const complete = await request(app).post(`/api/coach/sessions/${session._id.toString()}/complete`).set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);
    expect(complete.status).toBe(200);

    const res = await request(app).post(`/api/athlete/sessions/${session._id.toString()}/join-token`).set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("session_not_joinable");
  });
});

describe("video room lifecycle", () => {
  test("cancelling a session with an active room terminates it via the provider", async () => {
    const { coach, relationship, profile } = await setupPair();
    const session = await makeSession({ coachId: coach._id, athleteId: profile._id, relationshipId: relationship._id, status: "confirmed", scheduledStart: new Date(Date.now() + 5 * 60_000) });
    const app = buildApp();
    const coachToken = `Bearer ${tokenFor(coach._id, "coach")}`;

    await request(app).post(`/api/coach/sessions/${session._id.toString()}/join-token`).set("Authorization", coachToken);
    const withRoom = await CoachSession.findById(session._id).lean();
    expect(withRoom!.videoRoomRef).toBeTruthy();

    await request(app).post(`/api/coach/sessions/${session._id.toString()}/cancel`).set("Authorization", coachToken);
    expect(mockProvider.wasTerminated(withRoom!.videoRoomRef!)).toBe(true);
  });

  test("completing a session with an active room terminates it via the provider", async () => {
    const { coach, relationship, profile } = await setupPair();
    const session = await makeSession({ coachId: coach._id, athleteId: profile._id, relationshipId: relationship._id, status: "confirmed", scheduledStart: new Date(Date.now() - 5 * 60_000) });
    const app = buildApp();
    const coachToken = `Bearer ${tokenFor(coach._id, "coach")}`;

    await request(app).post(`/api/coach/sessions/${session._id.toString()}/join-token`).set("Authorization", coachToken);
    const withRoom = await CoachSession.findById(session._id).lean();

    await request(app).post(`/api/coach/sessions/${session._id.toString()}/complete`).set("Authorization", coachToken);
    expect(mockProvider.wasTerminated(withRoom!.videoRoomRef!)).toBe(true);
  });

  test("cancelling a session that never got a room does not error", async () => {
    const { coach, relationship, profile } = await setupPair();
    const session = await makeSession({ coachId: coach._id, athleteId: profile._id, relationshipId: relationship._id, status: "confirmed", scheduledStart: new Date(Date.now() + 5 * 60_000) });
    const res = await request(buildApp()).post(`/api/coach/sessions/${session._id.toString()}/cancel`).set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);
    expect(res.status).toBe(200);
  });
});
