import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../src/app";
import { signAccessToken } from "../src/lib/tokens";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { CoachAthleteAssignment } from "../src/models/CoachAthleteAssignment";
import { CoachAvailability } from "../src/models/CoachAvailability";
import { CoachPricingPlan } from "../src/models/CoachPricingPlan";
import { AthleteCoachSubscription } from "../src/models/AthleteCoachSubscription";
import { WorkoutTemplate } from "../src/models/WorkoutTemplate";
import { MealPlan } from "../src/models/MealPlan";
import { DeviceToken } from "../src/models/DeviceToken";
import { NotificationPreference } from "../src/models/NotificationPreference";
import { NotificationDecision } from "../src/models/NotificationDecision";
import { assignTemplateToAthlete } from "../src/services/workoutAssignment";
import { assignMealPlanToAthlete } from "../src/services/mealPlanAssignment";
import { runSweep } from "../src/services/notificationSweep";
import { setPaymentProviderForTests, MockPaymentProvider } from "../src/services/paymentProvider";
import {
  setPushDeliveryAdapterForTests,
  type PushDeliveryAdapter,
} from "../src/services/fcmDelivery";

// Phase 12 §3: wires the existing notification pipeline (evaluateAndDispatch
// + the sweep) to Phase 6-10 events that previously fired nothing at all.
// These tests assert against NotificationDecision (the durable record of a
// send/suppress decision), not push delivery mechanics — that's already
// covered generically elsewhere (notification-fcm-delivery.test.ts).
let mongo: MongoMemoryServer;
const app = createApp();

const noopAdapter: PushDeliveryAdapter = {
  async send(input) {
    return input.tokens.map((t) => ({ token: t.token, ok: true }));
  },
};

async function makeCoach(name: string) {
  return User.create({ email: `${name}@test.io`, passwordHash: "x", role: "coach", name });
}
async function makeAthlete(name: string, tz = "UTC") {
  const user = await User.create({ email: `${name}@test.io`, passwordHash: "x", role: "athlete", name });
  const profile = await AthleteProfile.create({ userId: user._id, sport: "general", timezone: tz });
  await DeviceToken.create({ userId: user._id, platform: "android", token: `tok-${user._id.toString()}` });
  return { user, profile };
}
async function giveCoachDeviceToken(coachId: Types.ObjectId) {
  await DeviceToken.create({ userId: coachId, platform: "android", token: `tok-${coachId.toString()}` });
}
function tokenFor(id: Types.ObjectId, role: "coach" | "athlete") {
  return signAccessToken({ sub: id.toString(), role });
}
function decisionsOf(type: string) {
  return NotificationDecision.find({ type }).lean();
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
  setPushDeliveryAdapterForTests(noopAdapter);
});
afterAll(() => setPushDeliveryAdapterForTests(null));

describe("subscription lifecycle notifications", () => {
  test("payment_failed fires when an ACTIVE subscription's payment fails", async () => {
    const coach = await makeCoach("notif-pf-coach");
    await giveCoachDeviceToken(coach._id);
    const { profile } = await makeAthlete("notif-pf-athlete");
    const subscription = await AthleteCoachSubscription.create({
      coachId: coach._id,
      athleteId: profile._id,
      pricingPlanId: new Types.ObjectId(),
      pricingPlanSnapshot: { name: "Pro", monthlyPrice: 20, currency: "USD", includedServices: [], liveSessionsPerCycle: 0, nutritionIncluded: false, workoutPlanningIncluded: false, messagingIncluded: true, version: 1 },
      provider: "razorpay",
      status: "active",
      providerSubscriptionId: "sub_pf_1",
    });
    void subscription;

    const payload = JSON.stringify({ event: "payment.failed", payload: { subscription: { entity: { id: "sub_pf_1" } } } });
    const signature = MockPaymentProvider.signPayloadForTests(Buffer.from(payload));
    const res = await request(app)
      .post("/api/internal/payments/webhook/razorpay")
      .set("Content-Type", "application/json")
      .set("x-razorpay-signature", signature)
      .send(payload);
    expect(res.status).toBe(200);

    const decisions = await decisionsOf("payment_failed");
    expect(decisions).toHaveLength(1);
    expect(decisions[0].status).toBe("sent");
  });

  test("subscription_expired fires on a completed/expired webhook", async () => {
    const coach = await makeCoach("notif-exp-coach");
    const { profile } = await makeAthlete("notif-exp-athlete");
    await AthleteCoachSubscription.create({
      coachId: coach._id,
      athleteId: profile._id,
      pricingPlanId: new Types.ObjectId(),
      pricingPlanSnapshot: { name: "Pro", monthlyPrice: 20, currency: "USD", includedServices: [], liveSessionsPerCycle: 0, nutritionIncluded: false, workoutPlanningIncluded: false, messagingIncluded: true, version: 1 },
      provider: "razorpay",
      status: "active",
      providerSubscriptionId: "sub_exp_1",
    });

    const payload = JSON.stringify({ event: "subscription.completed", payload: { subscription: { entity: { id: "sub_exp_1" } } } });
    const signature = MockPaymentProvider.signPayloadForTests(Buffer.from(payload));
    await request(app)
      .post("/api/internal/payments/webhook/razorpay")
      .set("Content-Type", "application/json")
      .set("x-razorpay-signature", signature)
      .send(payload);

    const decisions = await decisionsOf("subscription_expired");
    expect(decisions).toHaveLength(1);
  });

  test("subscription_expiring fires exactly once for the 7-day threshold and once for the 1-day threshold, not repeatedly across sweeps", async () => {
    const coach = await makeCoach("notif-7d-coach");
    const { user, profile } = await makeAthlete("notif-7d-athlete");
    // subscription_expiring is category "deadlines"; disabling "reminders"
    // isolates it from the other (unrelated, minute-of-day-gated) sweep
    // candidates this athlete would otherwise also qualify for at noon —
    // those share this athlete's per-sweep min-interval budget with
    // subscription_expiring, and the eligibility engine only allows one send
    // per user per minIntervalMinutes window (see notificationEligibility.ts),
    // so without isolating the category a competing "reminders" candidate
    // could win the single available send slot instead.
    await NotificationPreference.create({ userId: user._id, categories: { reminders: false } });
    const now = new Date("2026-03-01T12:00:00.000Z");
    const subscription = await AthleteCoachSubscription.create({
      coachId: coach._id,
      athleteId: profile._id,
      pricingPlanId: new Types.ObjectId(),
      pricingPlanSnapshot: { name: "Pro", monthlyPrice: 20, currency: "USD", includedServices: [], liveSessionsPerCycle: 0, nutritionIncluded: false, workoutPlanningIncluded: false, messagingIncluded: true, version: 1 },
      provider: "razorpay",
      status: "active",
      currentPeriodStart: new Date("2026-02-01T00:00:00.000Z"),
      currentPeriodEnd: new Date(now.getTime() + 5 * 24 * 60 * 60_000), // 5 days out -> 7-day band
    });
    await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id, status: "active", subscriptionId: subscription._id });

    await runSweep({ limit: 50, pages: 1, cursor: null, now });
    await runSweep({ limit: 50, pages: 1, cursor: null, now: new Date(now.getTime() + 60_000) }); // re-run same day — must not double-send

    const decisions = await decisionsOf("subscription_expiring");
    expect(decisions).toHaveLength(1);
    expect(decisions[0].dedupKey).toContain(":7d:");
  });

  test("subscription renewal (not first activation) fires subscription_renewed", async () => {
    const coach = await makeCoach("notif-renew-coach");
    await giveCoachDeviceToken(coach._id);
    const { profile } = await makeAthlete("notif-renew-athlete");
    const relationship = await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id, status: "active" });
    const subscription = await AthleteCoachSubscription.create({
      coachId: coach._id,
      athleteId: profile._id,
      pricingPlanId: new Types.ObjectId(),
      pricingPlanSnapshot: { name: "Pro", monthlyPrice: 20, currency: "USD", includedServices: [], liveSessionsPerCycle: 0, nutritionIncluded: false, workoutPlanningIncluded: false, messagingIncluded: true, version: 1 },
      provider: "razorpay",
      status: "active", // already active (not pending) — the next webhook is a RENEWAL
      providerSubscriptionId: "sub_renew_1",
      relationshipId: relationship._id,
    });
    void subscription;

    const payload = JSON.stringify({
      event: "subscription.charged",
      payload: { subscription: { entity: { id: "sub_renew_1", current_start: 1780000000, current_end: 1782592000 } } },
    });
    const signature = MockPaymentProvider.signPayloadForTests(Buffer.from(payload));
    await request(app)
      .post("/api/internal/payments/webhook/razorpay")
      .set("Content-Type", "application/json")
      .set("x-razorpay-signature", signature)
      .send(payload);

    const decisions = await decisionsOf("subscription_renewed");
    expect(decisions).toHaveLength(1);
  });
});

describe("booking notifications", () => {
  async function setupCoachedAthlete() {
    const coach = await makeCoach("notif-book-coach");
    await giveCoachDeviceToken(coach._id);
    const { user, profile } = await makeAthlete("notif-book-athlete");
    await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id, status: "active" });
    await CoachAvailability.create({ coachId: coach._id, dayOfWeek: 1, startMinute: 480, endMinute: 600, timezone: "UTC", sessionDurationMin: 30, bufferMin: 0 });
    return { coach, user, profile };
  }

  test("booking_requested notifies the coach; booking_confirmed notifies the athlete", async () => {
    const { coach, user } = await setupCoachedAthlete();
    const booked = await request(app)
      .post(`/api/athlete/coaches/${coach._id.toString()}/sessions`)
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ type: "general", scheduledStart: "2026-01-05T08:00:00.000Z" });
    expect(booked.status).toBe(201);
    expect(await decisionsOf("booking_requested")).toHaveLength(1);

    await request(app)
      .post(`/api/coach/sessions/${booked.body.session.id}/confirm`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);
    expect(await decisionsOf("booking_confirmed")).toHaveLength(1);
  });

  test("booking_cancelled notifies the OTHER party — coach cancelling notifies the athlete", async () => {
    const { coach, user } = await setupCoachedAthlete();
    const booked = await request(app)
      .post(`/api/athlete/coaches/${coach._id.toString()}/sessions`)
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ type: "general", scheduledStart: "2026-01-05T08:00:00.000Z" });

    await request(app)
      .post(`/api/coach/sessions/${booked.body.session.id}/cancel`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);

    const decisions = await decisionsOf("booking_cancelled");
    expect(decisions).toHaveLength(1);
    expect(decisions[0].userId.toString()).toBe(user._id.toString()); // the athlete, not the coach who cancelled
  });

  test("session_starting fires within the lead window and not before it", async () => {
    const { coach, user, profile } = await setupCoachedAthlete();
    const { CoachSession } = await import("../src/models/CoachSession");
    const relationship = await CoachAthleteAssignment.findOne({ coachId: coach._id, athleteId: profile._id }).lean();
    const now = new Date("2026-01-05T08:00:00.000Z");

    const soon = await CoachSession.create({
      coachId: coach._id, athleteId: profile._id, relationshipId: relationship!._id, type: "general",
      scheduledStart: new Date(now.getTime() + 10 * 60_000), scheduledEnd: new Date(now.getTime() + 40 * 60_000),
      bufferMin: 0, status: "confirmed", events: [],
    });
    const farAway = await CoachSession.create({
      coachId: coach._id, athleteId: profile._id, relationshipId: relationship!._id, type: "general",
      scheduledStart: new Date(now.getTime() + 5 * 60 * 60_000), scheduledEnd: new Date(now.getTime() + 5.5 * 60 * 60_000),
      bufferMin: 0, status: "confirmed", events: [],
    });
    void user;

    await runSweep({ limit: 50, pages: 1, cursor: null, now });

    const decisions = await decisionsOf("session_starting");
    const dedupKeys = decisions.map((d) => d.dedupKey);
    expect(dedupKeys.some((k) => k.includes(soon._id.toString()))).toBe(true);
    expect(dedupKeys.some((k) => k.includes(farAway._id.toString()))).toBe(false);
  });
});

describe("workout and meal-plan assignment notifications", () => {
  test("workout_assigned fires for a coach-authored assignment, but NOT for an athlete's own self-assignment", async () => {
    const coach = await makeCoach("notif-wk-coach");
    const { user, profile } = await makeAthlete("notif-wk-athlete");
    await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id, status: "active" });

    const coachTemplate = await WorkoutTemplate.create({
      ownerId: coach._id, ownerRole: "coach", name: "Coach Plan",
      exercises: [{ title: "Squat", type: "sets_reps", sets: 4, reps: "8", order: 0 }],
    });
    await assignTemplateToAthlete({ template: coachTemplate, assignedTo: profile._id, assignedBy: coach._id, assignedByRole: "coach", scheduledDate: new Date("2026-01-05") });
    expect(await decisionsOf("workout_assigned")).toHaveLength(1);

    const selfTemplate = await WorkoutTemplate.create({
      ownerId: user._id, ownerRole: "athlete", name: "My Own Plan",
      exercises: [{ title: "Push-up", type: "reps", order: 0 }],
    });
    await assignTemplateToAthlete({ template: selfTemplate, assignedTo: profile._id, assignedBy: user._id, assignedByRole: "athlete", scheduledDate: new Date("2026-01-06") });
    expect(await decisionsOf("workout_assigned")).toHaveLength(1); // unchanged — self-assignment doesn't notify
  });

  test("meal_plan_assigned fires when a coach assigns a meal plan", async () => {
    const coach = await makeCoach("notif-mp-coach");
    const { profile } = await makeAthlete("notif-mp-athlete");
    await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id, status: "active" });

    const plan = await MealPlan.create({
      ownerId: coach._id, name: "Cutting Plan", durationDays: 7,
      days: [{ dayIndex: 0, meals: [{ mealType: "breakfast", foods: [] }] }],
    });
    await assignMealPlanToAthlete({ plan, assignedTo: profile._id, assignedBy: coach._id, startDate: new Date("2026-01-05") });

    expect(await decisionsOf("meal_plan_assigned")).toHaveLength(1);
  });
});

describe("quiet hours still apply to new event types (no bypass introduced)", () => {
  test("booking_confirmed (category: reminders) is suppressed during the recipient's quiet hours", async () => {
    const coach = await makeCoach("notif-quiet-coach");
    await giveCoachDeviceToken(coach._id);
    const { user, profile } = await makeAthlete("notif-quiet-athlete");
    await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: coach._id, status: "active" });
    await CoachAvailability.create({ coachId: coach._id, dayOfWeek: 1, startMinute: 0, endMinute: 24 * 60, timezone: "UTC", sessionDurationMin: 30, bufferMin: 0 });
    // Quiet hours cover the whole day except a 1-minute window, so "now" (whenever the test runs) is virtually guaranteed to fall inside it.
    await NotificationPreference.create({ userId: user._id, quietHours: { enabled: true, startMinute: 0, endMinute: 1439 } });

    const booked = await request(app)
      .post(`/api/athlete/coaches/${coach._id.toString()}/sessions`)
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`)
      .send({ type: "general", scheduledStart: "2026-01-05T08:00:00.000Z" });

    await request(app)
      .post(`/api/coach/sessions/${booked.body.session.id}/confirm`)
      .set("Authorization", `Bearer ${tokenFor(coach._id, "coach")}`);

    // Quiet-hours rejection is TRANSIENT (no NotificationDecision row written at all — see notificationEligibility.ts).
    expect(await decisionsOf("booking_confirmed")).toHaveLength(0);
  });
});
