import { Router, type Request, type Response } from "express";
import { Types } from "mongoose";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/role";
import { writeRateLimit } from "../middleware/rateLimit";
import { loadScope } from "../middleware/coachAthleteAccess";
import { CoachAthleteAssignment } from "../models/CoachAthleteAssignment";
import { endRelationship, switchCoach, CoachRelationshipError } from "../services/coachRelationship";
import { SubscriptionError, serializeSubscription } from "../services/subscription";

const router = Router();
router.use(requireAuth, requireRole("athlete"), loadScope);

function selfAthleteId(req: Request): Types.ObjectId | null {
  return req.actor?.athleteProfileId ?? null;
}

/** POST /coach/leave — athlete ends their own current coach relationship (no immediate switch). Any active subscription is cancelled immediately. */
router.post("/coach/leave", writeRateLimit({ windowMs: 60_000, max: 10 }), async (req: Request, res: Response) => {
  const athleteId = selfAthleteId(req);
  if (!athleteId) return void res.status(404).json({ error: "athlete_profile_not_found" });

  const relationship = await CoachAthleteAssignment.findOne({ athleteId, status: "active" });
  if (!relationship) return void res.status(404).json({ error: "no_active_coach" });

  try {
    const ended = await endRelationship(relationship, "athlete_left");
    res.json({ relationship: { id: ended._id.toString(), status: ended.status, endedAt: ended.endedAt, endedReason: ended.endedReason } });
  } catch (err) {
    if (err instanceof CoachRelationshipError) return void res.status(err.status).json({ error: err.message });
    throw err;
  }
});

/** POST /coach-switch — body: { newCoachId, newPricingPlanId }. Ends any current relationship, then starts checkout with the new coach. */
router.post("/coach-switch", writeRateLimit({ windowMs: 60_000, max: 10 }), async (req: Request, res: Response) => {
  const athleteId = selfAthleteId(req);
  if (!athleteId) return void res.status(404).json({ error: "athlete_profile_not_found" });

  const newCoachId = req.body?.newCoachId;
  const newPricingPlanId = req.body?.newPricingPlanId;
  if (typeof newCoachId !== "string" || !Types.ObjectId.isValid(newCoachId)) {
    return void res.status(400).json({ error: "invalid_newCoachId" });
  }
  if (typeof newPricingPlanId !== "string" || !Types.ObjectId.isValid(newPricingPlanId)) {
    return void res.status(400).json({ error: "invalid_newPricingPlanId" });
  }

  try {
    const { subscription, checkoutRef } = await switchCoach(athleteId, new Types.ObjectId(newCoachId), new Types.ObjectId(newPricingPlanId));
    res.status(201).json({ subscription: serializeSubscription(subscription), checkoutRef });
  } catch (err) {
    if (err instanceof CoachRelationshipError || err instanceof SubscriptionError) {
      return void res.status(err.status).json({ error: err.message });
    }
    throw err;
  }
});

export default router;
