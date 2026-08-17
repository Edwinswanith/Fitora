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
import { CoachSession } from "../src/models/CoachSession";
import { CoachSessionSlotLock } from "../src/models/CoachSessionSlotLock";
import coachAvailabilityRouter from "../src/routes/coachAvailability";
import coachSessionsRouter from "../src/routes/coachSessions";
import athleteSessionsRouter from "../src/routes/athleteSessions";
import { signAccessToken } from "../src/lib/tokens";

let mongo: MongoMemoryServer;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/coach", coachAvailabilityRouter);
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

const MONDAY = "2026-01-05";
const SLOT_START = "2026-01-05T08:00:00.000Z";

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

async function setupCoachedAthlete(coachName: string, athleteName: string) {
  const coach = await makeCoach(coachName);
  const { user, profile } = await makeAthlete(athleteName);
  const relationship = await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id, status: "active" });
  await CoachAvailability.create({
    coachId: coach._id,
    dayOfWeek: 1,
    startMinute: 480,
    endMinute: 600,
    timezone: "UTC",
    sessionDurationMin: 30,
    bufferMin: 10,
  });
  return { coach, user, profile, relationship };
}

describe("POST /athlete/coaches/:coachId/sessions (booking request)", () => {
  test("books within availability and creates matching slot locks", async () => {
    const { coach, user } = await setupCoachedAthlete("book-coach", "book-athlete");
    const app = buildApp();
    const res = await request(app)
      .post(`/api/athlete/coaches/${coach._id.toString()}/sessions`)
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ type: "general", scheduledStart: SLOT_START });

    expect(res.status).toBe(201);
    expect(res.body.session.status).toBe("requested");
    expect(res.body.session.scheduledEnd).toBe("2026-01-05T08:30:00.000Z");
    const locks = await CoachSessionSlotLock.countDocuments({ sessionId: res.body.session.id });
    expect(locks).toBeGreaterThan(0);
  });

  test("rejects a start time outside any availability window", async () => {
    const { coach, user } = await setupCoachedAthlete("outside-coach", "outside-athlete");
    const res = await request(buildApp())
      .post(`/api/athlete/coaches/${coach._id.toString()}/sessions`)
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ type: "general", scheduledStart: "2026-01-05T23:00:00.000Z" });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("outside_availability");
  });

  test("rejects an overlapping second booking for the same coach (sequential, same-process)", async () => {
    const { coach, user } = await setupCoachedAthlete("overlap-coach", "overlap-athlete");
    const { user: user2, profile: profile2 } = await makeAthlete("overlap-athlete-2");
    await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile2._id, assignedBy: coach._id, status: "active" });
    const app = buildApp();

    const first = await request(app)
      .post(`/api/athlete/coaches/${coach._id.toString()}/sessions`)
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ type: "general", scheduledStart: SLOT_START });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`/api/athlete/coaches/${coach._id.toString()}/sessions`)
      .set("Authorization", `Bearer ${tokenFor(user2._id, "athlete")}`)
      .send({ type: "general", scheduledStart: SLOT_START });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("slot_conflict");
  });

  test("buffer time is honored — a session ending at 08:30 with a 10-min buffer blocks 08:35", async () => {
    const { coach, user } = await setupCoachedAthlete("buffer-coach", "buffer-athlete");
    const { user: user2, profile: profile2 } = await makeAthlete("buffer-athlete-2");
    await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile2._id, assignedBy: coach._id, status: "active" });
    const app = buildApp();

    const first = await request(app)
      .post(`/api/athlete/coaches/${coach._id.toString()}/sessions`)
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ type: "general", scheduledStart: SLOT_START });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`/api/athlete/coaches/${coach._id.toString()}/sessions`)
      .set("Authorization", `Bearer ${tokenFor(user2._id, "athlete")}`)
      .send({ type: "general", scheduledStart: "2026-01-05T08:35:00.000Z" });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("slot_conflict");
  });

  test("cancelling frees the slot for a subsequent booking", async () => {
    const { coach, user } = await setupCoachedAthlete("free-coach", "free-athlete");
    const { user: user2, profile: profile2 } = await makeAthlete("free-athlete-2");
    await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile2._id, assignedBy: coach._id, status: "active" });
    const app = buildApp();

    const first = await request(app)
      .post(`/api/athlete/coaches/${coach._id.toString()}/sessions`)
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ type: "general", scheduledStart: SLOT_START });
    expect(first.status).toBe(201);

    const cancel = await request(app)
      .post(`/api/athlete/sessions/${first.body.session.id}/cancel`)
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`);
    expect(cancel.status).toBe(200);
    expect(await CoachSessionSlotLock.countDocuments({ sessionId: first.body.session.id })).toBe(0);

    const second = await request(app)
      .post(`/api/athlete/coaches/${coach._id.toString()}/sessions`)
      .set("Authorization", `Bearer ${tokenFor(user2._id, "athlete")}`)
      .send({ type: "general", scheduledStart: SLOT_START });
    expect(second.status).toBe(201);
  });

  test("subscription-linked relationship without live sessions in the plan is blocked", async () => {
    const coach = await makeCoach("no-live-coach");
    const { user, profile } = await makeAthlete("no-live-athlete");
    const plan = await CoachPricingPlan.create({ coachId: coach._id, name: "Basic", monthlyPrice: 10, currency: "USD", liveSessionsPerCycle: 0 });
    const subscription = await AthleteCoachSubscription.create({
      coachId: coach._id,
      athleteId: profile._id,
      pricingPlanId: plan._id,
      pricingPlanSnapshot: { name: plan.name, monthlyPrice: plan.monthlyPrice, currency: plan.currency, includedServices: [], liveSessionsPerCycle: 0, nutritionIncluded: false, workoutPlanningIncluded: false, messagingIncluded: true, version: 1 },
      provider: "razorpay",
      status: "active",
    });
    await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id, status: "active", subscriptionId: subscription._id });
    await CoachAvailability.create({ coachId: coach._id, dayOfWeek: 1, startMinute: 480, endMinute: 600, timezone: "UTC", sessionDurationMin: 30, bufferMin: 0 });

    const res = await request(buildApp())
      .post(`/api/athlete/coaches/${coach._id.toString()}/sessions`)
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ type: "general", scheduledStart: SLOT_START });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("live_sessions_not_included_in_plan");
  });
});

describe("session state machine", () => {
  async function bookOne() {
    const { coach, user } = await setupCoachedAthlete("sm-coach", "sm-athlete");
    const res = await request(buildApp())
      .post(`/api/athlete/coaches/${coach._id.toString()}/sessions`)
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ type: "general", scheduledStart: SLOT_START });
    return { coach, user, sessionId: res.body.session.id as string };
  }

  test("requested -> confirmed -> completed happy path", async () => {
    const { coach, sessionId } = await bookOne();
    const app = buildApp();
    const coachToken = `Bearer ${tokenFor(coach._id, "coach")}`;

    const confirm = await request(app).post(`/api/coach/sessions/${sessionId}/confirm`).set("Authorization", coachToken);
    expect(confirm.status).toBe(200);
    expect(confirm.body.session.status).toBe("confirmed");

    const complete = await request(app)
      .post(`/api/coach/sessions/${sessionId}/complete`)
      .set("Authorization", coachToken)
      .send({ summary: "Great session", coachNotes: "private note" });
    expect(complete.status).toBe(200);
    expect(complete.body.session.status).toBe("completed");
    expect(complete.body.session.summary).toBe("Great session");
    expect(complete.body.session.coachNotes).toBe("private note");
  });

  test("coachNotes never appear in the athlete's view of a session", async () => {
    const { coach, user, sessionId } = await bookOne();
    const app = buildApp();
    await request(app).post(`/api/coach/sessions/${sessionId}/confirm`).set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);
    await request(app)
      .post(`/api/coach/sessions/${sessionId}/complete`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .send({ coachNotes: "should never leak to athlete" });

    const athleteView = await request(app).get("/api/athlete/sessions").set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`);
    expect(athleteView.status).toBe(200);
    expect(athleteView.body.sessions[0].coachNotes).toBeUndefined();
  });

  test("cannot complete a session that was never confirmed", async () => {
    const { coach, sessionId } = await bookOne();
    const res = await request(buildApp()).post(`/api/coach/sessions/${sessionId}/complete`).set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("invalid_transition");
  });

  test("cannot reschedule a session still in 'requested' (only confirmed sessions reschedule)", async () => {
    const { coach, sessionId } = await bookOne();
    const res = await request(buildApp())
      .post(`/api/coach/sessions/${sessionId}/reschedule`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .send({ scheduledStart: "2026-01-05T09:00:00.000Z" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("invalid_transition");
  });

  test("reschedule moves the session, re-enters as confirmed, and respects the overlap check on the NEW slot", async () => {
    const { coach, sessionId } = await bookOne();
    const app = buildApp();
    const coachToken = `Bearer ${tokenFor(coach._id, "coach")}`;
    await request(app).post(`/api/coach/sessions/${sessionId}/confirm`).set("Authorization", coachToken);

    const reschedule = await request(app)
      .post(`/api/coach/sessions/${sessionId}/reschedule`)
      .set("Authorization", coachToken)
      .send({ scheduledStart: "2026-01-05T09:00:00.000Z" });
    expect(reschedule.status).toBe(200);
    expect(reschedule.body.session.status).toBe("confirmed");
    expect(reschedule.body.session.scheduledStart).toBe("2026-01-05T09:00:00.000Z");
    expect(reschedule.body.session.events.some((e: { type: string }) => e.type === "rescheduled")).toBe(true);

    // Old slot (08:00) is now free again.
    const stillLockedAtOldSlot = await CoachSessionSlotLock.findOne({ bucketStart: new Date("2026-01-05T08:00:00.000Z"), coachId: coach._id });
    expect(stillLockedAtOldSlot).toBeNull();
  });

  test("a completed session cannot be cancelled or rescheduled again", async () => {
    const { coach, sessionId } = await bookOne();
    const app = buildApp();
    const coachToken = `Bearer ${tokenFor(coach._id, "coach")}`;
    await request(app).post(`/api/coach/sessions/${sessionId}/confirm`).set("Authorization", coachToken);
    await request(app).post(`/api/coach/sessions/${sessionId}/complete`).set("Authorization", coachToken);

    const cancelAfter = await request(app).post(`/api/coach/sessions/${sessionId}/cancel`).set("Authorization", coachToken);
    expect(cancelAfter.status).toBe(409);
    expect(cancelAfter.body.error).toBe("invalid_transition");
  });

  test("a coach cannot act on another coach's session", async () => {
    const { sessionId } = await bookOne();
    const stranger = await makeCoach("stranger-sm-coach");
    const res = await request(buildApp()).post(`/api/coach/sessions/${sessionId}/confirm`).set("Authorization", `Bearer ${tokenFor(stranger._id, "coach")}`);
    expect(res.status).toBe(404);
  });
});
