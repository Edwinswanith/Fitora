import { Router, type Request, type Response } from "express";
import { Types } from "mongoose";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/role";
import { writeRateLimit } from "../middleware/rateLimit";
import { loadScope } from "../middleware/coachAthleteAccess";
import { CoachAthleteAssignment } from "../models/CoachAthleteAssignment";
import { CoachReview } from "../models/CoachReview";
import { createReview, updateReview, serializeReview, CoachReviewError } from "../services/coachReview";

const router = Router();
router.use(requireAuth, requireRole("athlete"), loadScope);

function selfAthleteId(req: Request): Types.ObjectId | null {
  return req.actor?.athleteProfileId ?? null;
}

/** POST /coach-reviews — body: { relationshipId, overallRating, subRatings?, body? }. Only eligible once the relationship has ended. */
router.post("/coach-reviews", writeRateLimit({ windowMs: 60_000, max: 10 }), async (req: Request, res: Response) => {
  const athleteId = selfAthleteId(req);
  if (!athleteId) return void res.status(404).json({ error: "athlete_profile_not_found" });

  const relationshipId = req.body?.relationshipId;
  if (typeof relationshipId !== "string" || !Types.ObjectId.isValid(relationshipId)) {
    return void res.status(400).json({ error: "invalid_relationshipId" });
  }
  const relationship = await CoachAthleteAssignment.findById(relationshipId);
  if (!relationship) return void res.status(404).json({ error: "relationship_not_found" });

  try {
    const review = await createReview(relationship, athleteId, {
      overallRating: req.body?.overallRating,
      subRatings: req.body?.subRatings,
      body: req.body?.body,
    });
    res.status(201).json({ review: serializeReview(review) });
  } catch (err) {
    if (err instanceof CoachReviewError) return void res.status(err.status).json({ error: err.message });
    throw err;
  }
});

/** PATCH /coach-reviews/:id — edit-in-place; no delete endpoint exists, so a review can never be re-created after removal. */
router.patch("/coach-reviews/:reviewId", writeRateLimit({ windowMs: 60_000, max: 20 }), async (req: Request, res: Response) => {
  const athleteId = selfAthleteId(req);
  if (!athleteId) return void res.status(404).json({ error: "athlete_profile_not_found" });

  const id = req.params.reviewId;
  if (!Types.ObjectId.isValid(id)) return void res.status(400).json({ error: "invalid_review_id" });
  const review = await CoachReview.findById(id);
  if (!review) return void res.status(404).json({ error: "review_not_found" });

  try {
    const updated = await updateReview(review, athleteId, {
      overallRating: req.body?.overallRating,
      subRatings: req.body?.subRatings,
      body: req.body?.body,
    });
    res.json({ review: serializeReview(updated) });
  } catch (err) {
    if (err instanceof CoachReviewError) return void res.status(err.status).json({ error: err.message });
    throw err;
  }
});

export default router;
