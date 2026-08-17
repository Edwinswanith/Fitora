import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { CoachPricingPlan } from "../src/models/CoachPricingPlan";
import { CoachAthleteAssignment } from "../src/models/CoachAthleteAssignment";
import { AthleteCoachSubscription } from "../src/models/AthleteCoachSubscription";
import { Payment } from "../src/models/Payment";
import { PaymentWebhookEvent } from "../src/models/PaymentWebhookEvent";
import paymentWebhookRouter from "../src/routes/paymentWebhook";
import subscriptionsRouter from "../src/routes/subscriptions";
import { signAccessToken } from "../src/lib/tokens";
import { setPaymentProviderForTests, MockPaymentProvider } from "../src/services/paymentProvider";

let mongo: MongoMemoryServer;

/** No global express.json() — mirrors app.ts, where the webhook route is mounted BEFORE the json body-parser so the raw bytes survive for HMAC verification. */
function buildWebhookApp() {
  const app = express();
  app.use("/api/internal/payments/webhook", paymentWebhookRouter);
  return app;
}
function buildCheckoutApp() {
  const app = express();
  app.use(express.json());
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
  return CoachPricingPlan.create({
    coachId,
    name: "Pro",
    monthlyPrice: 49,
    currency: "USD",
    workoutPlanningIncluded: true,
    nutritionIncluded: true,
  });
}

/** Starts a checkout via the real route so a pending AthleteCoachSubscription with a real providerSubscriptionId exists. */
async function startCheckout(coachId: Types.ObjectId, athleteUserId: Types.ObjectId, planId: Types.ObjectId) {
  const res = await request(buildCheckoutApp())
    .post("/api/athlete/coach-subscriptions")
    .set("Authorization", `Bearer ${tokenFor(athleteUserId, "athlete")}`)
    .send({ coachId: coachId.toString(), pricingPlanId: planId.toString() });
  const sub = await AthleteCoachSubscription.findById(res.body.subscription.id);
  if (!sub) throw new Error("checkout did not create a subscription");
  return sub;
}

function envelope(eventType: string, extra: Record<string, unknown>): Buffer {
  return Buffer.from(JSON.stringify({ event: eventType, payload: extra }), "utf8");
}
function sign(body: Buffer): string {
  return MockPaymentProvider.signPayloadForTests(body);
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

describe("POST /api/internal/payments/webhook/razorpay", () => {
  test("rejects a delivery with no/invalid signature — never activates anything (forgery rejection)", async () => {
    const coach = await makeCoach("forge-coach");
    const plan = await makePlan(coach._id);
    const { user } = await makeAthlete("forge-athlete");
    const sub = await startCheckout(coach._id, user._id, plan._id);

    const body = envelope("subscription.activated", {
      subscription: { entity: { id: sub.providerSubscriptionId, current_start: 1000, current_end: 2000 } },
    });

    const res = await request(buildWebhookApp())
      .post("/api/internal/payments/webhook/razorpay")
      .set("Content-Type", "application/json")
      .set("x-razorpay-signature", "0".repeat(64)) // well-formed hex, wrong value
      .send(body.toString("utf8"));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_signature");

    const stillPending = await AthleteCoachSubscription.findById(sub._id);
    expect(stillPending!.status).toBe("pending");
    expect(await PaymentWebhookEvent.countDocuments({})).toBe(0);
  });

  test("a client asserting success in the body with NO valid signature never activates a subscription", async () => {
    const coach = await makeCoach("client-forge-coach");
    const plan = await makePlan(coach._id);
    const { user } = await makeAthlete("client-forge-athlete");
    const sub = await startCheckout(coach._id, user._id, plan._id);

    // Attacker-controlled body claiming activation, no signature header at all.
    const body = envelope("subscription.activated", {
      subscription: { entity: { id: sub.providerSubscriptionId, current_start: 1000, current_end: 999999999 } },
    });
    const res = await request(buildWebhookApp())
      .post("/api/internal/payments/webhook/razorpay")
      .set("Content-Type", "application/json")
      .send(body.toString("utf8"));

    expect(res.status).toBe(400);
    const stillPending = await AthleteCoachSubscription.findById(sub._id);
    expect(stillPending!.status).toBe("pending");
  });

  test("valid signature activates the subscription and creates the coach relationship", async () => {
    const coach = await makeCoach("valid-coach");
    const plan = await makePlan(coach._id);
    const { user, profile } = await makeAthlete("valid-athlete");
    const sub = await startCheckout(coach._id, user._id, plan._id);

    const body = envelope("subscription.activated", {
      subscription: {
        entity: { id: sub.providerSubscriptionId, current_start: Math.floor(Date.now() / 1000), current_end: Math.floor(Date.now() / 1000) + 2592000 },
      },
    });
    const res = await request(buildWebhookApp())
      .post("/api/internal/payments/webhook/razorpay")
      .set("Content-Type", "application/json")
      .set("x-razorpay-signature", sign(body))
      .send(body.toString("utf8"));

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);

    const activated = await AthleteCoachSubscription.findById(sub._id);
    expect(activated!.status).toBe("active");
    const relationship = await CoachAthleteAssignment.findOne({ athleteId: profile._id, status: "active" });
    expect(relationship).not.toBeNull();
    expect(relationship!.coachId.toString()).toBe(coach._id.toString());
  });

  test("redelivering the IDENTICAL webhook body is idempotent — acknowledged as duplicate, no reprocessing", async () => {
    const coach = await makeCoach("dup-coach");
    const plan = await makePlan(coach._id);
    const { user } = await makeAthlete("dup-athlete");
    const sub = await startCheckout(coach._id, user._id, plan._id);

    const body = envelope("subscription.activated", {
      subscription: { entity: { id: sub.providerSubscriptionId, current_start: 1000, current_end: 999999999 } },
    });
    const signature = sign(body);
    const app = buildWebhookApp();

    const first = await request(app)
      .post("/api/internal/payments/webhook/razorpay")
      .set("Content-Type", "application/json")
      .set("x-razorpay-signature", signature)
      .send(body.toString("utf8"));
    expect(first.status).toBe(200);
    expect(first.body.duplicate).toBeUndefined();

    const second = await request(app)
      .post("/api/internal/payments/webhook/razorpay")
      .set("Content-Type", "application/json")
      .set("x-razorpay-signature", signature)
      .send(body.toString("utf8"));
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);

    expect(await PaymentWebhookEvent.countDocuments({})).toBe(1);
    // Only one relationship created despite two deliveries of the activation event.
    expect(await CoachAthleteAssignment.countDocuments({})).toBe(1);
  });

  test("duplicate payment.captured id across two DIFFERENT webhook deliveries never double-records a Payment", async () => {
    const coach = await makeCoach("dup-payment-coach");
    const plan = await makePlan(coach._id);
    const { user } = await makeAthlete("dup-payment-athlete");
    const sub = await startCheckout(coach._id, user._id, plan._id);
    const app = buildWebhookApp();

    // First delivery: activation + charge with payment id "pay_dup_1".
    const body1 = envelope("subscription.charged", {
      subscription: { entity: { id: sub.providerSubscriptionId, current_start: 1000, current_end: 2592000 } },
      payment: { entity: { id: "pay_dup_1", amount: 4900, currency: "USD" } },
    });
    const res1 = await request(app)
      .post("/api/internal/payments/webhook/razorpay")
      .set("Content-Type", "application/json")
      .set("x-razorpay-signature", sign(body1))
      .send(body1.toString("utf8"));
    expect(res1.status).toBe(200);

    // Second, DIFFERENT delivery (different created_at so the raw-body hash differs and
    // the PaymentWebhookEvent idempotency row does NOT catch it) but the SAME payment id —
    // Payment.providerPaymentId's own unique index is the second, independent guard.
    const body2 = envelope("subscription.charged", {
      subscription: { entity: { id: sub.providerSubscriptionId, current_start: 1000, current_end: 2592000 } },
      payment: { entity: { id: "pay_dup_1", amount: 4900, currency: "USD" } },
      created_at: 123456,
    });
    const res2 = await request(app)
      .post("/api/internal/payments/webhook/razorpay")
      .set("Content-Type", "application/json")
      .set("x-razorpay-signature", sign(body2))
      .send(body2.toString("utf8"));
    expect(res2.status).toBe(200);
    expect(res2.body.duplicate).toBeUndefined(); // a genuinely new webhook-event hash

    expect(await Payment.countDocuments({ providerPaymentId: "pay_dup_1" })).toBe(1);
  });

  test("payment.failed on an active subscription moves it to payment_due without ending the relationship", async () => {
    const coach = await makeCoach("failed-coach");
    const plan = await makePlan(coach._id);
    const { user } = await makeAthlete("failed-athlete");
    const sub = await startCheckout(coach._id, user._id, plan._id);
    const app = buildWebhookApp();

    const activateBody = envelope("subscription.activated", {
      subscription: { entity: { id: sub.providerSubscriptionId, current_start: 1000, current_end: 2592000 } },
    });
    await request(app)
      .post("/api/internal/payments/webhook/razorpay")
      .set("Content-Type", "application/json")
      .set("x-razorpay-signature", sign(activateBody))
      .send(activateBody.toString("utf8"));

    const failBody = envelope("payment.failed", {
      subscription: { entity: { id: sub.providerSubscriptionId } },
      payment: { entity: { id: "pay_failed_1", amount: 4900, currency: "USD" } },
    });
    const res = await request(app)
      .post("/api/internal/payments/webhook/razorpay")
      .set("Content-Type", "application/json")
      .set("x-razorpay-signature", sign(failBody))
      .send(failBody.toString("utf8"));
    expect(res.status).toBe(200);

    const updated = await AthleteCoachSubscription.findById(sub._id);
    expect(updated!.status).toBe("payment_due");
    const relationship = await CoachAthleteAssignment.findById(updated!.relationshipId);
    expect(relationship!.status).toBe("active"); // grace period — not ended yet
  });

  test("unknown event type is acknowledged (200) but causes no state change", async () => {
    const coach = await makeCoach("unknown-coach");
    const plan = await makePlan(coach._id);
    const { user } = await makeAthlete("unknown-athlete");
    const sub = await startCheckout(coach._id, user._id, plan._id);
    const body = envelope("subscription.pending", { subscription: { entity: { id: sub.providerSubscriptionId } } });

    const res = await request(buildWebhookApp())
      .post("/api/internal/payments/webhook/razorpay")
      .set("Content-Type", "application/json")
      .set("x-razorpay-signature", sign(body))
      .send(body.toString("utf8"));

    expect(res.status).toBe(200);
    const unchanged = await AthleteCoachSubscription.findById(sub._id);
    expect(unchanged!.status).toBe("pending");
  });
});
