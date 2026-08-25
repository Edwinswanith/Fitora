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
    const ended = await endRelationship(relationship, "athlete_left", req.actor!.userId);
    res.json({ relationship: { id: ended._id.toString(), status: ended.status, endedAt: ended.endedAt, endedReason: ended.endedReason } });
  } catch (err) {
    if (err instanceof CoachRelationshipError) return void res.status(err.status).json({ error: err.message });
    throw err;
  }
});

/**
 * POST /coach-switch — body: { newCoachId, newPricingPlanId }. Starts
 * checkout with the new coach WITHOUT touching the current relationship — it
 * only ends, atomically with the new one activating, once the new coach's
 * payment is webhook-verified (services/subscription.ts completeSwitchIntent).
 * If the athlete has no current coach at all, this degrades to a plain
 * subscribe (kind: "subscribe") since there's nothing to protect.
 */
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
    const result = await switchCoach(athleteId, new Types.ObjectId(newCoachId), new Types.ObjectId(newPricingPlanId));
    if (result.kind === "subscribe") {
      res.status(201).json({ kind: "subscribe", subscription: serializeSubscription(result.subscription), checkoutRef: result.checkoutRef });
      return;
    }
    res.status(201).json({
      kind: "switch",
      switchIntentId: result.intent._id.toString(),
      checkoutRef: result.checkoutRef,
    });
  } catch (err) {
    if (err instanceof CoachRelationshipError || err instanceof SubscriptionError) {
      return void res.status(err.status).json({ error: err.message });
    }
    throw err;
  }
});

export default router;
