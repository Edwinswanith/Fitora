import { Types, type HydratedDocument } from "mongoose";
import { AthleteProfile } from "../models/AthleteProfile";
import { CoachPricingPlan, type CoachPricingPlanDoc } from "../models/CoachPricingPlan";
import { CoachAthleteAssignment } from "../models/CoachAthleteAssignment";
import {
  AthleteCoachSubscription,
  type AthleteCoachSubscriptionDoc,
} from "../models/AthleteCoachSubscription";
import { Payment } from "../models/Payment";
import { getPaymentProvider, type NormalizedPaymentEvent } from "./paymentProvider";

export class SubscriptionError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const DEFAULT_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;
const EXPIRING_SOON_THRESHOLD_DAYS = 7;

function pricingPlanSnapshotOf(plan: CoachPricingPlanDoc) {
  return {
    name: plan.name,
    monthlyPrice: plan.monthlyPrice,
    currency: plan.currency,
    includedServices: plan.includedServices,
    liveSessionsPerCycle: plan.liveSessionsPerCycle,
    nutritionIncluded: plan.nutritionIncluded,
    workoutPlanningIncluded: plan.workoutPlanningIncluded,
    messagingIncluded: plan.messagingIncluded,
    version: plan.version,
  };
}

/**
 * Athlete-initiated checkout start. Creates the `pending` subscription row
 * FIRST (claiming the one-non-terminal-subscription-per-athlete index slot)
 * then asks the provider for a checkout ref; on provider failure the row is
 * deleted so the athlete can retry (no transactions in this stack — same
 * create-then-rollback shape used elsewhere, e.g. routes/coach.ts athlete
 * creation).
 */
export async function initiateSubscription(
  athleteId: Types.ObjectId,
  coachId: Types.ObjectId,
  pricingPlanId: Types.ObjectId
): Promise<{ subscription: HydratedDocument<AthleteCoachSubscriptionDoc>; checkoutRef: string }> {
  const plan = await CoachPricingPlan.findOne({ _id: pricingPlanId, coachId, active: true });
  if (!plan) throw new SubscriptionError(404, "pricing_plan_not_found");

  // One primary Coach at a time (same product rule CoachAthleteAssignment's
  // own index enforces) — checked here too so a subscribe attempt while
  // already coached fails with a clear reason instead of a confusing
  // downstream conflict once the webhook tries to create the relationship.
  const hasActiveCoach = await CoachAthleteAssignment.exists({ athleteId, status: "active" });
  if (hasActiveCoach) throw new SubscriptionError(409, "athlete_has_active_coach");

  let subscription: HydratedDocument<AthleteCoachSubscriptionDoc>;
  try {
    subscription = await AthleteCoachSubscription.create({
      coachId,
      athleteId,
      pricingPlanId: plan._id,
      pricingPlanSnapshot: pricingPlanSnapshotOf(plan),
      provider: "razorpay",
      status: "pending",
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      throw new SubscriptionError(409, "athlete_already_subscribing");
    }
    throw err;
  }

  try {
    const provider = getPaymentProvider();
    const checkout = await provider.createSubscriptionCheckout({
      coachId: coachId.toString(),
      athleteId: athleteId.toString(),
      pricingPlan: {
        id: plan._id.toString(),
        name: plan.name,
        monthlyPrice: plan.monthlyPrice,
        currency: plan.currency,
        razorpayPlanId: plan.razorpayPlanId ?? null,
      },
    });

    subscription.providerSubscriptionId = checkout.providerSubscriptionId;
    await subscription.save();

    if (!plan.razorpayPlanId && checkout.providerPlanId) {
      await CoachPricingPlan.updateOne({ _id: plan._id }, { $set: { razorpayPlanId: checkout.providerPlanId } });
    }

    return { subscription, checkoutRef: checkout.checkoutRef };
  } catch (err) {
    await AthleteCoachSubscription.deleteOne({ _id: subscription._id }).catch(() => undefined);
    throw err;
  }
}

async function upsertPaymentFromEvent(
  subscription: HydratedDocument<AthleteCoachSubscriptionDoc>,
  event: NormalizedPaymentEvent,
  status: "succeeded" | "failed"
): Promise<void> {
  if (!event.providerPaymentId) return;
  try {
    await Payment.create({
      subscriptionId: subscription._id,
      provider: subscription.provider,
      providerPaymentId: event.providerPaymentId,
      amount: event.amount ?? subscription.pricingPlanSnapshot!.monthlyPrice,
      currency: event.currency ?? subscription.pricingPlanSnapshot!.currency,
      status,
      periodStart: event.periodStart,
      periodEnd: event.periodEnd,
      rawEventRef: event.raw,
    });
  } catch (err) {
    // Duplicate delivery of the same payment — already recorded, not an error.
    if ((err as { code?: number }).code !== 11000) throw err;
  }
}

async function activateOrRenewSubscription(event: NormalizedPaymentEvent): Promise<void> {
  if (!event.providerSubscriptionId) return;
  const subscription = await AthleteCoachSubscription.findOne({
    providerSubscriptionId: event.providerSubscriptionId,
  });
  if (!subscription) return;

  const periodStart = event.periodStart ?? new Date();
  const periodEnd = event.periodEnd ?? new Date(periodStart.getTime() + DEFAULT_PERIOD_MS);
  const wasPending = subscription.status === "pending";

  subscription.status = "active";
  subscription.currentPeriodStart = periodStart;
  subscription.currentPeriodEnd = periodEnd;
  subscription.nextBillingAt = periodEnd;

  if (wasPending && !subscription.relationshipId) {
    const athleteProfile = await AthleteProfile.findById(subscription.athleteId).select("userId").lean();
    if (athleteProfile) {
      const relationship = await CoachAthleteAssignment.create({
        coachId: subscription.coachId,
        athleteId: subscription.athleteId,
        assignedBy: athleteProfile.userId,
        endedAt: null,
        status: "active",
        subscriptionId: subscription._id,
      });
      subscription.relationshipId = relationship._id;
    }
  }

  await subscription.save();
  await upsertPaymentFromEvent(subscription, event, "succeeded");
}

async function markPaymentDue(event: NormalizedPaymentEvent): Promise<void> {
  if (!event.providerSubscriptionId) return;
  const subscription = await AthleteCoachSubscription.findOne({
    providerSubscriptionId: event.providerSubscriptionId,
  });
  if (!subscription) return;

  subscription.status = subscription.status === "pending" ? "cancelled" : "payment_due";
  await subscription.save();
  await upsertPaymentFromEvent(subscription, event, "failed");
}

async function endSubscriptionFromWebhook(
  event: NormalizedPaymentEvent,
  status: "cancelled" | "expired",
  endedReason: "subscription_cancelled" | "subscription_expired"
): Promise<void> {
  if (!event.providerSubscriptionId) return;
  const subscription = await AthleteCoachSubscription.findOne({
    providerSubscriptionId: event.providerSubscriptionId,
  });
  if (!subscription) return;

  subscription.status = status;
  subscription.cancelledAt = new Date();
  await subscription.save();

  if (subscription.relationshipId) {
    await CoachAthleteAssignment.updateOne(
      { _id: subscription.relationshipId, status: "active" },
      { $set: { endedAt: new Date(), status: "ended", endedReason } }
    );
  }
}

/**
 * Dispatches an already-signature-verified, already-idempotency-claimed
 * webhook event. Never trust a client-asserted "payment succeeded" body —
 * this is only ever called from the webhook route after
 * provider.verifyWebhookSignature() has passed.
 */
export async function applyPaymentEvent(event: NormalizedPaymentEvent): Promise<void> {
  switch (event.eventType) {
    case "subscription.activated":
    case "subscription.charged":
      await activateOrRenewSubscription(event);
      return;
    case "subscription.cancelled":
      await endSubscriptionFromWebhook(event, "cancelled", "subscription_cancelled");
      return;
    case "subscription.completed":
      await endSubscriptionFromWebhook(event, "expired", "subscription_expired");
      return;
    case "payment.failed":
      await markPaymentDue(event);
      return;
    default:
      // Acknowledged (the idempotency row is already written by the route)
      // but no state change — e.g. payment.captured is redundant with
      // subscription.charged for our purposes.
      return;
  }
}

const NON_TERMINAL_STATUSES = ["pending", "active", "payment_due"] as const;

export async function getCurrentSubscription(
  athleteId: Types.ObjectId
): Promise<HydratedDocument<AthleteCoachSubscriptionDoc> | null> {
  return AthleteCoachSubscription.findOne({ athleteId, status: { $in: NON_TERMINAL_STATUSES } })
    .sort({ createdAt: -1 })
    .exec();
}

export async function cancelSubscription(
  athleteId: Types.ObjectId,
  subscriptionId: Types.ObjectId
): Promise<HydratedDocument<AthleteCoachSubscriptionDoc>> {
  const subscription = await AthleteCoachSubscription.findOne({ _id: subscriptionId, athleteId });
  if (!subscription) throw new SubscriptionError(404, "subscription_not_found");
  if (!NON_TERMINAL_STATUSES.includes(subscription.status as (typeof NON_TERMINAL_STATUSES)[number])) {
    throw new SubscriptionError(409, "subscription_not_active");
  }

  if (subscription.status === "pending" && !subscription.relationshipId) {
    // Checkout was started but never activated — nothing billing yet, cancel outright.
    subscription.status = "cancelled";
    subscription.cancelledAt = new Date();
    await subscription.save();
    return subscription;
  }

  if (subscription.providerSubscriptionId) {
    const provider = getPaymentProvider();
    await provider.cancelSubscription(subscription.providerSubscriptionId, true);
  }

  subscription.cancelAtPeriodEnd = true;
  await subscription.save();
  return subscription;
}

export function isExpiringSoon(
  subscription: HydratedDocument<AthleteCoachSubscriptionDoc>,
  thresholdDays = EXPIRING_SOON_THRESHOLD_DAYS
): boolean {
  if (!["active", "payment_due"].includes(subscription.status)) return false;
  if (!subscription.currentPeriodEnd) return false;
  const msRemaining = subscription.currentPeriodEnd.getTime() - Date.now();
  return msRemaining >= 0 && msRemaining <= thresholdDays * 24 * 60 * 60 * 1000;
}

/**
 * Gates a coach-provided feature (workout planning / nutrition planning)
 * behind subscription entitlement — but ONLY when the relationship actually
 * has a linked subscription. Relationships created before Phase 6 existed
 * (or created via the plain coach-athlete link/create flow with no payment
 * attached) have `subscriptionId: null` and stay fully unpaywalled, which is
 * the explicit backward-compatibility requirement: this must never break a
 * coach/athlete pair that never subscribed to anything.
 */
export async function checkFeatureEntitlement(
  athleteId: Types.ObjectId,
  coachId: Types.ObjectId,
  feature: "workoutPlanningIncluded" | "nutritionIncluded"
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  const relationship = await CoachAthleteAssignment.findOne({ athleteId, coachId, status: "active" })
    .select("subscriptionId")
    .lean();
  if (!relationship?.subscriptionId) return { allowed: true };

  const subscription = await AthleteCoachSubscription.findById(relationship.subscriptionId)
    .select("status pricingPlanSnapshot")
    .lean();
  if (!subscription) return { allowed: true };

  if (!["active", "payment_due"].includes(subscription.status)) {
    return { allowed: false, reason: "subscription_not_active" };
  }
  if (!subscription.pricingPlanSnapshot?.[feature]) {
    return { allowed: false, reason: "feature_not_included_in_plan" };
  }
  return { allowed: true };
}

export function serializeSubscription(subscription: HydratedDocument<AthleteCoachSubscriptionDoc>) {
  return {
    id: subscription._id.toString(),
    coachId: subscription.coachId.toString(),
    relationshipId: subscription.relationshipId ? subscription.relationshipId.toString() : null,
    pricingPlan: subscription.pricingPlanSnapshot,
    status: subscription.status,
    currentPeriodStart: subscription.currentPeriodStart,
    currentPeriodEnd: subscription.currentPeriodEnd,
    nextBillingAt: subscription.nextBillingAt,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    cancelledAt: subscription.cancelledAt,
    isExpiringSoon: isExpiringSoon(subscription),
  };
}
