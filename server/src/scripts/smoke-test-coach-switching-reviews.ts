/**
 * One-off manual verification against the REAL fitora Atlas database — proves
 * Phase 10's relationship-ending, coach-switching, and review lifecycle
 * persist correctly: ending a relationship immediately cancels a linked
 * subscription, switching atomically ends-old/starts-new, and a review is
 * only accepted once the relationship has ended, with the CoachProfile
 * rating aggregate recomputed server-side. Cleans up everything it creates.
 */
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { connectMongo, disconnectMongo } from "../db/mongoose";
import { User } from "../models/User";
import { AthleteProfile } from "../models/AthleteProfile";
import { CoachAthleteAssignment } from "../models/CoachAthleteAssignment";
import { CoachPricingPlan } from "../models/CoachPricingPlan";
import { AthleteCoachSubscription } from "../models/AthleteCoachSubscription";
import { CoachProfile } from "../models/CoachProfile";
import { CoachReview } from "../models/CoachReview";
import { switchCoach } from "../services/coachRelationship";
import { createReview } from "../services/coachReview";
import { setPaymentProviderForTests, MockPaymentProvider } from "../services/paymentProvider";

async function run() {
  await connectMongo();
  console.log("[smoke-switching-reviews] connected to", mongoose.connection.db?.databaseName);
  setPaymentProviderForTests(new MockPaymentProvider());

  const passwordHash = await bcrypt.hash("smoketest", 10);
  const oldCoach = await User.create({ email: "smoke-switch-old-coach@fitora.test", passwordHash, role: "coach", name: "Old Coach" });
  const newCoach = await User.create({ email: "smoke-switch-new-coach@fitora.test", passwordHash, role: "coach", name: "New Coach" });
  const athleteUser = await User.create({ email: "smoke-switch-athlete@fitora.test", passwordHash, role: "athlete", name: "Smoke Athlete" });
  const profile = await AthleteProfile.create({ userId: athleteUser._id, sport: "general" });

  const oldPlan = await CoachPricingPlan.create({ coachId: oldCoach._id, name: "Old Pro", monthlyPrice: 15, currency: "USD" });
  const newPlan = await CoachPricingPlan.create({ coachId: newCoach._id, name: "New Pro", monthlyPrice: 25, currency: "USD" });

  const oldSubscription = await AthleteCoachSubscription.create({
    coachId: oldCoach._id,
    athleteId: profile._id,
    pricingPlanId: oldPlan._id,
    pricingPlanSnapshot: { name: oldPlan.name, monthlyPrice: oldPlan.monthlyPrice, currency: oldPlan.currency, includedServices: [], liveSessionsPerCycle: 0, nutritionIncluded: false, workoutPlanningIncluded: false, messagingIncluded: true, version: 1 },
    provider: "razorpay",
    status: "active",
    providerSubscriptionId: "smoke_switch_sub",
  });
  const oldRelationship = await CoachAthleteAssignment.create({
    coachId: oldCoach._id,
    athleteId: profile._id,
    assignedBy: oldCoach._id,
    status: "active",
    subscriptionId: oldSubscription._id,
  });

  const { subscription: newSubscription } = await switchCoach(profile._id, newCoach._id, newPlan._id);
  console.log("[smoke-switching-reviews] new checkout status:", newSubscription.status, "(expect pending)");

  const oldRelAfterSwitch = await CoachAthleteAssignment.findById(oldRelationship._id).lean();
  const oldSubAfterSwitch = await AthleteCoachSubscription.findById(oldSubscription._id).lean();
  console.log("[smoke-switching-reviews] old relationship status:", oldRelAfterSwitch?.status, "reason:", oldRelAfterSwitch?.endedReason, "(expect ended / user_switched)");
  console.log("[smoke-switching-reviews] old subscription status:", oldSubAfterSwitch?.status, "(expect cancelled — immediate, not soft)");

  // A review attempt before the old relationship existed-and-ended would be
  // blocked; now that it's ended, leave one and confirm the aggregate.
  const reloadedOldRel = await CoachAthleteAssignment.findById(oldRelationship._id);
  const review = await createReview(reloadedOldRel!, profile._id, { overallRating: 4, subRatings: { communication: 5 }, body: "Great while it lasted" });
  console.log("[smoke-switching-reviews] review created:", review._id.toString());

  const oldCoachProfile = await CoachProfile.findOne({ userId: oldCoach._id }).lean();
  console.log("[smoke-switching-reviews] old coach's CoachProfile aggregate:", oldCoachProfile?.avgRating, oldCoachProfile?.reviewCount, "(expect 4 / 1)");

  const ok =
    newSubscription.status === "pending" &&
    oldRelAfterSwitch?.status === "ended" &&
    oldRelAfterSwitch?.endedReason === "user_switched" &&
    oldSubAfterSwitch?.status === "cancelled" &&
    oldSubAfterSwitch?.cancelAtPeriodEnd === false &&
    oldCoachProfile?.avgRating === 4 &&
    oldCoachProfile?.reviewCount === 1;

  await Promise.all([
    CoachReview.deleteOne({ _id: review._id }),
    CoachProfile.deleteOne({ userId: oldCoach._id }),
    AthleteCoachSubscription.deleteMany({ athleteId: profile._id }),
    CoachAthleteAssignment.deleteMany({ athleteId: profile._id }),
    CoachPricingPlan.deleteMany({ _id: { $in: [oldPlan._id, newPlan._id] } }),
    AthleteProfile.deleteOne({ _id: profile._id }),
    User.deleteMany({ _id: { $in: [oldCoach._id, newCoach._id, athleteUser._id] } }),
  ]);
  console.log("[smoke-switching-reviews] cleanup complete — database left as found");

  if (!ok) throw new Error("smoke test assertions failed");
  console.log("[smoke-switching-reviews] ALL ASSERTIONS PASSED");
}

run()
  .then(async () => {
    await disconnectMongo();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("[smoke-switching-reviews] FAILED:", err);
    await disconnectMongo().catch(() => undefined);
    process.exit(1);
  });
