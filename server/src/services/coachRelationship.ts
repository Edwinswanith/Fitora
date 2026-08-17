import { Types, type HydratedDocument } from "mongoose";
import { CoachAthleteAssignment, type CoachAthleteAssignmentDoc, type CoachRelationshipEndedReason } from "../models/CoachAthleteAssignment";
import { AthleteCoachSubscription } from "../models/AthleteCoachSubscription";
import { terminateSubscriptionForEndedRelationship, initiateSubscription } from "./subscription";

export class CoachRelationshipError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Ends an active relationship. If it has a linked non-terminal subscription,
 * that's cancelled immediately too (not just cancelAtPeriodEnd) — access is
 * ending right now, so billing shouldn't continue into a period the athlete
 * can no longer use.
 */
export async function endRelationship(
  relationship: HydratedDocument<CoachAthleteAssignmentDoc>,
  endedReason: CoachRelationshipEndedReason
): Promise<HydratedDocument<CoachAthleteAssignmentDoc>> {
  if (relationship.status !== "active") throw new CoachRelationshipError(409, "relationship_not_active");

  if (relationship.subscriptionId) {
    const subscription = await AthleteCoachSubscription.findById(relationship.subscriptionId);
    if (subscription) await terminateSubscriptionForEndedRelationship(subscription);
  }

  relationship.status = "ended";
  relationship.endedAt = new Date();
  relationship.endedReason = endedReason;
  await relationship.save();
  return relationship;
}

/**
 * Ends the athlete's current active relationship (if any) and starts
 * checkout with a new coach. Sequential, not a hard Mongo transaction —
 * matches this codebase's general convention of reserving real transactions
 * for the one genuinely concurrency-critical case (booking, see
 * services/bookingConcurrency.ts). Ending the old relationship always
 * succeeds independently of whether the new checkout does, so a failed
 * new-checkout attempt never leaves the athlete stuck unable to leave a
 * coach they just tried to switch away from.
 */
export async function switchCoach(
  athleteId: Types.ObjectId,
  newCoachId: Types.ObjectId,
  newPricingPlanId: Types.ObjectId
) {
  const current = await CoachAthleteAssignment.findOne({ athleteId, status: "active" });
  if (current) {
    if (current.coachId.equals(newCoachId)) throw new CoachRelationshipError(409, "already_your_coach");
    await endRelationship(current, "user_switched");
  }
  return initiateSubscription(athleteId, newCoachId, newPricingPlanId);
}
