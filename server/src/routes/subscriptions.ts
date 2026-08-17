import { Router, type Request, type Response } from "express";
import { Types } from "mongoose";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/role";
import { loadScope } from "../middleware/coachAthleteAccess";
import { writeRateLimit } from "../middleware/rateLimit";
import { User } from "../models/User";
import { Payment } from "../models/Payment";
import {
  initiateSubscription,
  getCurrentSubscription,
  cancelSubscription,
  serializeSubscription,
  SubscriptionError,
} from "../services/subscription";

const router = Router();
router.use(requireAuth, requireRole("athlete"), loadScope);

function selfAthleteId(req: Request): Types.ObjectId | null {
  return req.actor?.athleteProfileId ?? null;
}

/** POST /coach-subscriptions — body: { coachId, pricingPlanId }. Starts checkout for a new coach subscription. */
router.post("/coach-subscriptions", writeRateLimit({ windowMs: 60_000, max: 10 }), async (req: Request, res: Response) => {
  const athleteId = selfAthleteId(req);
  if (!athleteId) return void res.status(404).json({ error: "athlete_profile_not_found" });

  const coachId = req.body?.coachId;
  const pricingPlanId = req.body?.pricingPlanId;
  if (typeof coachId !== "string" || !Types.ObjectId.isValid(coachId)) {
    return void res.status(400).json({ error: "invalid_coach_id" });
  }
  if (typeof pricingPlanId !== "string" || !Types.ObjectId.isValid(pricingPlanId)) {
    return void res.status(400).json({ error: "invalid_pricing_plan_id" });
  }

  const coach = await User.findById(coachId).select("role").lean();
  if (!coach || coach.role !== "coach") {
    return void res.status(404).json({ error: "coach_not_found" });
  }

  try {
    const { subscription, checkoutRef } = await initiateSubscription(
      athleteId,
      new Types.ObjectId(coachId),
      new Types.ObjectId(pricingPlanId)
    );
    res.status(201).json({ subscription: serializeSubscription(subscription), checkoutRef });
  } catch (err) {
    if (err instanceof SubscriptionError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
});

/** GET /coach-subscriptions/current — the athlete's own pending/active/payment_due subscription, if any. */
router.get("/coach-subscriptions/current", async (req: Request, res: Response) => {
  const athleteId = selfAthleteId(req);
  if (!athleteId) return void res.status(404).json({ error: "athlete_profile_not_found" });

  const subscription = await getCurrentSubscription(athleteId);
  res.json({ subscription: subscription ? serializeSubscription(subscription) : null });
});

/** GET /coach-subscriptions/current/payments — receipt view derived from Payment rows, newest first. */
router.get("/coach-subscriptions/current/payments", async (req: Request, res: Response) => {
  const athleteId = selfAthleteId(req);
  if (!athleteId) return void res.status(404).json({ error: "athlete_profile_not_found" });

  const subscription = await getCurrentSubscription(athleteId);
  if (!subscription) return void res.json({ payments: [] });

  const payments = await Payment.find({ subscriptionId: subscription._id }).sort({ createdAt: -1 }).lean();
  res.json({
    payments: payments.map((p) => ({
      id: p._id.toString(),
      amount: p.amount,
      currency: p.currency,
      status: p.status,
      periodStart: p.periodStart,
      periodEnd: p.periodEnd,
      createdAt: p.createdAt,
    })),
  });
});

/** POST /coach-subscriptions/:id/cancel — stops future billing; access continues until currentPeriodEnd. */
router.post("/coach-subscriptions/:id/cancel", writeRateLimit({ windowMs: 60_000, max: 10 }), async (req: Request, res: Response) => {
  const athleteId = selfAthleteId(req);
  if (!athleteId) return void res.status(404).json({ error: "athlete_profile_not_found" });

  const id = req.params.id;
  if (!Types.ObjectId.isValid(id)) return void res.status(400).json({ error: "invalid_subscription_id" });

  try {
    const subscription = await cancelSubscription(athleteId, new Types.ObjectId(id));
    res.json({ subscription: serializeSubscription(subscription) });
  } catch (err) {
    if (err instanceof SubscriptionError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
});

export default router;
