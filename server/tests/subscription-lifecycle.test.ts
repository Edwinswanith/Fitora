import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { CoachPricingPlan } from "../src/models/CoachPricingPlan";
import { CoachAthleteAssignment } from "../src/models/CoachAthleteAssignment";
import { AthleteCoachSubscription } from "../src/models/AthleteCoachSubscription";
import { WorkoutTemplate } from "../src/models/WorkoutTemplate";
import subscriptionsRouter from "../src/routes/subscriptions";
import coachWorkoutRouter from "../src/routes/coachWorkout";
import { signAccessToken } from "../src/lib/tokens";
import { setPaymentProviderForTests, MockPaymentProvider } from "../src/services/paymentProvider";
import { applyPaymentEvent } from "../src/services/subscription";

let mongo: MongoMemoryServer;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/athlete", subscriptionsRouter);
  app.use("/api/coach", coachWorkoutRouter);
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
async function makePlan(coachId: Types.ObjectId, overrides: Record<string, unknown> = {}) {
  return CoachPricingPlan.create({
    coachId,
    name: "Pro",
    monthlyPrice: 49,
    currency: "USD",
    workoutPlanningIncluded: true,
    nutritionIncluded: true,
    ...overrides,
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
  setPaymentProviderForTests(new MockPaymentProvider());
});

describe("POST /athlete/coach-subscriptions (checkout initiation)", () => {
  test("creates a pending subscription and does NOT create a coach relationship yet", async () => {
    const coach = await makeCoach("checkout-coach");
    const plan = await makePlan(coach._id);
    const { user, profile } = await makeAthlete("checkout-athlete");

    const res = await request(buildApp())
      .post("/api/athlete/coach-subscriptions")
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ coachId: coach._id.toString(), pricingPlanId: plan._id.toString() });

    expect(res.status).toBe(201);
    expect(res.body.subscription.status).toBe("pending");
    expect(res.body.subscription.relationshipId).toBeNull();
    expect(typeof res.body.checkoutRef).toBe("string");

    const relationshipCount = await CoachAthleteAssignment.countDocuments({ athleteId: profile._id });
    expect(relationshipCount).toBe(0);
  });

  test("rejects checkout when the athlete already has an active coach", async () => {
    const coach = await makeCoach("busy-coach");
    const otherCoach = await makeCoach("other-coach");
    const plan = await makePlan(otherCoach._id);
    const { user, profile } = await makeAthlete("busy-athlete");
    await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id, status: "active" });

    const res = await request(buildApp())
      .post("/api/athlete/coach-subscriptions")
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ coachId: otherCoach._id.toString(), pricingPlanId: plan._id.toString() });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("athlete_has_active_coach");
  });

  test("simultaneous subscribe to two different coaches: exactly one request succeeds (DB index, not just app logic)", async () => {
    const coachA = await makeCoach("race-coach-a");
    const coachB = await makeCoach("race-coach-b");
    const [planA, planB] = await Promise.all([makePlan(coachA._id), makePlan(coachB._id)]);
    const { user } = await makeAthlete("race-athlete");
    const app = buildApp();
    const token = `Bearer ${tokenFor(user._id, "athlete")}`;

    const [resA, resB] = await Promise.all([
      request(app).post("/api/athlete/coach-subscriptions").set("Authorization", token).send({
        coachId: coachA._id.toString(),
        pricingPlanId: planA._id.toString(),
      }),
      request(app).post("/api/athlete/coach-subscriptions").set("Authorization", token).send({
        coachId: coachB._id.toString(),
        pricingPlanId: planB._id.toString(),
      }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);
    const nonTerminal = await AthleteCoachSubscription.countDocuments({ status: { $in: ["pending", "active", "payment_due"] } });
    expect(nonTerminal).toBe(1);
  });

  test("bumps the coach pricing plan's cached razorpayPlanId once created (mock provider)", async () => {
    const coach = await makeCoach("plan-cache-coach");
    const plan = await makePlan(coach._id);
    const { user } = await makeAthlete("plan-cache-athlete");
    expect(plan.razorpayPlanId).toBeNull();

    await request(buildApp())
      .post("/api/athlete/coach-subscriptions")
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ coachId: coach._id.toString(), pricingPlanId: plan._id.toString() });

    const updated = await CoachPricingPlan.findById(plan._id).lean();
    expect(updated?.razorpayPlanId).toBe(`mock_plan_${plan._id.toString()}`);
  });
});

describe("subscription activation via webhook (applyPaymentEvent)", () => {
  test("subscription.activated creates the coach relationship, linked back to the subscription", async () => {
    const coach = await makeCoach("activate-coach");
    const plan = await makePlan(coach._id);
    const { user, profile } = await makeAthlete("activate-athlete");

    const initRes = await request(buildApp())
      .post("/api/athlete/coach-subscriptions")
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ coachId: coach._id.toString(), pricingPlanId: plan._id.toString() });
    const subscriptionId = initRes.body.subscription.id;
    const sub = await AthleteCoachSubscription.findById(subscriptionId);
    expect(sub).not.toBeNull();

    await applyPaymentEvent({
      eventType: "subscription.activated",
      providerSubscriptionId: sub!.providerSubscriptionId ?? null,
      providerPaymentId: null,
      amount: null,
      currency: null,
      periodStart: new Date(),
      periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      raw: {},
    });

    const activated = await AthleteCoachSubscription.findById(subscriptionId);
    expect(activated!.status).toBe("active");
    expect(activated!.relationshipId).not.toBeNull();

    const relationship = await CoachAthleteAssignment.findById(activated!.relationshipId);
    expect(relationship).not.toBeNull();
    expect(relationship!.status).toBe("active");
    expect(relationship!.coachId.toString()).toBe(coach._id.toString());
    expect(relationship!.athleteId.toString()).toBe(profile._id.toString());
    expect(relationship!.subscriptionId!.toString()).toBe(subscriptionId);
  });

  test("subscription.cancelled ends the linked relationship", async () => {
    const coach = await makeCoach("cancel-webhook-coach");
    const plan = await makePlan(coach._id);
    const { user } = await makeAthlete("cancel-webhook-athlete");
    const initRes = await request(buildApp())
      .post("/api/athlete/coach-subscriptions")
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ coachId: coach._id.toString(), pricingPlanId: plan._id.toString() });
    const sub = await AthleteCoachSubscription.findById(initRes.body.subscription.id);

    await applyPaymentEvent({
      eventType: "subscription.activated",
      providerSubscriptionId: sub!.providerSubscriptionId ?? null,
      providerPaymentId: null,
      amount: null,
      currency: null,
      periodStart: new Date(),
      periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      raw: {},
    });
    await applyPaymentEvent({
      eventType: "subscription.cancelled",
      providerSubscriptionId: sub!.providerSubscriptionId ?? null,
      providerPaymentId: null,
      amount: null,
      currency: null,
      periodStart: null,
      periodEnd: null,
      raw: {},
    });

    const cancelled = await AthleteCoachSubscription.findById(sub!._id);
    expect(cancelled!.status).toBe("cancelled");
    const relationship = await CoachAthleteAssignment.findById(cancelled!.relationshipId);
    expect(relationship!.status).toBe("ended");
    expect(relationship!.endedReason).toBe("subscription_cancelled");
  });
});

describe("POST /athlete/coach-subscriptions/:id/cancel", () => {
  test("sets cancelAtPeriodEnd without immediately ending the relationship", async () => {
    const coach = await makeCoach("self-cancel-coach");
    const plan = await makePlan(coach._id);
    const { user } = await makeAthlete("self-cancel-athlete");
    const app = buildApp();
    const token = `Bearer ${tokenFor(user._id, "athlete")}`;

    const initRes = await request(app)
      .post("/api/athlete/coach-subscriptions")
      .set("Authorization", token)
      .send({ coachId: coach._id.toString(), pricingPlanId: plan._id.toString() });
    const sub = await AthleteCoachSubscription.findById(initRes.body.subscription.id);
    await applyPaymentEvent({
      eventType: "subscription.activated",
      providerSubscriptionId: sub!.providerSubscriptionId ?? null,
      providerPaymentId: null,
      amount: null,
      currency: null,
      periodStart: new Date(),
      periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      raw: {},
    });

    const cancelRes = await request(app)
      .post(`/api/athlete/coach-subscriptions/${sub!._id.toString()}/cancel`)
      .set("Authorization", token);
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.subscription.status).toBe("active");
    expect(cancelRes.body.subscription.cancelAtPeriodEnd).toBe(true);

    const relationship = await CoachAthleteAssignment.findOne({ subscriptionId: sub!._id });
    expect(relationship!.status).toBe("active");
  });

  test("cancelling a never-activated (pending) checkout cancels outright, no relationship ever created", async () => {
    const coach = await makeCoach("pending-cancel-coach");
    const plan = await makePlan(coach._id);
    const { user, profile } = await makeAthlete("pending-cancel-athlete");
    const app = buildApp();
    const token = `Bearer ${tokenFor(user._id, "athlete")}`;

    const initRes = await request(app)
      .post("/api/athlete/coach-subscriptions")
      .set("Authorization", token)
      .send({ coachId: coach._id.toString(), pricingPlanId: plan._id.toString() });

    const cancelRes = await request(app)
      .post(`/api/athlete/coach-subscriptions/${initRes.body.subscription.id}/cancel`)
      .set("Authorization", token);
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.subscription.status).toBe("cancelled");
    expect(await CoachAthleteAssignment.countDocuments({ athleteId: profile._id })).toBe(0);
  });
});

describe("feature entitlement gating (subscription-linked relationships only)", () => {
  test("relationship with NO subscription (legacy link/create flow) stays fully unpaywalled", async () => {
    const coach = await makeCoach("legacy-coach");
    const { user: athleteUser, profile } = await makeAthlete("legacy-athlete");
    await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id, status: "active" });
    const template = await WorkoutTemplate.create({ ownerId: coach._id, ownerRole: "coach", name: "Base", exercises: [{ title: "Squat", type: "reps", reps: "10", order: 0 }] });

    const app = express();
    app.use(express.json());
    app.use("/api/coach", coachWorkoutRouter);
    const res = await request(app)
      .post(`/api/coach/athletes/${profile._id.toString()}/workout-assignments`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .send({ templateId: template._id.toString(), scheduledDate: "2026-01-01" });

    expect(res.status).toBe(201);
  });

  test("subscription-linked relationship blocks assignment when the plan does not include workoutPlanningIncluded", async () => {
    const coach = await makeCoach("gated-coach");
    const plan = await makePlan(coach._id, { workoutPlanningIncluded: false });
    const { user, profile } = await makeAthlete("gated-athlete");
    const app = buildApp();

    const initRes = await request(app)
      .post("/api/athlete/coach-subscriptions")
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ coachId: coach._id.toString(), pricingPlanId: plan._id.toString() });
    const sub = await AthleteCoachSubscription.findById(initRes.body.subscription.id);
    await applyPaymentEvent({
      eventType: "subscription.activated",
      providerSubscriptionId: sub!.providerSubscriptionId ?? null,
      providerPaymentId: null,
      amount: null,
      currency: null,
      periodStart: new Date(),
      periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      raw: {},
    });

    const template = await WorkoutTemplate.create({ ownerId: coach._id, ownerRole: "coach", name: "Base", exercises: [{ title: "Squat", type: "reps", reps: "10", order: 0 }] });
    const res = await request(app)
      .post(`/api/coach/athletes/${profile._id.toString()}/workout-assignments`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .send({ templateId: template._id.toString(), scheduledDate: "2026-01-01" });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("feature_not_included_in_plan");
  });

  test("subscription-linked relationship blocks assignment while payment_failed (not entitled)", async () => {
    const coach = await makeCoach("payfail-coach");
    const plan = await makePlan(coach._id, { workoutPlanningIncluded: true });
    const { user, profile } = await makeAthlete("payfail-athlete");
    const app = buildApp();

    const initRes = await request(app)
      .post("/api/athlete/coach-subscriptions")
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ coachId: coach._id.toString(), pricingPlanId: plan._id.toString() });
    const sub = await AthleteCoachSubscription.findById(initRes.body.subscription.id);
    await applyPaymentEvent({
      eventType: "subscription.activated",
      providerSubscriptionId: sub!.providerSubscriptionId ?? null,
      providerPaymentId: null,
      amount: null,
      currency: null,
      periodStart: new Date(),
      periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      raw: {},
    });
    await AthleteCoachSubscription.updateOne({ _id: sub!._id }, { $set: { status: "payment_failed" } });

    const template = await WorkoutTemplate.create({ ownerId: coach._id, ownerRole: "coach", name: "Base", exercises: [{ title: "Squat", type: "reps", reps: "10", order: 0 }] });
    const res = await request(app)
      .post(`/api/coach/athletes/${profile._id.toString()}/workout-assignments`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`)
      .send({ templateId: template._id.toString(), scheduledDate: "2026-01-01" });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("subscription_not_active");
  });
});
