import { Router, type Request, type Response } from "express";
import { Types } from "mongoose";
import { requireAuth } from "../middleware/auth";
import { User } from "../models/User";
import { CoachProfile } from "../models/CoachProfile";
import { CoachPricingPlan } from "../models/CoachPricingPlan";
import { CoachReview } from "../models/CoachReview";
import { listMarketplaceCoaches, serializePublicCoachProfile, loadAvailableDays } from "../services/coachProfile";
import { avatarFilePath } from "../services/avatar";
import { serializeReview } from "../services/coachReview";

/**
 * Coach discovery — available to ANY authenticated User regardless of role
 * or existing coach relationship (browsing coaches never requires already
 * having one). Every response here is built from an explicit field
 * allowlist (services/coachProfile.ts's serializers), never a raw document
 * spread, so a private User/CoachProfile field can never leak by accident.
 */
const router = Router();
router.use(requireAuth);

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

/**
 * GET /marketplace/coaches?specialization=&coachingType=&language=
 *   &minExperience=&maxPrice=&minRating=&nutritionSupport=&page=&limit=
 */
router.get("/coaches", async (req: Request, res: Response) => {
  const q = req.query;
  const filters = {
    specialization: typeof q.specialization === "string" ? q.specialization : undefined,
    coachingType: typeof q.coachingType === "string" ? q.coachingType : undefined,
    language: typeof q.language === "string" ? q.language : undefined,
    minExperience: q.minExperience !== undefined ? clampInt(q.minExperience, 0, 60, 0) : undefined,
    maxPrice: q.maxPrice !== undefined ? Math.max(0, Number(q.maxPrice) || 0) : undefined,
    minRating: q.minRating !== undefined ? Math.max(0, Math.min(5, Number(q.minRating) || 0)) : undefined,
    nutritionSupport: q.nutritionSupport === "true" ? true : q.nutritionSupport === "false" ? false : undefined,
    page: clampInt(q.page, 1, 10_000, 1),
    limit: clampInt(q.limit, 1, 50, 20),
  };
  const result = await listMarketplaceCoaches(filters);
  res.json(result);
});

/** GET /marketplace/coaches/:coachId — full public profile + active pricing plans. */
router.get("/coaches/:coachId", async (req: Request, res: Response) => {
  const coachId = req.params.coachId;
  if (!Types.ObjectId.isValid(coachId)) return void res.status(400).json({ error: "invalid_coach_id" });

  const [profile, user] = await Promise.all([
    CoachProfile.findOne({ userId: coachId, active: true }).lean(),
    User.findById(coachId).select("name role avatarKind avatarDefaultId").lean(),
  ]);
  // Uniform 404 whether the id isn't a coach, has no profile yet, or simply
  // hasn't opted into marketplace visibility — never distinguishable.
  if (!profile || !user || user.role !== "coach") {
    res.status(404).json({ error: "coach_not_found" });
    return;
  }

  const coachObjectId = new Types.ObjectId(coachId);
  const [pricingPlans, availableDays] = await Promise.all([
    CoachPricingPlan.find({ coachId, active: true }).sort({ priority: 1 }).lean(),
    loadAvailableDays(coachObjectId),
  ]);
  res.json({ profile: serializePublicCoachProfile(coachObjectId, profile as never, user, pricingPlans as never, availableDays) });
});

/** GET /marketplace/coaches/:coachId/reviews?page=&limit= — public, paginated, newest first. */
router.get("/coaches/:coachId/reviews", async (req: Request, res: Response) => {
  const coachId = req.params.coachId;
  if (!Types.ObjectId.isValid(coachId)) return void res.status(400).json({ error: "invalid_coach_id" });

  const page = clampInt(req.query.page, 1, 10_000, 1);
  const limit = clampInt(req.query.limit, 1, 50, 20);
  const [reviews, total] = await Promise.all([
    CoachReview.find({ coachId })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    CoachReview.countDocuments({ coachId }),
  ]);
  res.json({ reviews: reviews.map((r) => serializeReview(r as never)), page, limit, total });
});

/** GET /marketplace/coaches/:coachId/avatar/file — only for marketplace-visible coaches. */
router.get("/coaches/:coachId/avatar/file", async (req: Request, res: Response) => {
  const coachId = req.params.coachId;
  if (!Types.ObjectId.isValid(coachId)) return void res.status(400).json({ error: "invalid_coach_id" });

  const [profile, user] = await Promise.all([
    CoachProfile.exists({ userId: coachId, active: true }),
    User.findById(coachId).select("role avatarKind avatarStoredFilename avatarMimeType").lean(),
  ]);
  if (!profile || !user || user.role !== "coach" || user.avatarKind !== "photo" || !user.avatarStoredFilename) {
    res.status(404).json({ error: "no_avatar_photo" });
    return;
  }
  const filePath = avatarFilePath(user);
  res.type(user.avatarMimeType ?? "image/jpeg");
  res.setHeader("Cache-Control", "private, max-age=0, no-store");
  res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: "file_missing" });
  });
});

export default router;
