import mongoose, { Types } from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { CoachAthleteAssignment } from "../src/models/CoachAthleteAssignment";
import { CoachAvailability } from "../src/models/CoachAvailability";
import { CoachSession } from "../src/models/CoachSession";
import { CoachSessionSlotLock } from "../src/models/CoachSessionSlotLock";
import athleteSessionsRouter from "../src/routes/athleteSessions";
import { signAccessToken } from "../src/lib/tokens";

// Booking double-booking prevention is the single highest-risk piece of new
// code in this phase (a naive "read overlapping sessions, then insert if
// none overlap, inside a transaction" does NOT actually serialize two
// concurrent transactions each inserting a brand-new, distinct document —
// MongoDB's snapshot isolation only raises a write conflict when both
// transactions touch the SAME document). This suite proves the real guard
// (CoachSessionSlotLock's unique index) against a genuine replica set with
// real parallel HTTP requests — not just a unit test of the guard function
// in isolation.
let mongo: MongoMemoryReplSet;

function buildApp() {
  const app = express();
  app.use(express.json());
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

const SLOT_START = "2026-01-05T08:00:00.000Z"; // Monday

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
}, 60_000);
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
});

describe("real concurrent booking requests against a replica set", () => {
  test("two athletes racing for the exact same slot: exactly one succeeds", async () => {
    const coach = await makeCoach("race-coach");
    const { user: userA, profile: profileA } = await makeAthlete("race-athlete-a");
    const { user: userB, profile: profileB } = await makeAthlete("race-athlete-b");
    await Promise.all([
      CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profileA._id, assignedBy: coach._id, status: "active" }),
      CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profileB._id, assignedBy: coach._id, status: "active" }),
    ]);
    await CoachAvailability.create({ coachId: coach._id, dayOfWeek: 1, startMinute: 480, endMinute: 600, timezone: "UTC", sessionDurationMin: 30, bufferMin: 10 });

    const app = buildApp();
    const [resA, resB] = await Promise.all([
      request(app).post(`/api/athlete/coaches/${coach._id.toString()}/sessions`).set("Authorization", `Bearer ${tokenFor(userA._id, "athlete")}`).send({ type: "general", scheduledStart: SLOT_START }),
      request(app).post(`/api/athlete/coaches/${coach._id.toString()}/sessions`).set("Authorization", `Bearer ${tokenFor(userB._id, "athlete")}`).send({ type: "general", scheduledStart: SLOT_START }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);

    const activeSessions = await CoachSession.countDocuments({ coachId: coach._id, status: "requested" });
    expect(activeSessions).toBe(1);

    // The failed attempt must leave no orphaned locks or session rows behind.
    const totalLocks = await CoachSessionSlotLock.countDocuments({ coachId: coach._id });
    const winnerSessionId = await CoachSession.findOne({ coachId: coach._id }).select("_id");
    const locksForWinner = await CoachSessionSlotLock.countDocuments({ sessionId: winnerSessionId!._id });
    expect(totalLocks).toBe(locksForWinner);
  });

  test("five athletes racing for the same slot: exactly one succeeds, four get a clean conflict", async () => {
    const coach = await makeCoach("race5-coach");
    const athletes = await Promise.all(Array.from({ length: 5 }, (_, i) => makeAthlete(`race5-athlete-${i}`)));
    await Promise.all(
      athletes.map(({ profile }) => CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id, status: "active" }))
    );
    await CoachAvailability.create({ coachId: coach._id, dayOfWeek: 1, startMinute: 480, endMinute: 600, timezone: "UTC", sessionDurationMin: 30, bufferMin: 10 });

    const app = buildApp();
    const results = await Promise.all(
      athletes.map(({ user }) =>
        request(app).post(`/api/athlete/coaches/${coach._id.toString()}/sessions`).set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`).send({ type: "general", scheduledStart: SLOT_START })
      )
    );

    const successCount = results.filter((r) => r.status === 201).length;
    const conflictCount = results.filter((r) => r.status === 409 && r.body.error === "slot_conflict").length;
    expect(successCount).toBe(1);
    expect(conflictCount).toBe(4);
    expect(await CoachSession.countDocuments({ coachId: coach._id, status: "requested" })).toBe(1);
  });

  test("two DIFFERENT non-overlapping slots for the same coach both succeed", async () => {
    const coach = await makeCoach("nonoverlap-coach");
    const { user: userA, profile: profileA } = await makeAthlete("nonoverlap-athlete-a");
    const { user: userB, profile: profileB } = await makeAthlete("nonoverlap-athlete-b");
    await Promise.all([
      CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profileA._id, assignedBy: coach._id, status: "active" }),
      CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profileB._id, assignedBy: coach._id, status: "active" }),
    ]);
    await CoachAvailability.create({ coachId: coach._id, dayOfWeek: 1, startMinute: 480, endMinute: 600, timezone: "UTC", sessionDurationMin: 30, bufferMin: 0 });

    const app = buildApp();
    const [resA, resB] = await Promise.all([
      request(app).post(`/api/athlete/coaches/${coach._id.toString()}/sessions`).set("Authorization", `Bearer ${tokenFor(userA._id, "athlete")}`).send({ type: "general", scheduledStart: "2026-01-05T08:00:00.000Z" }),
      request(app).post(`/api/athlete/coaches/${coach._id.toString()}/sessions`).set("Authorization", `Bearer ${tokenFor(userB._id, "athlete")}`).send({ type: "general", scheduledStart: "2026-01-05T09:00:00.000Z" }),
    ]);
    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
    expect(await CoachSession.countDocuments({ coachId: coach._id, status: "requested" })).toBe(2);
  });
});
