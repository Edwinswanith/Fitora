import { Router, type Request, type Response } from "express";
import express from "express";
import crypto from "crypto";
import { PaymentWebhookEvent } from "../models/PaymentWebhookEvent";
import { getPaymentProvider } from "../services/paymentProvider";
import { applyPaymentEvent } from "../services/subscription";

/**
 * Provider-signed, NOT JWT-gated (there is no user session on a server-to-
 * server webhook call). Must be mounted in app.ts BEFORE the global
 * express.json() — express.raw() here preserves the exact bytes Razorpay
 * signed, which JSON re-serialization would not reproduce byte-for-byte.
 *
 * Idempotency: since Razorpay doesn't guarantee a stable per-delivery event
 * id in the payload, a sha256 of the raw body is used as the
 * PaymentWebhookEvent.providerEventId — identical redeliveries hash
 * identically and hit the unique index, so they're acknowledged (200) as
 * duplicates without reprocessing side effects.
 */
const router = Router();

router.post("/razorpay", express.raw({ type: "application/json" }), async (req: Request, res: Response) => {
  const rawBody = req.body;
  if (!Buffer.isBuffer(rawBody)) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }

  const provider = getPaymentProvider();
  const signature = req.header("x-razorpay-signature");
  if (!provider.verifyWebhookSignature(rawBody, signature)) {
    res.status(400).json({ error: "invalid_signature" });
    return;
  }

  let event;
  try {
    event = provider.parseWebhookEvent(rawBody);
  } catch {
    res.status(400).json({ error: "invalid_payload" });
    return;
  }

  const providerEventId = crypto.createHash("sha256").update(rawBody).digest("hex");
  try {
    await PaymentWebhookEvent.create({ provider: "razorpay", providerEventId, eventType: event.eventType });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      res.status(200).json({ received: true, duplicate: true });
      return;
    }
    throw err;
  }

  await applyPaymentEvent(event);
  res.status(200).json({ received: true });
});

export default router;
