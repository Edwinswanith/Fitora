import { Types, type HydratedDocument } from "mongoose";
import { CoachAthleteAssignment, type CoachAthleteAssignmentDoc, type CoachRelationshipEndedReason } from "../models/CoachAthleteAssignment";
import { AthleteCoachSubscription } from "../models/AthleteCoachSubscription";
import { AthleteProfile } from "../models/AthleteProfile";
import { User } from "../models/User";
import { withOptionalTransaction, cancelOpenSessionsAndVideoRoomsForRelationship } from "./bookingConcurrency";
import { cancelOpenCoachContentForRelationship } from "./relationshipCleanup";
import { terminateSubscriptionForEndedRelationship, initiateSubscription, initiateSwitchIntent } from "./subscription";
import { evaluateAndDispatch } from "./notificationEligibility";
import { resolveTimezoneForUser } from "./timezone";
import { categoryForType } from "../lib/notificationTypes";
import { buildCoachRelationshipEndedForAthlete, buildAthleteLeftForCoach } from "./notificationTemplates";

/**
 * Best-effort, both-directions notification for a relationship ending —
 * previously missing entirely (confirmed during the Phase 12 validation
 * pass: zero NotificationDecision rows were created for either party on a
 * real end-relationship action). Never lets a notification failure fail the
 * relationship-ending write that triggered it.
 */
async function notifyRelationshipEnded(
  relationship: Pick<CoachAthleteAssignmentDoc, "_id" | "coachId" | "athleteId">,
  initiatedByCoach: boolean
): Promise<void> {
  try {
    const [athleteProfile, coachUser] = await Promise.all([
      AthleteProfile.findById(relationship.athleteId).select("userId").lean(),
      User.findById(relationship.coachId as Types.ObjectId).select("name").lean(),
    ]);
    const coachName = (coachUser?.name as string) || "your coach";
    if (athleteProfile?.userId) {
      const athleteUserId = athleteProfile.userId as Types.ObjectId;
      const timezone = await resolveTimezoneForUser({ userId: athleteUserId, role: "athlete" });
      await evaluateAndDispatch({
        userId: athleteUserId,
        type: "subscription_cancelled",
        category: categoryForType("subscription_cancelled"),
        priorityTier: 2,
        dedupKey: `relationship_ended:${relationship._id.toString()}:athlete`,
        timezone,
        entityRef: { collection: "CoachAthleteAssignment", id: relationship._id as Types.ObjectId },
        ...buildCoachRelationshipEndedForAthlete({ coachName, initiatedByCoach }),
      });
    }

    const athleteUser = athleteProfile?.userId
      ? await User.findById(athleteProfile.userId).select("name").lean()
      : null;
    const timezone = await resolveTimezoneForUser({ userId: relationship.coachId as Types.ObjectId, role: "coach" });
    await evaluateAndDispatch({
      userId: relationship.coachId as Types.ObjectId,
      type: "coach_athlete_left",
      category: categoryForType("coach_athlete_left"),
      priorityTier: 3,
      dedupKey: `relationship_ended:${relationship._id.toString()}:coach`,
      timezone,
      entityRef: { collection: "CoachAthleteAssignment", id: relationship._id as Types.ObjectId },
      ...buildAthleteLeftForCoach({ athleteName: (athleteUser?.name as string) || "An athlete", initiatedByCoach }),
    });
  } catch (err) {
    console.error("[coachRelationship] notification dispatch failed (non-fatal)", (err as Error).message);
  }
}

export class CoachRelationshipError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Ends an active relationship and cascades cleanup atomically (or via the
 * sequential dev-only fallback on a non-replica-set mongod — see
 * withOptionalTransaction): cancels a linked non-terminal subscription
 * immediately (not just cancelAtPeriodEnd — access is ending right now, so
 * billing shouldn't continue into a period the athlete can no longer use),
 * cancels every still-open CoachSession between the pair and releases their
 * slot locks (Phase 12 §6 — previously left dangling, blocking the coach's
 * real availability), and withdraws the ended coach's still-open
 * workout/meal-plan assignments (§16). `actorId` attributes the resulting
 * session-cancellation events. CoachVideo access needs no cleanup call here —
 * it's re-derived live from relationship status on every request (see
 * services/coachVideo.ts), so it's already cut off the instant `status`
 * flips to "ended".
 */
export async function endRelationship(
  relationship: HydratedDocument<CoachAthleteAssignmentDoc>,
  endedReason: CoachRelationshipEndedReason,
  actorId: Types.ObjectId
): Promise<HydratedDocument<CoachAthleteAssignmentDoc>> {
  if (relationship.status !== "active") throw new CoachRelationshipError(409, "relationship_not_active");

  await withOptionalTransaction(async (txnSession) => {
    if (relationship.subscriptionId) {
      const subscription = await AthleteCoachSubscription.findById(relationship.subscriptionId).session(txnSession);
      if (subscription) await terminateSubscriptionForEndedRelationship(subscription, txnSession);
    }

    relationship.status = "ended";
    relationship.endedAt = new Date();
    relationship.endedReason = endedReason;
    await relationship.save(txnSession ? { session: txnSession } : undefined);

    await cancelOpenCoachContentForRelationship(
      relationship.coachId as Types.ObjectId,
      relationship.athleteId as Types.ObjectId,
      txnSession
    );
  });

  // Session cancellation runs its own withOptionalTransaction internally
  // (see bookingConcurrency.ts) — kept outside the relationship's own
  // transaction rather than nested inside it, since Mongo transactions
  // cannot nest, and it's still safe to run right after: if this step were
  // ever interrupted, endRelationship is re-runnable in spirit (the
  // relationship is already "ended", and re-invoking the session cleanup
  // directly is idempotent — see cancelOpenSessionsForRelationship's own
  // idempotency note).
  await cancelOpenSessionsAndVideoRoomsForRelationship(relationship._id, actorId, `Relationship ended (${endedReason})`);

  await notifyRelationshipEnded(relationship, endedReason === "coach_ended");

  return relationship;
}

/**
 * Starts a coach switch WITHOUT touching the athlete's current relationship —
 * see services/subscription.ts's initiateSwitchIntent/completeSwitchIntent
 * for the full state machine. The old relationship only ends, atomically
 * together with the new one activating, once the new coach's payment is
 * webhook-verified. A failed or abandoned checkout leaves the athlete exactly
 * where they started: still coached by their current coach.
 *
 * If the athlete has no current active coach at all, there's nothing to
 * protect — this degrades to a plain subscribe (initiateSubscription),
 * same as before Phase 12's switch-safety rework.
 */
export async function switchCoach(
  athleteId: Types.ObjectId,
  newCoachId: Types.ObjectId,
  newPricingPlanId: Types.ObjectId
): Promise<
  | { kind: "switch"; intent: Awaited<ReturnType<typeof initiateSwitchIntent>>["intent"]; checkoutRef: string }
  | { kind: "subscribe"; subscription: Awaited<ReturnType<typeof initiateSubscription>>["subscription"]; checkoutRef: string }
> {
  const current = await CoachAthleteAssignment.findOne({ athleteId, status: "active" });
  if (!current) {
    const { subscription, checkoutRef } = await initiateSubscription(athleteId, newCoachId, newPricingPlanId);
    return { kind: "subscribe", subscription, checkoutRef };
  }
  if (current.coachId.equals(newCoachId)) throw new CoachRelationshipError(409, "already_your_coach");
  const { intent, checkoutRef } = await initiateSwitchIntent(athleteId, current._id, newCoachId, newPricingPlanId);
  return { kind: "switch", intent, checkoutRef };
}
