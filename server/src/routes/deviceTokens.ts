import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth";
import { writeRateLimit } from "../middleware/rateLimit";
import { DeviceToken, DEVICE_TOKEN_PLATFORMS } from "../models/DeviceToken";

const router = Router();

router.use(requireAuth);

function optionalString(value: unknown, maxLength = 120): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

/**
 * POST /api/device-tokens  body: { token, platform }
 * Registers (or reactivates/reassigns) a push token for the logged-in user.
 * Upsert-by-token: if the same device token was previously registered to a
 * different account (device/account switch), it correctly moves to this one.
 */
router.post("/", writeRateLimit({ windowMs: 60_000, max: 20 }), async (req: Request, res: Response) => {
  if (!req.actor) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  const platform = req.body?.platform;
  if (!token) {
    res.status(400).json({ error: "token_required" });
    return;
  }
  if (!DEVICE_TOKEN_PLATFORMS.includes(platform)) {
    res.status(400).json({ error: "invalid_platform" });
    return;
  }

  await DeviceToken.findOneAndUpdate(
    { token },
    {
      $set: {
        userId: req.actor.userId,
        platform,
        appVersion: optionalString(req.body?.appVersion, 80),
        deviceName: optionalString(req.body?.deviceName, 120),
        osName: optionalString(req.body?.osName, 40),
        osVersion: optionalString(req.body?.osVersion, 40),
        lastSeenAt: new Date(),
        disabledAt: null,
      },
    },
    { upsert: true }
  );
  res.status(201).json({ ok: true });
});

/**
 * DELETE /api/device-tokens  body: { token }
 * Deregisters a token on logout — only ever the caller's own token.
 */
router.delete("/", async (req: Request, res: Response) => {
  if (!req.actor) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  if (!token) {
    res.status(400).json({ error: "token_required" });
    return;
  }
  await DeviceToken.deleteOne({ token, userId: req.actor.userId });
  res.json({ ok: true });
});

export default router;
