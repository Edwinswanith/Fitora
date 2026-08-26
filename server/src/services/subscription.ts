import { Types, type ClientSession, type HydratedDocument } from "mongoose";
import { AthleteProfile } from "../models/AthleteProfile";
import { User } from "../models/User";
import { CoachPricingPlan, type CoachPricingPlanDoc } from "../models/CoachPricingPlan";
import { CoachAthleteAssignment } from "../models/CoachAthleteAssignment";
import {
  AthleteCoachSubscription,
  type AthleteCoachSubscriptionDoc,
} from "../models/AthleteCoachSubscription";
import { CoachSwitchIntent, type CoachSwitchIntentDoc } from "../models/CoachSwitchIntent";
import { CoachSession, type CoachSessionStatus } from "../models/CoachSession";
import { Payment } from "../models/Payment";
import { getPaymentProvider, type NormalizedPaymentEvent } from "./paymentProvider";
import { withOptionalTransaction, cancelOpenSessionsAndVideoRoomsForRelationship } from "./bookingConcurrency";
import { cancelOpenCoachContentForRelationship } from "./relationshipCleanup";
import { evaluateAndDispatch } from "./notificationEligibility";
import { resolveTimezoneForUser } from "./timezone";
import { categoryForType } from "../lib/notificationTypes";
import * as templates from "./notificationTemplates";

/**
 * Shared dispatch for every athlete-facing subscription-lifecycle
 * notification (Phase 12 §3) — resolves the athlete's User id + timezone,
 * looks up the coach's name for the copy, and fires through the normal
 * eligibility engine (quiet hours / category prefs / cap / dedup all still
 * apply — none of these are safety-critical overrides). Best-effort: a
 * notification failure must never break the webhook/sweep path that
 * triggered it.
 */
async function notifyAthleteSubscriptionEvent(
  subscription: Pick<AthleteCoachSubscriptionDoc, "athleteId" | "coachId">,
  dedupSuffix: string,
  type: keyof typeof import("../lib/notificationTypes").NOTIFICATION_TYPES,
  template: templates.TemplateResult
): Promise<void> {
  try {
    const profile = await AthleteProfile.findById(subscription.athleteId).select("userId").lean();
    if (!profile?.userId) return;
    const userId = profile.userId as Types.ObjectId;
    const timezone = await resolveTimezoneForUser({ userId, role: "athlete" });
    await evaluateAndDispatch({
      userId,
      type,
      category: categoryForType(type),
      priorityTier: 2,
      dedupKey: `${type}:${subscription.athleteId.toString()}:${dedupSuffix}`,
      timezone,
      entityRef: { collection: "AthleteCoachSubscription", id: subscription.athleteId as Types.ObjectId },
      ...template,
    });
  } catch (err) {
    console.error("[subscription] notification dispatch failed (non-fatal)", (err as Error).message);
  }
}

async function coachNameOf(coachId: Types.ObjectId): Promise<string> {
  const coach = await User.findById(coachId).select("name").lean();
  return (coach?.name as string) || "your coach";
}

/** Best-effort — never lets a notification failure fail the switch/webhook write that triggered it. */
async function notifyCoachAthleteLeft(coachId: Types.ObjectId, athleteId: Types.ObjectId, dedupSuffix: string): Promise<void> {
  try {
    const athleteProfile = await AthleteProfile.findById(athleteId).select("userId").lean();
    const athleteUser = athleteProfile?.userId
      ? await User.findById(athleteProfile.userId).select("name").lean()
      : null;
    const timezone = await resolveTimezoneForUser({ userId: coachId, role: "coach" });
    await evaluateAndDispatch({
      userId: coachId,
      type: "coach_athlete_left",
      category: categoryForType("coach_athlete_left"),
      priorityTier: 3,
      dedupKey: `coach_athlete_left:${athleteId.toString()}:${dedupSuffix}`,
      timezone,
      entityRef: { collection: "CoachAthleteAssignment", id: athleteId },
      ...templates.buildAthleteLeftForCoach({ athleteName: (athleteUser?.name as string) || "An athlete", initiatedByCoach: false }),
    });
  } catch (err) {
    console.error("[subscription] notification dispatch failed (non-fatal)", (err as Error).message);
  }
}

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
 * Shared provider-checkout step used by both a fresh subscribe
 * (initiateSubscription) and a coach-switch intent (initiateSwitchIntent) —
 * asks the provider for a checkout ref for the given plan, caching a newly-
 * created provider-side plan id back onto CoachPricingPlan the same way both
 * callers used to do inline.
 */
async function createProviderCheckout(
  plan: HydratedDocument<CoachPricingPlanDoc>,
  coachId: Types.ObjectId,
  athleteId: Types.ObjectId
): Promise<{ providerSubscriptionId: string; checkoutRef: string }> {
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
  if (!plan.razorpayPlanId && checkout.providerPlanId) {
    await CoachPricingPlan.updateOne({ _id: plan._id }, { $set: { razorpayPlanId: checkout.providerPlanId } });
  }
  return { providerSubscriptionId: checkout.providerSubscriptionId, checkoutRef: checkout.checkoutRef };
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
    const { providerSubscriptionId, checkoutRef } = await createProviderCheckout(plan, coachId, athleteId);
    subscription.providerSubscriptionId = providerSubscriptionId;
    await subscription.save();
    return { subscription, checkoutRef };
  } catch (err) {
    await AthleteCoachSubscription.deleteOne({ _id: subscription._id }).catch(() => undefined);
    throw err;
  }
}

/**
 * Starts a coach switch (Phase 12 — see CoachSwitchIntent's doc comment for
 * why this is a separate collection rather than a second pending
 * AthleteCoachSubscription row). The athlete's CURRENT relationship is not
 * touched at all here — only completeSwitchIntent, run from the webhook once
 * payment is verified, ends it.
 */
export async function initiateSwitchIntent(
  athleteId: Types.ObjectId,
  fromRelationshipId: Types.ObjectId,
  newCoachId: Types.ObjectId,
  newPricingPlanId: Types.ObjectId
): Promise<{ intent: HydratedDocument<CoachSwitchIntentDoc>; checkoutRef: string }> {
  const plan = await CoachPricingPlan.findOne({ _id: newPricingPlanId, coachId: newCoachId, active: true });
  if (!plan) throw new SubscriptionError(404, "pricing_plan_not_found");

  let intent: HydratedDocument<CoachSwitchIntentDoc>;
  try {
    intent = await CoachSwitchIntent.create({
      athleteId,
      fromRelationshipId,
      toCoachId: newCoachId,
      toPricingPlanId: plan._id,
      toPricingPlanSnapshot: pricingPlanSnapshotOf(plan),
      provider: "razorpay",
      status: "pending",
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      throw new SubscriptionError(409, "switch_already_in_progress");
    }
    throw err;
  }

  try {
    const { providerSubscriptionId, checkoutRef } = await createProviderCheckout(plan, newCoachId, athleteId);
    intent.providerSubscriptionId = providerSubscriptionId;
    await intent.save();
    return { intent, checkoutRef };
  } catch (err) {
    await CoachSwitchIntent.deleteOne({ _id: intent._id }).catch(() => undefined);
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

  // Only a RENEWAL (not the first-ever activation, which the athlete just
  // triggered themselves via checkout and can already see) is worth a push —
  // "where useful" per Phase 12 §3.
  if (!wasPending) {
    const coachName = await coachNameOf(subscription.coachId as Types.ObjectId);
    await notifyAthleteSubscriptionEvent(
      subscription,
      `renewed:${periodStart.toISOString().slice(0, 10)}`,
      "subscription_renewed",
      templates.buildSubscriptionRenewed({ coachName })
    );
  }
}

async function markPaymentDue(event: NormalizedPaymentEvent): Promise<void> {
  if (!event.providerSubscriptionId) return;
  const subscription = await AthleteCoachSubscription.findOne({
    providerSubscriptionId: event.providerSubscriptionId,
  });
  if (!subscription) return;

  const wasPending = subscription.status === "pending";
  subscription.status = wasPending ? "cancelled" : "payment_due";
  await subscription.save();
  await upsertPaymentFromEvent(subscription, event, "failed");

  // Only meaningful once there was something to fail payment ON (an
  // already-active subscription going payment_due) — a checkout that never
  // even activated isn't "your payment failed," it's just an abandoned signup.
  if (!wasPending) {
    await notifyAthleteSubscriptionEvent(
      subscription,
      `payment_failed:${event.providerPaymentId ?? new Date().toISOString().slice(0, 10)}`,
      "payment_failed",
      templates.buildPaymentFailed()
    );
  }
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

  if (status === "expired") {
    await notifyAthleteSubscriptionEvent(
      subscription,
      `expired:${subscription._id.toString()}`,
      "subscription_expired",
      templates.buildSubscriptionExpired()
    );
  } else {
    await notifyAthleteSubscriptionEvent(
      subscription,
      `cancelled:${subscription._id.toString()}`,
      "subscription_cancelled",
      templates.buildSubscriptionCancelled()
    );
  }
}

/**
 * Completes a pending coach switch once its new-coach payment is webhook-
 * verified: ends the OLD relationship (cancelling its subscription, its
 * still-open sessions, and its still-open workout/meal-plan assignments —
 * the exact same cleanup endRelationship does) and creates + activates the
 * NEW relationship/subscription, all inside one transaction so the athlete
 * is never observably coach-less between the two halves. If the old
 * relationship already ended some other way while this switch was in flight
 * (e.g. the athlete separately left that coach), that half is simply skipped
 * — idempotent, and the new coach still activates since payment for THEM
 * genuinely succeeded.
 */
async function completeSwitchIntent(
  intent: HydratedDocument<CoachSwitchIntentDoc>,
  event: NormalizedPaymentEvent
): Promise<void> {
  const periodStart = event.periodStart ?? new Date();
  const periodEnd = event.periodEnd ?? new Date(periodStart.getTime() + DEFAULT_PERIOD_MS);
  let oldRelationshipId: Types.ObjectId | null = null;
  let oldCoachId: Types.ObjectId | null = null;

  const newSubscription = await withOptionalTransaction(async (txnSession) => {
    const opts = txnSession ? { session: txnSession } : undefined;

    const oldRelationship = await CoachAthleteAssignment.findById(intent.fromRelationshipId).session(txnSession);
    if (oldRelationship && oldRelationship.status === "active") {
      if (oldRelationship.subscriptionId) {
        const oldSubscription = await AthleteCoachSubscription.findById(oldRelationship.subscriptionId).session(
          txnSession
        );
        if (oldSubscription) await terminateSubscriptionForEndedRelationship(oldSubscription, txnSession);
      }
      oldRelationship.status = "ended";
      oldRelationship.endedAt = new Date();
      oldRelationship.endedReason = "user_switched";
      await oldRelationship.save(opts);
      await cancelOpenCoachContentForRelationship(
        oldRelationship.coachId as Types.ObjectId,
        intent.athleteId,
        txnSession
      );
      oldRelationshipId = oldRelationship._id;
      oldCoachId = oldRelationship.coachId as Types.ObjectId;
    }

    const [createdSubscription] = await AthleteCoachSubscription.create(
      [
        {
          coachId: intent.toCoachId,
          athleteId: intent.athleteId,
          pricingPlanId: intent.toPricingPlanId,
          pricingPlanSnapshot: intent.toPricingPlanSnapshot,
          provider: intent.provider,
          providerSubscriptionId: event.providerSubscriptionId,
          status: "active",
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          nextBillingAt: periodEnd,
        },
      ],
      opts
    );

    const athleteProfile = await AthleteProfile.findById(intent.athleteId)
      .select("userId")
      .session(txnSession)
      .lean();

    const [newRelationship] = await CoachAthleteAssignment.create(
      [
        {
          coachId: intent.toCoachId,
          athleteId: intent.athleteId,
          assignedBy: (athleteProfile?.userId as Types.ObjectId | undefined) ?? intent.athleteId,
          endedAt: null,
          status: "active",
          subscriptionId: createdSubscription._id,
        },
      ],
      opts
    );
    createdSubscription.relationshipId = newRelationship._id;
    await createdSubscription.save(opts);

    intent.status = "completed";
    intent.resultingSubscriptionId = createdSubscription._id;
    await intent.save(opts);

    return createdSubscription;
  });

  await upsertPaymentFromEvent(newSubscription, event, "succeeded");

  // Session cancellation for the old relationship runs its own transaction
  // (see bookingConcurrency.ts) — same reasoning as endRelationship: Mongo
  // transactions can't nest, and this step is independently idempotent.
  if (oldRelationshipId) {
    await cancelOpenSessionsAndVideoRoomsForRelationship(
      oldRelationshipId,
      (newSubscription.relationshipId ?? intent.toCoachId) as Types.ObjectId,
      "Relationship ended (user_switched)"
    ).catch((err) => {
      console.warn("[subscription] session cleanup after switch failed (non-fatal)", {
        oldRelationshipId: (oldRelationshipId as Types.ObjectId).toString(),
        error: (err as Error).message,
      });
    });
  }

  if (oldCoachId) {
    await notifyCoachAthleteLeft(oldCoachId, intent.athleteId as Types.ObjectId, `switch:${intent._id.toString()}`);
  }
}

async function applySwitchPaymentEvent(
  intent: HydratedDocument<CoachSwitchIntentDoc>,
  event: NormalizedPaymentEvent
): Promise<void> {
  switch (event.eventType) {
    case "subscription.activated":
    case "subscription.charged":
      await completeSwitchIntent(intent, event);
      return;
    case "payment.failed":
      intent.status = "failed";
      intent.failureReason = "payment_failed";
      await intent.save();
      return;
    case "subscription.cancelled":
    case "subscription.completed":
      intent.status = "expired";
      intent.failureReason = event.eventType;
      await intent.save();
      return;
    default:
      return;
  }
}

/**
 * Dispatches an already-signature-verified, already-idempotency-claimed
 * webhook event. Never trust a client-asserted "payment succeeded" body —
 * this is only ever called from the webhook route after
 * provider.verifyWebhookSignature() has passed.
 *
 * Checks for a pending CoachSwitchIntent FIRST — a switch's new-coach
 * checkout is a genuinely new provider subscription id that no
 * AthleteCoachSubscription row was created for yet (see initiateSwitchIntent),
 * so the normal per-type handlers below (which all key off
 * AthleteCoachSubscription.providerSubscriptionId) would simply find nothing
 * and no-op for it.
 */
export async function applyPaymentEvent(event: NormalizedPaymentEvent): Promise<void> {
  if (event.providerSubscriptionId) {
    const intent = await CoachSwitchIntent.findOne({
      providerSubscriptionId: event.providerSubscriptionId,
      status: "pending",
    });
    if (intent) {
      await applySwitchPaymentEvent(intent, event);
      return;
    }
  }

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

/**
 * Hard/immediate cancel — used when the underlying relationship is ending
 * right now (Phase 10: coach removes an athlete, athlete leaves, or
 * switches coaches), unlike the athlete's own self-serve cancelSubscription
 * above (cancelAtPeriodEnd, access continues until the period ends).
 * Provider-side cancel is called with atCycleEnd=false so billing actually
 * stops immediately, matching "no relationship = no ongoing charge."
 */
export async function terminateSubscriptionForEndedRelationship(
  subscription: HydratedDocument<AthleteCoachSubscriptionDoc>,
  txnSession?: ClientSession | null
): Promise<void> {
  if (!NON_TERMINAL_STATUSES.includes(subscription.status as (typeof NON_TERMINAL_STATUSES)[number])) return;

  if (subscription.providerSubscriptionId) {
    const provider = getPaymentProvider();
    await provider.cancelSubscription(subscription.providerSubscriptionId, false).catch((err) => {
      console.warn("[subscription] provider cancel failed during relationship end (non-fatal)", {
        subscriptionId: subscription._id.toString(),
        error: (err as Error).message,
      });
    });
  }

  subscription.status = "cancelled";
  subscription.cancelledAt = new Date();
  await subscription.save(txnSession ? { session: txnSession } : undefined);
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
type EntitlementResult = { allowed: true } | { allowed: false; reason: string };

/**
 * Shared lookup: resolves the linked subscription (if any) for an active
 * relationship. Returns `null` when there is no linked subscription at all
 * — the caller's signal to treat the relationship as unpaywalled.
 */
async function loadLinkedSubscription(
  athleteId: Types.ObjectId,
  coachId: Types.ObjectId
): Promise<Pick<AthleteCoachSubscriptionDoc, "status" | "pricingPlanSnapshot"> | null> {
  const relationship = await CoachAthleteAssignment.findOne({ athleteId, coachId, status: "active" })
    .select("subscriptionId")
    .lean();
  if (!relationship?.subscriptionId) return null;

  const subscription = await AthleteCoachSubscription.findById(relationship.subscriptionId)
    .select("status pricingPlanSnapshot")
    .lean();
  return subscription;
}

export async function checkFeatureEntitlement(
  athleteId: Types.ObjectId,
  coachId: Types.ObjectId,
  feature: "workoutPlanningIncluded" | "nutritionIncluded"
): Promise<EntitlementResult> {
  const subscription = await loadLinkedSubscription(athleteId, coachId);
  if (!subscription) return { allowed: true };

  if (!["active", "payment_due"].includes(subscription.status)) {
    return { allowed: false, reason: "subscription_not_active" };
  }
  if (!subscription.pricingPlanSnapshot?.[feature]) {
    return { allowed: false, reason: "feature_not_included_in_plan" };
  }
  return { allowed: true };
}

export type SessionQuota = { includedSessions: number; usedSessions: number; remainingSessions: number };
export type SessionEntitlementResult =
  | { allowed: true; quota: SessionQuota | null }
  | { allowed: false; reason: string; quota?: SessionQuota };

/**
 * Statuses that consume a subscriber's liveSessionsPerCycle allowance for the
 * billing period they fall in (Phase 12 — product decision, confirmed
 * explicitly rather than guessed): a session the athlete actually got —
 * `confirmed` (booked and honored by the coach) or `completed` — counts, and
 * so does a `missed` no-show (the coach's time was reserved and spent; a
 * no-show shouldn't hand back a free session). `requested` (not yet
 * confirmed by the coach) does NOT count yet — only once the coach commits to
 * it. `cancelled` never counts, regardless of who cancelled — cancelling in
 * advance returns the slot to the athlete's allowance, and the coach's own
 * cancellations were never the athlete's usage to begin with.
 * `rescheduled` is included defensively (bookingConcurrency.ts's actual
 * reschedule path currently re-lands a session on `confirmed`, not
 * `rescheduled`, but the enum value exists and should count the same way if
 * ever used) — it's still a session that will happen, just at a new time.
 */
const QUOTA_COUNTED_STATUSES: CoachSessionStatus[] = ["confirmed", "rescheduled", "completed", "missed"];

async function countQuotaConsumingSessions(
  coachId: Types.ObjectId,
  athleteId: Types.ObjectId,
  periodStart: Date,
  periodEnd: Date
): Promise<number> {
  return CoachSession.countDocuments({
    coachId,
    athleteId,
    status: { $in: QUOTA_COUNTED_STATUSES },
    scheduledStart: { $gte: periodStart, $lt: periodEnd },
  });
}

/**
 * Gates + meters live-session booking (Phase 7 gate, Phase 12 metering) —
 * same "unpaywalled if no linked subscription" convention as
 * checkFeatureEntitlement, but additionally counts sessions already consumed
 * within the subscription's CURRENT billing cycle
 * (currentPeriodStart/currentPeriodEnd) against
 * pricingPlanSnapshot.liveSessionsPerCycle, deriving the count live from
 * CoachSession rather than persisting/incrementing a counter (same
 * "derive, don't persist" convention as isVideoVisible/isExpiringSoon
 * elsewhere in this plan) — so it can never drift out of sync with the
 * sessions that actually exist.
 */
export async function checkSessionBookingEntitlement(
  athleteId: Types.ObjectId,
  coachId: Types.ObjectId
): Promise<SessionEntitlementResult> {
  const relationship = await CoachAthleteAssignment.findOne({ athleteId, coachId, status: "active" })
    .select("subscriptionId")
    .lean();
  if (!relationship?.subscriptionId) return { allowed: true, quota: null };

  const subscription = await AthleteCoachSubscription.findById(relationship.subscriptionId)
    .select("status pricingPlanSnapshot currentPeriodStart currentPeriodEnd")
    .lean();
  if (!subscription) return { allowed: true, quota: null };

  if (!["active", "payment_due"].includes(subscription.status)) {
    return { allowed: false, reason: "subscription_not_active" };
  }
  const includedSessions = subscription.pricingPlanSnapshot?.liveSessionsPerCycle ?? 0;
  if (!includedSessions) {
    return { allowed: false, reason: "live_sessions_not_included_in_plan" };
  }

  const periodStart = (subscription.currentPeriodStart as Date | null) ?? new Date(0);
  const periodEnd = (subscription.currentPeriodEnd as Date | null) ?? new Date(8_640_000_000_000_000);
  const usedSessions = await countQuotaConsumingSessions(coachId, athleteId, periodStart, periodEnd);
  const remainingSessions = Math.max(includedSessions - usedSessions, 0);
  const quota: SessionQuota = { includedSessions, usedSessions, remainingSessions };

  if (remainingSessions <= 0) {
    return { allowed: false, reason: "session_allowance_exhausted", quota };
  }
  return { allowed: true, quota };
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
