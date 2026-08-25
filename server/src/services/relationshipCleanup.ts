import { Types, type ClientSession } from "mongoose";
import { WorkoutAssignment } from "../models/WorkoutAssignment";
import { MealPlanAssignment } from "../models/MealPlanAssignment";

/**
 * Cancels a coach's still-open future/uncompleted plans for one athlete so
 * they don't silently keep acting as "the current plan" forever after the
 * relationship that authorized them ends (Phase 12 §16 — used by both a
 * direct end-relationship and a completed coach switch, hence its own module:
 * services/coachRelationship.ts and services/subscription.ts both need it,
 * and importing one from the other would be circular). Historical/completed
 * content is never touched — only WorkoutAssignment rows still `scheduled`
 * (not `in_progress`, so an athlete mid-session isn't yanked out from under
 * themselves) get flipped to `skipped` (the closest existing status to
 * "withdrawn" — the schema has no dedicated `cancelled` value), and only
 * `active` MealPlanAssignment rows get flipped to their real `cancelled`
 * status. Neither deletes anything, and MealPlanAssignment cancellation
 * deliberately never touches the PlannedMeal rows it already created (see
 * MealPlanAssignment's own doc comment) — those stay as the historical
 * record of what was actually planned.
 */
export async function cancelOpenCoachContentForRelationship(
  coachId: Types.ObjectId,
  athleteId: Types.ObjectId,
  txnSession: ClientSession | null
): Promise<void> {
  const opts = txnSession ? { session: txnSession } : undefined;
  await WorkoutAssignment.updateMany(
    { assignedBy: coachId, assignedTo: athleteId, status: "scheduled" },
    { $set: { status: "skipped" } },
    opts
  );
  await MealPlanAssignment.updateMany(
    { assignedBy: coachId, assignedTo: athleteId, status: "active" },
    { $set: { status: "cancelled", cancelledAt: new Date() } },
    opts
  );
}
