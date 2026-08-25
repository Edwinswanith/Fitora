import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { CoachAthleteAssignment } from "../src/models/CoachAthleteAssignment";
import { CoachAvailability } from "../src/models/CoachAvailability";
import { CoachPricingPlan } from "../src/models/CoachPricingPlan";
import { AthleteCoachSubscription } from "../src/models/AthleteCoachSubscription";
import coachSessionsRouter from "../src/routes/coachSessions";
import athleteSessionsRouter from "../src/routes/athleteSessions";
import { signAccessToken } from "../src/lib/tokens";

// Phase 12: CoachPricingPlan.liveSessionsPerCycle previously only gated
// booking as a binary "does this plan include live sessions at all" — it
// never actually counted usage within the current billing period against
// that number. Counting policy (confirmed with the product owner): confirmed
// / completed / missed sessions consume the allowance; a cancelled session
// (by either party) never does, regardless of who cancelled or when.
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
});

async function setupSubscribedAthlete(liveSessionsPerCycle: number) {
  const coach = await makeCoach(`quota-coach-${liveSessionsPerCycle}-${Date.now()}`);
  const { user, profile } = await makeAthlete(`quota-athlete-${liveSessionsPerCycle}-${Date.now()}`);
  const plan = await CoachPricingPlan.create({
    coachId: coach._id,
    name: "Pro",
    monthlyPrice: 40,
    currency: "USD",
    liveSessionsPerCycle,
  });
  const periodStart = new Date("2026-01-01T00:00:00.000Z");
  const periodEnd = new Date("2026-02-01T00:00:00.000Z");
  const subscription = await AthleteCoachSubscription.create({
    coachId: coach._id,
    athleteId: profile._id,
    pricingPlanId: plan._id,
    pricingPlanSnapshot: {
      name: plan.name,
      monthlyPrice: plan.monthlyPrice,
      currency: plan.currency,
      includedServices: [],
      liveSessionsPerCycle,
      nutritionIncluded: false,
      workoutPlanningIncluded: false,
      messagingIncluded: true,
      version: 1,
    },
    provider: "razorpay",
    status: "active",
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
  });
  const relationship = await CoachAthleteAssignment.create({
    coachId: coach._id,
    athleteId: profile._id,
    assignedBy: coach._id,
    status: "active",
    subscriptionId: subscription._id,
  });
  await CoachAvailability.create({
    coachId: coach._id,
    dayOfWeek: 1,
    startMinute: 0,
    endMinute: 24 * 60,
    timezone: "UTC",
    sessionDurationMin: 30,
    bufferMin: 0,
  });
  return { coach, user, profile, relationship, subscription, periodStart, periodEnd };
}

describe("liveSessionsPerCycle usage metering", () => {
  test("booking response exposes includedSessions/usedSessions/remainingSessions", async () => {
    const { coach, user } = await setupSubscribedAthlete(2);
    const res = await request(buildApp())
      .post(`/api/athlete/coaches/${coach._id.toString()}/sessions`)
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ type: "general", scheduledStart: "2026-01-05T08:00:00.000Z" });
    expect(res.status).toBe(201);
    // A freshly "requested" (not yet coach-confirmed) session doesn't consume
    // the allowance yet — see the counting-policy comment in subscription.ts.
    expect(res.body.quota).toEqual({ includedSessions: 2, usedSessions: 0, remainingSessions: 2 });
  });

  test("a CONFIRMED session consumes the allowance; a third booking is rejected once the cap is reached", async () => {
    const { coach, user } = await setupSubscribedAthlete(1);
    const app = buildApp();

    const booked = await request(app)
      .post(`/api/athlete/coaches/${coach._id.toString()}/sessions`)
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ type: "general", scheduledStart: "2026-01-05T08:00:00.000Z" });
    expect(booked.status).toBe(201);

    await request(app)
      .post(`/api/coach/sessions/${booked.body.session.id}/confirm`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);

    const second = await request(app)
      .post(`/api/athlete/coaches/${coach._id.toString()}/sessions`)
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ type: "general", scheduledStart: "2026-01-05T09:00:00.000Z" });
    expect(second.status).toBe(403);
    expect(second.body.error).toBe("session_allowance_exhausted");
  });

  test("a session the athlete cancels does NOT consume the allowance — the slot frees back up", async () => {
    const { coach, user } = await setupSubscribedAthlete(1);
    const app = buildApp();

    const booked = await request(app)
      .post(`/api/athlete/coaches/${coach._id.toString()}/sessions`)
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ type: "general", scheduledStart: "2026-01-05T08:00:00.000Z" });
    await request(app).post(`/api/coach/sessions/${booked.body.session.id}/confirm`).set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);
    await request(app).post(`/api/athlete/sessions/${booked.body.session.id}/cancel`).set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`);

    const rebooked = await request(app)
      .post(`/api/athlete/coaches/${coach._id.toString()}/sessions`)
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ type: "general", scheduledStart: "2026-01-05T10:00:00.000Z" });
    expect(rebooked.status).toBe(201);
    expect(rebooked.body.quota.remainingSessions).toBe(1);
  });

  test("a MISSED session DOES consume the allowance", async () => {
    const { coach, user, profile } = await setupSubscribedAthlete(1);
    const { CoachSession } = await import("../src/models/CoachSession");
    const relationship = await CoachAthleteAssignment.findOne({ coachId: coach._id, athleteId: profile._id }).lean();
    await CoachSession.create({
      coachId: coach._id,
      athleteId: profile._id,
      relationshipId: relationship!._id,
      type: "general",
      scheduledStart: new Date("2026-01-05T08:00:00.000Z"),
      scheduledEnd: new Date("2026-01-05T08:30:00.000Z"),
      bufferMin: 0,
      status: "missed",
      events: [],
    });

    const res = await request(buildApp())
      .post(`/api/athlete/coaches/${coach._id.toString()}/sessions`)
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ type: "general", scheduledStart: "2026-01-07T08:00:00.000Z" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("session_allowance_exhausted");
  });

  test("usage resets across billing periods — a confirmed session from a PRIOR period doesn't count against the current one", async () => {
    const { coach, user, profile } = await setupSubscribedAthlete(1);
    const { CoachSession } = await import("../src/models/CoachSession");
    const relationship = await CoachAthleteAssignment.findOne({ coachId: coach._id, athleteId: profile._id }).lean();
    // A confirmed session dated before currentPeriodStart (2026-01-01) —
    // simulates a prior cycle's usage that must not carry over.
    await CoachSession.create({
      coachId: coach._id,
      athleteId: profile._id,
      relationshipId: relationship!._id,
      type: "general",
      scheduledStart: new Date("2025-12-20T08:00:00.000Z"),
      scheduledEnd: new Date("2025-12-20T08:30:00.000Z"),
      bufferMin: 0,
      status: "confirmed",
      events: [],
    });

    const res = await request(buildApp())
      .post(`/api/athlete/coaches/${coach._id.toString()}/sessions`)
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ type: "general", scheduledStart: "2026-01-05T08:00:00.000Z" });
    expect(res.status).toBe(201);
    expect(res.body.quota.usedSessions).toBe(0);
  });
});
