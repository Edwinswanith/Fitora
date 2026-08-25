import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/role";
import { writeRateLimit } from "../middleware/rateLimit";
import { loadScope, requireAthleteAccess } from "../middleware/coachAthleteAccess";
import { CoachAthleteAssignment } from "../models/CoachAthleteAssignment";
import { endRelationship, CoachRelationshipError } from "../services/coachRelationship";

const router = Router();
router.use(requireAuth, requireRole("coach"), loadScope);

/** POST /athletes/:athleteId/end-relationship — coach removes an athlete from their roster; any active subscription is cancelled immediately. */
router.post(
  "/athletes/:athleteId/end-relationship",
  writeRateLimit({ windowMs: 60_000, max: 20 }),
  requireAthleteAccess("athleteId"),
  async (req: Request, res: Response) => {
    const relationship = await CoachAthleteAssignment.findOne({
      coachId: req.actor!.userId,
      athleteId: req.params.athleteId,
      status: "active",
    });
    if (!relationship) return void res.status(404).json({ error: "relationship_not_found" });

    try {
      const ended = await endRelationship(relationship, "coach_ended", req.actor!.userId);
      res.json({ relationship: { id: ended._id.toString(), status: ended.status, endedAt: ended.endedAt, endedReason: ended.endedReason } });
    } catch (err) {
      if (err instanceof CoachRelationshipError) return void res.status(err.status).json({ error: err.message });
      throw err;
    }
  }
);

export default router;
