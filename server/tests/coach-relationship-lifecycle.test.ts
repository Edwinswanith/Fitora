import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { CoachAthleteAssignment } from "../src/models/CoachAthleteAssignment";
import { CoachPricingPlan } from "../src/models/CoachPricingPlan";
import { AthleteCoachSubscription } from "../src/models/AthleteCoachSubscription";
import coachRelationshipRouter from "../src/routes/coachRelationship";
import athleteCoachRelationshipRouter from "../src/routes/athleteCoachRelationship";
import subscriptionsRouter from "../src/routes/subscriptions";
import { signAccessToken } from "../src/lib/tokens";
import { setPaymentProviderForTests, MockPaymentProvider } from "../src/services/paymentProvider";

let mongo: MongoMemoryServer;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/coach", coachRelationshipRouter);
  app.use("/api/athlete", athleteCoachRelationshipRouter);
  app.use("/api/athlete", subscriptionsRouter);
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
});

describe("POST /coach/athletes/:athleteId/end-relationship", () => {
  test("coach ends the relationship; a linked active subscription is cancelled immediately (not just at period end)", async () => {
    const coach = await makeCoach("end-coach");
    const { profile } = await makeAthlete("end-athlete");
    const plan = await makePlan(coach._id);
    const subscription = await AthleteCoachSubscription.create({
      coachId: coach._id,
      athleteId: profile._id,
      pricingPlanId: plan._id,
      pricingPlanSnapshot: { name: plan.name, monthlyPrice: plan.monthlyPrice, currency: plan.currency, includedServices: [], liveSessionsPerCycle: 0, nutritionIncluded: false, workoutPlanningIncluded: false, messagingIncluded: true, version: 1 },
      provider: "razorpay",
      status: "active",
      providerSubscriptionId: "sub_end_test",
    });
    const relationship = await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id, status: "active", subscriptionId: subscription._id });

    const res = await request(buildApp())
      .post(`/api/coach/athletes/${profile._id.toString()}/end-relationship`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);
    expect(res.status).toBe(200);
    expect(res.body.relationship.status).toBe("ended");
    expect(res.body.relationship.endedReason).toBe("coach_ended");

    const updatedRel = await CoachAthleteAssignment.findById(relationship._id).lean();
    expect(updatedRel!.status).toBe("ended");
    const updatedSub = await AthleteCoachSubscription.findById(subscription._id).lean();
    expect(updatedSub!.status).toBe("cancelled");
    expect(updatedSub!.cancelAtPeriodEnd).toBe(false); // immediate, not soft cancel
  });

  test("a coach not assigned to this athlete is rejected by the scope guard (403 not_in_assignments)", async () => {
    const coach = await makeCoach("wrong-coach");
    const stranger = await makeCoach("stranger-coach");
    const { profile } = await makeAthlete("unassigned-athlete");
    await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id, status: "active" });

    const res = await request(buildApp())
      .post(`/api/coach/athletes/${profile._id.toString()}/end-relationship`)
      .set("Authorization", `Bearer ${tokenFor(stranger._id, "coach")}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("not_in_assignments");
  });
});

describe("POST /athlete/coach/leave", () => {
  test("athlete ends their own relationship with no active subscription (legacy/free relationship)", async () => {
    const coach = await makeCoach("leave-coach");
    const { user, profile } = await makeAthlete("leave-athlete");
    await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id, status: "active" });

    const res = await request(buildApp()).post("/api/athlete/coach/leave").set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`);
    expect(res.status).toBe(200);
    expect(res.body.relationship.endedReason).toBe("athlete_left");
  });

  test("404 when the athlete has no active coach to leave", async () => {
    const { user } = await makeAthlete("no-coach-athlete");
    const res = await request(buildApp()).post("/api/athlete/coach/leave").set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("no_active_coach");
  });
});

describe("POST /athlete/coach-switch", () => {
  test("ends the current relationship (user_switched) and starts checkout with the new coach", async () => {
    const oldCoach = await makeCoach("old-coach");
    const newCoach = await makeCoach("new-coach");
    const { user, profile } = await makeAthlete("switching-athlete");
    const oldRelationship = await CoachAthleteAssignment.create({ coachId: oldCoach._id, athleteId: profile._id, assignedBy: oldCoach._id, status: "active" });
    const newPlan = await makePlan(newCoach._id);

    const res = await request(buildApp())
      .post("/api/athlete/coach-switch")
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ newCoachId: newCoach._id.toString(), newPricingPlanId: newPlan._id.toString() });
    expect(res.status).toBe(201);
    expect(res.body.subscription.status).toBe("pending");
    expect(res.body.subscription.coachId).toBe(newCoach._id.toString());

    const oldUpdated = await CoachAthleteAssignment.findById(oldRelationship._id).lean();
    expect(oldUpdated!.status).toBe("ended");
    expect(oldUpdated!.endedReason).toBe("user_switched");

    // Only one non-terminal subscription exists (the new pending one) — the
    // one-active-coach index would reject a second active relationship, and
    // since the old one is already ended, the new checkout's eventual
    // activation won't conflict with it.
    const activeRelationships = await CoachAthleteAssignment.countDocuments({ athleteId: profile._id, status: "active" });
    expect(activeRelationships).toBe(0);
  });

  test("switching with NO current coach behaves like a plain fresh subscribe", async () => {
    const newCoach = await makeCoach("fresh-new-coach");
    const { user } = await makeAthlete("fresh-switch-athlete");
    const plan = await makePlan(newCoach._id);

    const res = await request(buildApp())
      .post("/api/athlete/coach-switch")
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ newCoachId: newCoach._id.toString(), newPricingPlanId: plan._id.toString() });
    expect(res.status).toBe(201);
  });

  test("rejects switching to the coach you're already with", async () => {
    const coach = await makeCoach("same-coach");
    const { user, profile } = await makeAthlete("same-coach-athlete");
    await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id, status: "active" });
    const plan = await makePlan(coach._id);

    const res = await request(buildApp())
      .post("/api/athlete/coach-switch")
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ newCoachId: coach._id.toString(), newPricingPlanId: plan._id.toString() });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("already_your_coach");
  });
});
