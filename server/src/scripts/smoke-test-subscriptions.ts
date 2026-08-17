/**
 * One-off manual verification against the REAL fitora Atlas database — proves
 * the Phase 6 subscription/payment lifecycle persists correctly end-to-end:
 * checkout creates a pending row with no relationship yet, a verified webhook
 * activation creates the CoachAthleteAssignment relationship, and cancel sets
 * cancelAtPeriodEnd without ending access. Uses the mock payment provider
 * (no live Razorpay credentials needed). Cleans up everything it creates.
 */
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { connectMongo, disconnectMongo } from "../db/mongoose";
import { User } from "../models/User";
import { AthleteProfile } from "../models/AthleteProfile";
import { CoachAthleteAssignment } from "../models/CoachAthleteAssignment";
import { CoachPricingPlan } from "../models/CoachPricingPlan";
import { AthleteCoachSubscription } from "../models/AthleteCoachSubscription";
import { Payment } from "../models/Payment";
import {
  initiateSubscription,
  applyPaymentEvent,
  cancelSubscription,
  getCurrentSubscription,
} from "../services/subscription";
import { setPaymentProviderForTests, MockPaymentProvider } from "../services/paymentProvider";

async function run() {
  await connectMongo();
  console.log("[smoke-subscriptions] connected to", mongoose.connection.db?.databaseName);
  setPaymentProviderForTests(new MockPaymentProvider());

  const passwordHash = await bcrypt.hash("smoketest", 10);
  const coach = await User.create({ email: "smoke-sub-coach@fitora.test", passwordHash, role: "coach", name: "Smoke Coach" });
  const athleteUser = await User.create({ email: "smoke-sub-athlete@fitora.test", passwordHash, role: "athlete", name: "Smoke Athlete" });
  const profile = await AthleteProfile.create({ userId: athleteUser._id, sport: "general" });
  const plan = await CoachPricingPlan.create({
    coachId: coach._id,
    name: "Smoke Pro",
    monthlyPrice: 29,
    currency: "USD",
    workoutPlanningIncluded: true,
    nutritionIncluded: true,
  });

  const { subscription, checkoutRef } = await initiateSubscription(profile._id, coach._id, plan._id);
  console.log("[smoke-subscriptions] checkout created, status:", subscription.status, "checkoutRef:", checkoutRef);

  const relationshipBeforeActivation = await CoachAthleteAssignment.countDocuments({ athleteId: profile._id });
  console.log("[smoke-subscriptions] relationships before activation:", relationshipBeforeActivation, "(expect 0)");

  await applyPaymentEvent({
    eventType: "subscription.activated",
    providerSubscriptionId: subscription.providerSubscriptionId ?? null,
    providerPaymentId: "smoke_payment_1",
    amount: 29,
    currency: "USD",
    periodStart: new Date(),
    periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    raw: {},
  });

  const activated = await AthleteCoachSubscription.findById(subscription._id);
  console.log("[smoke-subscriptions] status after webhook activation:", activated?.status, "(expect active)");

  const relationship = await CoachAthleteAssignment.findById(activated?.relationshipId).lean();
  console.log("[smoke-subscriptions] relationship created:", Boolean(relationship), "status:", relationship?.status, "(expect true / active)");

  const payment = await Payment.findOne({ providerPaymentId: "smoke_payment_1" }).lean();
  console.log("[smoke-subscriptions] payment recorded:", Boolean(payment), "status:", payment?.status, "(expect true / succeeded)");

  const current = await getCurrentSubscription(profile._id);
  console.log("[smoke-subscriptions] getCurrentSubscription resolves:", current?._id.toString() === subscription._id.toString());

  const cancelled = await cancelSubscription(profile._id, subscription._id);
  console.log("[smoke-subscriptions] after athlete cancel — status:", cancelled.status, "cancelAtPeriodEnd:", cancelled.cancelAtPeriodEnd, "(expect active / true)");

  const relationshipStillActive = await CoachAthleteAssignment.findById(activated?.relationshipId).lean();
  console.log("[smoke-subscriptions] relationship still active after cancel-at-period-end:", relationshipStillActive?.status, "(expect active)");

  const ok =
    subscription.status === "pending" &&
    relationshipBeforeActivation === 0 &&
    activated?.status === "active" &&
    relationship?.status === "active" &&
    payment?.status === "succeeded" &&
    current?._id.toString() === subscription._id.toString() &&
    cancelled.status === "active" &&
    cancelled.cancelAtPeriodEnd === true &&
    relationshipStillActive?.status === "active";

  await Promise.all([
    Payment.deleteMany({ subscriptionId: subscription._id }),
    AthleteCoachSubscription.deleteOne({ _id: subscription._id }),
    CoachAthleteAssignment.deleteOne({ _id: activated?.relationshipId }),
    CoachPricingPlan.deleteOne({ _id: plan._id }),
    AthleteProfile.deleteOne({ _id: profile._id }),
    User.deleteOne({ _id: coach._id }),
    User.deleteOne({ _id: athleteUser._id }),
  ]);
  console.log("[smoke-subscriptions] cleanup complete — database left as found");

  if (!ok) throw new Error("smoke test assertions failed");
  console.log("[smoke-subscriptions] ALL ASSERTIONS PASSED");
}

run()
  .then(async () => {
    await disconnectMongo();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("[smoke-subscriptions] FAILED:", err);
    await disconnectMongo().catch(() => undefined);
    process.exit(1);
  });
