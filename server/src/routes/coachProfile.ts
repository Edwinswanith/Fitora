import { Router, type Request, type Response } from "express";
import { Types, type HydratedDocument } from "mongoose";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/role";
import { writeRateLimit } from "../middleware/rateLimit";
import { User } from "../models/User";
import { CoachPricingPlan, type CoachPricingPlanDoc } from "../models/CoachPricingPlan";
import { getOrCreateCoachProfile, serializeOwnCoachProfile, serializePricingPlan } from "../services/coachProfile";

const router = Router();
router.use(requireAuth, requireRole("coach"));

function reqStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function optionalStringArray(v: unknown, maxItems: number, maxLen: number): string[] | false {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > maxItems) return false;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string") return false;
    const trimmed = item.trim();
    if (!trimmed || trimmed.length > maxLen) return false;
    out.push(trimmed);
  }
  return out;
}

// ---------- Coach profile ----------

router.get("/profile", async (req: Request, res: Response) => {
  if (!req.actor) return void res.status(401).json({ error: "unauthenticated" });
  const [profile, user] = await Promise.all([
    getOrCreateCoachProfile(req.actor.userId),
    User.findById(req.actor.userId).select("name email").lean(),
  ]);
  res.json({ profile: serializeOwnCoachProfile(profile.toObject(), user) });
});

router.patch("/profile", writeRateLimit({ windowMs: 60_000, max: 30 }), async (req: Request, res: Response) => {
  if (!req.actor) return void res.status(401).json({ error: "unauthenticated" });
  const profile = await getOrCreateCoachProfile(req.actor.userId);
  const body = req.body ?? {};

  if (body.bio !== undefined) {
    const bio = reqStr(body.bio);
    if (bio.length > 2000) return void res.status(400).json({ error: "invalid_bio" });
    profile.bio = bio || undefined;
  }
  if (body.philosophy !== undefined) {
    const philosophy = reqStr(body.philosophy);
    if (philosophy.length > 1000) return void res.status(400).json({ error: "invalid_philosophy" });
    profile.philosophy = philosophy || undefined;
  }
  if (body.yearsExperience !== undefined) {
    if (body.yearsExperience === null) {
      profile.yearsExperience = undefined;
    } else {
      const years = Number(body.yearsExperience);
      if (!Number.isFinite(years) || years < 0 || years > 60) return void res.status(400).json({ error: "invalid_yearsExperience" });
      profile.yearsExperience = years;
    }
  }
  if (body.certifications !== undefined) {
    const arr = optionalStringArray(body.certifications, 30, 120);
    if (arr === false) return void res.status(400).json({ error: "invalid_certifications" });
    profile.certifications = arr;
  }
  if (body.specializations !== undefined) {
    const arr = optionalStringArray(body.specializations, 30, 60);
    if (arr === false) return void res.status(400).json({ error: "invalid_specializations" });
    profile.specializations = arr;
  }
  if (body.languages !== undefined) {
    const arr = optionalStringArray(body.languages, 20, 40);
    if (arr === false) return void res.status(400).json({ error: "invalid_languages" });
    profile.languages = arr;
  }
  if (body.coachingTypes !== undefined) {
    const arr = optionalStringArray(body.coachingTypes, 10, 40);
    if (arr === false) return void res.status(400).json({ error: "invalid_coachingTypes" });
    profile.coachingTypes = arr;
  }
  if (body.nutritionSupport !== undefined) {
    if (typeof body.nutritionSupport !== "boolean") return void res.status(400).json({ error: "invalid_nutritionSupport" });
    profile.nutritionSupport = body.nutritionSupport;
  }

  await profile.save();
  const user = await User.findById(req.actor.userId).select("name email").lean();
  res.json({ profile: serializeOwnCoachProfile(profile.toObject(), user) });
});

/**
 * POST /profile/activate — opt IN to marketplace visibility. Never automatic
 * (no coach is ever auto-listed).
 */
router.post("/profile/activate", writeRateLimit({ windowMs: 60_000, max: 10 }), async (req: Request, res: Response) => {
  if (!req.actor) return void res.status(401).json({ error: "unauthenticated" });
  const profile = await getOrCreateCoachProfile(req.actor.userId);
  profile.active = true;
  await profile.save();
  res.json({ active: true });
});

router.post("/profile/deactivate", writeRateLimit({ windowMs: 60_000, max: 10 }), async (req: Request, res: Response) => {
  if (!req.actor) return void res.status(401).json({ error: "unauthenticated" });
  const profile = await getOrCreateCoachProfile(req.actor.userId);
  profile.active = false;
  await profile.save();
  res.json({ active: false });
});

// ---------- Pricing plans ----------

router.get("/pricing-plans", async (req: Request, res: Response) => {
  if (!req.actor) return void res.status(401).json({ error: "unauthenticated" });
  const plans = await CoachPricingPlan.find({ coachId: req.actor.userId }).sort({ priority: 1, createdAt: 1 }).lean();
  res.json({ pricingPlans: plans.map((p) => serializePricingPlan(p as never)) });
});

const CURRENCY_RE = /^[A-Za-z]{3}$/;

router.post("/pricing-plans", writeRateLimit({ windowMs: 60_000, max: 20 }), async (req: Request, res: Response) => {
  if (!req.actor) return void res.status(401).json({ error: "unauthenticated" });
  const name = reqStr(req.body?.name);
  if (!name || name.length > 80) return void res.status(400).json({ error: "invalid_name" });
  const monthlyPrice = Number(req.body?.monthlyPrice);
  if (!Number.isFinite(monthlyPrice) || monthlyPrice < 0 || monthlyPrice > 100000) {
    return void res.status(400).json({ error: "invalid_monthlyPrice" });
  }
  const currency = reqStr(req.body?.currency).toUpperCase();
  if (!CURRENCY_RE.test(currency)) return void res.status(400).json({ error: "invalid_currency" });
  const description = reqStr(req.body?.description);
  if (description.length > 1000) return void res.status(400).json({ error: "invalid_description" });
  const includedServices = optionalStringArray(req.body?.includedServices, 20, 120);
  if (includedServices === false) return void res.status(400).json({ error: "invalid_includedServices" });

  const liveSessionsPerCycle = req.body?.liveSessionsPerCycle !== undefined ? Number(req.body.liveSessionsPerCycle) : 0;
  if (!Number.isFinite(liveSessionsPerCycle) || liveSessionsPerCycle < 0 || liveSessionsPerCycle > 60) {
    return void res.status(400).json({ error: "invalid_liveSessionsPerCycle" });
  }

  const plan = await CoachPricingPlan.create({
    coachId: req.actor.userId,
    name,
    monthlyPrice,
    currency,
    description: description || undefined,
    includedServices,
    liveSessionsPerCycle,
    nutritionIncluded: Boolean(req.body?.nutritionIncluded),
    workoutPlanningIncluded: Boolean(req.body?.workoutPlanningIncluded),
    messagingIncluded: req.body?.messagingIncluded !== undefined ? Boolean(req.body.messagingIncluded) : true,
    priority: Number.isFinite(Number(req.body?.priority)) ? Number(req.body.priority) : 0,
    version: 1,
  });
  res.status(201).json({ pricingPlan: serializePricingPlan(plan) });
});

async function loadOwnPricingPlan(req: Request, res: Response): Promise<HydratedDocument<CoachPricingPlanDoc> | null> {
  if (!req.actor) {
    res.status(401).json({ error: "unauthenticated" });
    return null;
  }
  const id = req.params.pricingPlanId;
  if (!Types.ObjectId.isValid(id)) {
    res.status(400).json({ error: "invalid_pricing_plan_id" });
    return null;
  }
  const plan = await CoachPricingPlan.findById(id);
  if (!plan || !plan.coachId.equals(req.actor.userId)) {
    res.status(404).json({ error: "pricing_plan_not_found" });
    return null;
  }
  return plan;
}

/**
 * PATCH /pricing-plans/:id — any meaningful edit bumps `version`. Existing
 * subscribers (once Phase 6 exists) keep their snapshot of the pre-edit
 * terms regardless — this route only ever changes what NEW subscribers see.
 */
router.patch("/pricing-plans/:pricingPlanId", writeRateLimit({ windowMs: 60_000, max: 30 }), async (req: Request, res: Response) => {
  const plan = await loadOwnPricingPlan(req, res);
  if (!plan) return;
  const body = req.body ?? {};
  let changed = false;
  // Razorpay Plans are immutable once created (see paymentProvider.ts
  // ensurePlan — it reuses razorpayPlanId forever if set). A price/currency
  // edit here must invalidate the cached id so the NEXT new subscriber's
  // checkout creates a fresh provider plan at the new amount, rather than
  // silently billing them the stale pre-edit price. Existing subscribers are
  // unaffected either way — their pricingPlanSnapshot was already copied at
  // subscribe time (see subscription.ts) and never re-reads this document.
  let billingChanged = false;

  if (body.name !== undefined) {
    const name = reqStr(body.name);
    if (!name || name.length > 80) return void res.status(400).json({ error: "invalid_name" });
    plan.name = name;
    changed = true;
  }
  if (body.monthlyPrice !== undefined) {
    const monthlyPrice = Number(body.monthlyPrice);
    if (!Number.isFinite(monthlyPrice) || monthlyPrice < 0 || monthlyPrice > 100000) return void res.status(400).json({ error: "invalid_monthlyPrice" });
    if (monthlyPrice !== plan.monthlyPrice) billingChanged = true;
    plan.monthlyPrice = monthlyPrice;
    changed = true;
  }
  if (body.currency !== undefined) {
    const currency = reqStr(body.currency).toUpperCase();
    if (!CURRENCY_RE.test(currency)) return void res.status(400).json({ error: "invalid_currency" });
    if (currency !== plan.currency) billingChanged = true;
    plan.currency = currency;
    changed = true;
  }
  if (body.description !== undefined) {
    const description = reqStr(body.description);
    if (description.length > 1000) return void res.status(400).json({ error: "invalid_description" });
    plan.description = description || undefined;
  }
  if (body.includedServices !== undefined) {
    const arr = optionalStringArray(body.includedServices, 20, 120);
    if (arr === false) return void res.status(400).json({ error: "invalid_includedServices" });
    plan.includedServices = arr;
    changed = true;
  }
  if (body.liveSessionsPerCycle !== undefined) {
    const n = Number(body.liveSessionsPerCycle);
    if (!Number.isFinite(n) || n < 0 || n > 60) return void res.status(400).json({ error: "invalid_liveSessionsPerCycle" });
    plan.liveSessionsPerCycle = n;
    changed = true;
  }
  if (body.nutritionIncluded !== undefined) { plan.nutritionIncluded = Boolean(body.nutritionIncluded); changed = true; }
  if (body.workoutPlanningIncluded !== undefined) { plan.workoutPlanningIncluded = Boolean(body.workoutPlanningIncluded); changed = true; }
  if (body.messagingIncluded !== undefined) { plan.messagingIncluded = Boolean(body.messagingIncluded); changed = true; }
  if (body.priority !== undefined && Number.isFinite(Number(body.priority))) { plan.priority = Number(body.priority); }

  if (changed) plan.version = (plan.version ?? 1) + 1;
  if (billingChanged) plan.razorpayPlanId = null;
  await plan.save();
  res.json({ pricingPlan: serializePricingPlan(plan) });
});

router.post("/pricing-plans/:pricingPlanId/activate", writeRateLimit({ windowMs: 60_000, max: 30 }), async (req: Request, res: Response) => {
  const plan = await loadOwnPricingPlan(req, res);
  if (!plan) return;
  plan.active = true;
  await plan.save();
  res.json({ pricingPlan: serializePricingPlan(plan) });
});

router.post("/pricing-plans/:pricingPlanId/deactivate", writeRateLimit({ windowMs: 60_000, max: 30 }), async (req: Request, res: Response) => {
  const plan = await loadOwnPricingPlan(req, res);
  if (!plan) return;
  plan.active = false;
  await plan.save();
  res.json({ pricingPlan: serializePricingPlan(plan) });
});

export default router;
