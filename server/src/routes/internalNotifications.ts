import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { Types } from "mongoose";
import { env } from "../config/env";
import { AthleteProfile } from "../models/AthleteProfile";
import { User } from "../models/User";
import { evaluateAndDispatch } from "../services/notificationEligibility";
import { runSweep } from "../services/notificationSweep";

const router = Router();

/**
 * Guards every route below — this is NEVER called by a client app, only by
 * the external scheduler (Cloud Scheduler in production). Fail-closed: a
 * missing/mismatched header always 401s, even if the secret is somehow unset.
 */
function requireSweepSecret(req: Request, res: Response, next: () => void): void {
  const header = req.header("authorization") ?? "";
  const expected = `Bearer ${env.internalNotifications.sweepSecret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  const match = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!match) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

router.use(requireSweepSecret);

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function requiredTrimmedString(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const text = v.trim();
  if (!text || text.length > max) return null;
  return text;
}

/**
 * POST /internal/notifications/sweep?limit=&pages=&cursor=
 * See services/notificationSweep.ts for the actual algorithm — this route is
 * just query-param parsing + auth.
 */
router.post("/sweep", async (req: Request, res: Response) => {
  const limit = clampInt(req.query.limit, env.notification.sweepDefaultLimit, 1, 1000);
  const pages = clampInt(req.query.pages, env.notification.sweepDefaultPages, 1, 50);
  const cursor =
    typeof req.query.cursor === "string" && Types.ObjectId.isValid(req.query.cursor)
      ? new Types.ObjectId(req.query.cursor)
      : null;

  const result = await runSweep({ limit, pages, cursor });
  res.json(result);
});

/**
 * POST /internal/notifications/test
 * Body: { email, title, body }
 *
 * Protected one-recipient push smoke test for production support. This does
 * not let client apps send pushes, and it does not bypass global/user/category
 * notification opt-outs or the active-token requirement. It does bypass quiet
 * hours, cap, min-interval, and presence so support can verify device delivery
 * while the user is actively testing.
 */
router.post("/test", async (req: Request, res: Response) => {
  const email = requiredTrimmedString(req.body?.email, 254)?.toLowerCase() ?? null;
  const title = requiredTrimmedString(req.body?.title, 80);
  const body = requiredTrimmedString(req.body?.body, 240);

  if (!email || !title || !body) {
    res.status(400).json({ error: "invalid_payload" });
    return;
  }

  const user = await User.findOne({ email })
    .select("_id email role academyId")
    .lean();
  if (!user) {
    res.status(404).json({ error: "user_not_found" });
    return;
  }

  const profile =
    user.role === "athlete"
      ? await AthleteProfile.findOne({ userId: user._id }).select("timezone").lean()
      : null;
  const now = new Date();
  const dedupKey = `apex_test_notification:${user._id.toString()}:${now.getTime()}:${crypto.randomUUID()}`;
  const outcome = await evaluateAndDispatch(
    {
      userId: user._id,
      type: "apex_test_notification",
      category: "alerts",
      priorityTier: 2,
      dedupKey,
      title,
      body,
      link: "/notifications",
      academyId: user.academyId ?? null,
      timezone: (profile?.timezone as string | undefined) ?? "UTC",
      override: true,
    },
    { now }
  );

  res.status(outcome === "sent" ? 201 : 202).json({
    outcome,
    email,
    userId: user._id.toString(),
    title,
    body,
    dedupKey,
    sentAt: now.toISOString(),
  });
});

export default router;
