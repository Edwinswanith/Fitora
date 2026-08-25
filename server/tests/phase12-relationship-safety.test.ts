import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { CoachAthleteAssignment } from "../src/models/CoachAthleteAssignment";
import { CoachSession } from "../src/models/CoachSession";
import { CoachSessionSlotLock } from "../src/models/CoachSessionSlotLock";
import { CoachPricingPlan } from "../src/models/CoachPricingPlan";
import { AthleteCoachSubscription } from "../src/models/AthleteCoachSubscription";
import { CoachSwitchIntent } from "../src/models/CoachSwitchIntent";
import { WorkoutTemplate } from "../src/models/WorkoutTemplate";
import { WorkoutAssignment } from "../src/models/WorkoutAssignment";
import { MealPlan } from "../src/models/MealPlan";
import { MealPlanAssignment } from "../src/models/MealPlanAssignment";
import coachRelationshipRouter from "../src/routes/coachRelationship";
import athleteCoachRelationshipRouter from "../src/routes/athleteCoachRelationship";
import paymentWebhookRouter from "../src/routes/paymentWebhook";
import { signAccessToken } from "../src/lib/tokens";
import { setPaymentProviderForTests, MockPaymentProvider } from "../src/services/paymentProvider";
import { setVideoProviderForTests, MockVideoProvider } from "../src/services/videoProvider";

// Phase 12 hardening: (a) ending a relationship previously left future
// CoachSession rows open and their CoachSessionSlotLock rows dangling
// forever, blocking the coach's real availability; (b) switchCoach previously
// ended the old relationship unconditionally BEFORE the new coach's payment
// was verified, so a failed/abandoned new-coach checkout could leave an
// athlete with no coach at all. Both are fixed here.
let mongo: MongoMemoryServer;

function buildApp() {
  const app = express();
  app.use("/api/internal/payments/webhook", paymentWebhookRouter);
  app.use(express.json());
  app.use("/api/coach", coachRelationshipRouter);
  app.use("/api/athlete", athleteCoachRelationshipRouter);
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
async function makePlan(coachId: Types.ObjectId) {
  return CoachPricingPlan.create({ coachId, name: "Pro", monthlyPrice: 20, currency: "USD" });
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
  setPaymentProviderForTests(new MockPaymentProvider());
  setVideoProviderForTests(new MockVideoProvider());
});

async function createOpenSessionWithLock(coachId: Types.ObjectId, athleteId: Types.ObjectId, relationshipId: Types.ObjectId) {
  const scheduledStart = new Date(Date.now() + 60 * 60_000);
  const scheduledEnd = new Date(scheduledStart.getTime() + 30 * 60_000);
  const session = await CoachSession.create({
    coachId,
    athleteId,
    relationshipId,
    type: "general",
    scheduledStart,
    scheduledEnd,
    bufferMin: 0,
    status: "confirmed",
    events: [],
  });
  const lock = await CoachSessionSlotLock.create({
    coachId,
    bucketStart: new Date(Math.floor(scheduledStart.getTime() / (5 * 60_000)) * 5 * 60_000),
    sessionId: session._id,
  });
  return { session, lock };
}

describe("ending a relationship cascades to open sessions and slot locks", () => {
  test("coach-initiated end-relationship cancels open sessions and releases their slot locks", async () => {
    const coach = await makeCoach("cascade-coach");
    const { profile } = await makeAthlete("cascade-athlete");
    const relationship = await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id, status: "active" });
    const { session, lock } = await createOpenSessionWithLock(coach._id, profile._id, relationship._id);

    const res = await request(buildApp())
      .post(`/api/coach/athletes/${profile._id.toString()}/end-relationship`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);
    expect(res.status).toBe(200);

    const updatedSession = await CoachSession.findById(session._id).lean();
    expect(updatedSession!.status).toBe("cancelled");
    expect(updatedSession!.events.some((e) => e.type === "cancelled")).toBe(true);

    const remainingLock = await CoachSessionSlotLock.findById(lock._id).lean();
    expect(remainingLock).toBeNull(); // released, not left dangling
  });

  test("a session that is already terminal (completed) is left untouched", async () => {
    const coach = await makeCoach("cascade-coach-2");
    const { profile } = await makeAthlete("cascade-athlete-2");
    const relationship = await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id, status: "active" });
    const completed = await CoachSession.create({
      coachId: coach._id,
      athleteId: profile._id,
      relationshipId: relationship._id,
      type: "general",
      scheduledStart: new Date(Date.now() - 60 * 60_000),
      scheduledEnd: new Date(Date.now() - 30 * 60_000),
      bufferMin: 0,
      status: "completed",
      events: [],
    });

    await request(buildApp())
      .post(`/api/coach/athletes/${profile._id.toString()}/end-relationship`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);

    const unchanged = await CoachSession.findById(completed._id).lean();
    expect(unchanged!.status).toBe("completed"); // never touched
  });

  test("cancels the ended coach's still-open workout and meal-plan assignments without deleting history", async () => {
    const coach = await makeCoach("content-coach");
    const { profile } = await makeAthlete("content-athlete");
    const relationship = await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id, status: "active" });

    const template = await WorkoutTemplate.create({
      ownerId: coach._id,
      ownerRole: "coach",
      name: "Strength A",
      exercises: [{ title: "Squat", type: "sets_reps", sets: 4, reps: "8", order: 0 }],
    });
    const futureAssignment = await WorkoutAssignment.create({
      templateId: template._id,
      templateVersionSnapshot: 1,
      nameSnapshot: template.name,
      exercisesSnapshot: template.exercises,
      assignedTo: profile._id,
      assignedBy: coach._id,
      assignedByRole: "coach",
      scheduledDate: new Date(Date.now() + 24 * 60 * 60_000),
      status: "scheduled",
    });
    const completedAssignment = await WorkoutAssignment.create({
      templateId: template._id,
      templateVersionSnapshot: 1,
      nameSnapshot: template.name,
      exercisesSnapshot: template.exercises,
      assignedTo: profile._id,
      assignedBy: coach._id,
      assignedByRole: "coach",
      scheduledDate: new Date(Date.now() - 24 * 60 * 60_000),
      status: "completed",
    });

    const mealPlan = await MealPlan.create({
      ownerId: coach._id,
      name: "Cutting plan",
      durationDays: 7,
      days: [{ dayIndex: 0, meals: [{ mealType: "breakfast", foods: [] }] }],
    });
    const mealAssignment = await MealPlanAssignment.create({
      mealPlanId: mealPlan._id,
      mealPlanVersionSnapshot: 1,
      nameSnapshot: mealPlan.name,
      daysSnapshot: mealPlan.days,
      durationDays: 7,
      assignedTo: profile._id,
      assignedBy: coach._id,
      startDate: new Date(),
      status: "active",
      plannedMealIds: [],
    });

    await request(buildApp())
      .post(`/api/coach/athletes/${profile._id.toString()}/end-relationship`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);

    const futureAfter = await WorkoutAssignment.findById(futureAssignment._id).lean();
    expect(futureAfter!.status).toBe("skipped");

    const completedAfter = await WorkoutAssignment.findById(completedAssignment._id).lean();
    expect(completedAfter!.status).toBe("completed"); // history untouched

    const mealAfter = await MealPlanAssignment.findById(mealAssignment._id).lean();
    expect(mealAfter!.status).toBe("cancelled");
    expect(mealAfter!.cancelledAt).not.toBeNull();

    void relationship;
  });
});

describe("coach switching is safe against a failed or abandoned new-coach payment", () => {
  test("a failed new-coach payment leaves the old coach fully intact — no coach-less window", async () => {
    const oldCoach = await makeCoach("safety-old-coach");
    const newCoach = await makeCoach("safety-new-coach");
    const { user, profile } = await makeAthlete("safety-athlete");
    const oldRelationship = await CoachAthleteAssignment.create({ coachId: oldCoach._id, athleteId: profile._id, assignedBy: oldCoach._id, status: "active" });
    const newPlan = await makePlan(newCoach._id);

    const switchRes = await request(buildApp())
      .post("/api/athlete/coach-switch")
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ newCoachId: newCoach._id.toString(), newPricingPlanId: newPlan._id.toString() });
    expect(switchRes.status).toBe(201);
    const switchIntentId = switchRes.body.switchIntentId as string;

    const intentBefore = await CoachSwitchIntent.findById(switchIntentId).lean();
    expect(intentBefore!.status).toBe("pending");

    const payload = Buffer.from(
      JSON.stringify({
        event: "payment.failed",
        payload: { subscription: { entity: { id: intentBefore!.providerSubscriptionId } } },
      })
    );
    const signature = MockPaymentProvider.signPayloadForTests(payload);
    const webhookRes = await request(buildApp())
      .post("/api/internal/payments/webhook/razorpay")
      .set("Content-Type", "application/json")
      .set("x-razorpay-signature", signature)
      .send(payload.toString("utf8"));
    expect(webhookRes.status).toBe(200);

    const oldAfter = await CoachAthleteAssignment.findById(oldRelationship._id).lean();
    expect(oldAfter!.status).toBe("active"); // never touched — the whole point of the fix

    const intentAfter = await CoachSwitchIntent.findById(switchIntentId).lean();
    expect(intentAfter!.status).toBe("failed");

    const anyNewRelationship = await CoachAthleteAssignment.exists({ coachId: newCoach._id, athleteId: profile._id });
    expect(anyNewRelationship).toBeNull(); // new coach never activated
  });

  test("a verified new-coach payment atomically ends the old relationship and activates the new one, cancelling old open sessions", async () => {
    const oldCoach = await makeCoach("complete-old-coach");
    const newCoach = await makeCoach("complete-new-coach");
    const { user, profile } = await makeAthlete("complete-athlete");
    const oldRelationship = await CoachAthleteAssignment.create({ coachId: oldCoach._id, athleteId: profile._id, assignedBy: oldCoach._id, status: "active" });
    const { session: oldSession, lock: oldLock } = await createOpenSessionWithLock(oldCoach._id, profile._id, oldRelationship._id);
    const newPlan = await makePlan(newCoach._id);

    const switchRes = await request(buildApp())
      .post("/api/athlete/coach-switch")
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ newCoachId: newCoach._id.toString(), newPricingPlanId: newPlan._id.toString() });
    const switchIntentId = switchRes.body.switchIntentId as string;
    const intentBefore = await CoachSwitchIntent.findById(switchIntentId).lean();

    const payload = Buffer.from(
      JSON.stringify({
        event: "subscription.activated",
        payload: {
          subscription: {
            entity: {
              id: intentBefore!.providerSubscriptionId,
              current_start: Math.floor(Date.now() / 1000),
              current_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
            },
          },
        },
      })
    );
    const signature = MockPaymentProvider.signPayloadForTests(payload);
    const webhookRes = await request(buildApp())
      .post("/api/internal/payments/webhook/razorpay")
      .set("Content-Type", "application/json")
      .set("x-razorpay-signature", signature)
      .send(payload.toString("utf8"));
    expect(webhookRes.status).toBe(200);

    const oldAfter = await CoachAthleteAssignment.findById(oldRelationship._id).lean();
    expect(oldAfter!.status).toBe("ended");
    expect(oldAfter!.endedReason).toBe("user_switched");

    const newRelationship = await CoachAthleteAssignment.findOne({ coachId: newCoach._id, athleteId: profile._id }).lean();
    expect(newRelationship!.status).toBe("active");

    const newSubscription = await AthleteCoachSubscription.findOne({ coachId: newCoach._id, athleteId: profile._id }).lean();
    expect(newSubscription!.status).toBe("active");
    expect(newSubscription!.relationshipId!.toString()).toBe(newRelationship!._id.toString());

    // Old coach's straggler session/lock must be cleaned up, exactly like a
    // direct end-relationship — a switch is not a loophole around it.
    const oldSessionAfter = await CoachSession.findById(oldSession._id).lean();
    expect(oldSessionAfter!.status).toBe("cancelled");
    const oldLockAfter = await CoachSessionSlotLock.findById(oldLock._id).lean();
    expect(oldLockAfter).toBeNull();

    const intentAfter = await CoachSwitchIntent.findById(switchIntentId).lean();
    expect(intentAfter!.status).toBe("completed");
  });
});
