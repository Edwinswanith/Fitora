import { Types, type HydratedDocument } from "mongoose";
import { CoachReview, type CoachReviewDoc, REVIEW_SUB_RATING_KEYS } from "../models/CoachReview";
import { CoachAthleteAssignment, type CoachAthleteAssignmentDoc } from "../models/CoachAthleteAssignment";
import { CoachProfile } from "../models/CoachProfile";

export class CoachReviewError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type SubRatingsInput = Partial<Record<(typeof REVIEW_SUB_RATING_KEYS)[number], number>>;

function validateOverallRating(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 5) throw new CoachReviewError(400, "invalid_overallRating");
  return n;
}

function validateSubRatings(v: unknown): SubRatingsInput {
  if (v === undefined) return {};
  if (typeof v !== "object" || v === null) throw new CoachReviewError(400, "invalid_subRatings");
  const out: SubRatingsInput = {};
  for (const [key, value] of Object.entries(v as Record<string, unknown>)) {
    if (!REVIEW_SUB_RATING_KEYS.includes(key as never)) continue;
    if (value === null || value === undefined) continue;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 5) throw new CoachReviewError(400, `invalid_subRatings.${key}`);
    out[key as keyof SubRatingsInput] = n;
  }
  return out;
}

function validateBody(v: unknown): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "string") throw new CoachReviewError(400, "invalid_body");
  const trimmed = v.trim();
  if (trimmed.length > 2000) throw new CoachReviewError(400, "invalid_body");
  return trimmed || undefined;
}

/**
 * Recomputes CoachProfile.avgRating/reviewCount from the CoachReview
 * collection itself — the only source of truth. Never accepts a
 * client-supplied aggregate; this is the sole write path for those two
 * fields. Upserts the profile (a coach who has never opened their profile
 * page yet may not have a CoachProfile document at all — same lazy-creation
 * pattern as GET /coach/profile in Phase 5).
 */
export async function recomputeCoachRatingAggregate(coachId: Types.ObjectId): Promise<void> {
  const [agg] = await CoachReview.aggregate([
    { $match: { coachId } },
    { $group: { _id: null, avgRating: { $avg: "$overallRating" }, reviewCount: { $sum: 1 } } },
  ]);
  await CoachProfile.findOneAndUpdate(
    { userId: coachId },
    { $set: { avgRating: agg ? Math.round(agg.avgRating * 10) / 10 : null, reviewCount: agg ? agg.reviewCount : 0 } },
    { upsert: true }
  );
}

/**
 * Eligibility: the relationship must belong to this athlete and have
 * ENDED — reviewing mid-relationship is not allowed (confirmed product
 * decision for V1). Any endedReason qualifies (coach_ended, athlete_left,
 * user_switched, subscription_cancelled/expired all count as "this stint
 * of coaching is over").
 */
export async function createReview(
  relationship: HydratedDocument<CoachAthleteAssignmentDoc>,
  athleteId: Types.ObjectId,
  input: { overallRating: unknown; subRatings?: unknown; body?: unknown }
): Promise<HydratedDocument<CoachReviewDoc>> {
  if (!relationship.athleteId.equals(athleteId)) throw new CoachReviewError(403, "not_your_relationship");
  if (relationship.status !== "ended") throw new CoachReviewError(409, "relationship_not_ended");

  const overallRating = validateOverallRating(input.overallRating);
  const subRatings = validateSubRatings(input.subRatings);
  const body = validateBody(input.body);

  let review: HydratedDocument<CoachReviewDoc>;
  try {
    review = await CoachReview.create({
      relationshipId: relationship._id,
      coachId: relationship.coachId,
      athleteId,
      overallRating,
      subRatings,
      body,
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw new CoachReviewError(409, "already_reviewed");
    throw err;
  }

  await recomputeCoachRatingAggregate(relationship.coachId as Types.ObjectId);
  return review;
}

export async function updateReview(
  review: HydratedDocument<CoachReviewDoc>,
  athleteId: Types.ObjectId,
  input: { overallRating?: unknown; subRatings?: unknown; body?: unknown }
): Promise<HydratedDocument<CoachReviewDoc>> {
  if (!review.athleteId.equals(athleteId)) throw new CoachReviewError(403, "not_your_review");

  if (input.overallRating !== undefined) review.overallRating = validateOverallRating(input.overallRating);
  if (input.subRatings !== undefined) review.subRatings = validateSubRatings(input.subRatings) as never;
  if (input.body !== undefined) review.body = validateBody(input.body);
  review.editedAt = new Date();

  await review.save();
  await recomputeCoachRatingAggregate(review.coachId as Types.ObjectId);
  return review;
}

export function serializeReview(review: CoachReviewDoc | HydratedDocument<CoachReviewDoc>) {
  return {
    id: review._id.toString(),
    relationshipId: (review.relationshipId as Types.ObjectId).toString(),
    coachId: (review.coachId as Types.ObjectId).toString(),
    athleteId: (review.athleteId as Types.ObjectId).toString(),
    overallRating: review.overallRating,
    subRatings: review.subRatings,
    body: review.body ?? null,
    editedAt: review.editedAt ?? null,
    createdAt: review.createdAt,
  };
}
