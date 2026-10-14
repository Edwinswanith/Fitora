import type { Types } from "mongoose";
import { CoachAthleteAssignment } from "../models/CoachAthleteAssignment";

/**
 * When this coach's current relationship with each athlete began. Content the
 * athlete addressed to "my coach" (notes) before that belongs to whoever was
 * coaching them then, so a coach who inherits an athlete only sees what was
 * written since they took over.
 */
export async function relationshipStarts(
  coachId: Types.ObjectId,
  athleteIds: Types.ObjectId[]
): Promise<Map<string, Date>> {
  if (!athleteIds.length) return new Map();
  const rows = await CoachAthleteAssignment.find({ coachId, athleteId: { $in: athleteIds }, status: "active" })
    .select("athleteId assignedAt createdAt")
    .lean();
  return new Map(
    rows.map((r) => [String(r.athleteId), new Date((r.assignedAt ?? r.createdAt) as Date)])
  );
}
