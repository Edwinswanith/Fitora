import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";
import { PAYMENT_PROVIDERS } from "./AthleteCoachSubscription";

/**
 * Idempotency/replay ledger for EVERY webhook delivery, not just payment-
 * captured ones (Payment.providerPaymentId alone doesn't cover events like
 * subscription.activated or subscription.cancelled, which may carry no
 * payment id). `providerEventId` is whatever unique identifier the provider
 * includes for this specific delivery; when a provider's payload doesn't
 * expose one directly, the webhook handler falls back to a deterministic
 * hash of the raw body (see services/paymentProvider.ts) so an identical
 * redelivery of the same event always produces the same key. The unique
 * index is the actual guard — a duplicate delivery's insert attempt fails
 * with E11000 and the handler treats that as "already processed," never
 * reprocessing side effects twice.
 */
const paymentWebhookEventSchema = new Schema(
  {
    provider: { type: String, enum: PAYMENT_PROVIDERS, required: true },
    providerEventId: { type: String, required: true },
    eventType: { type: String, required: true },
    receivedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

paymentWebhookEventSchema.index({ provider: 1, providerEventId: 1 }, { unique: true });

export type PaymentWebhookEventDoc = InferSchemaType<typeof paymentWebhookEventSchema> & {
  _id: Types.ObjectId;
};
export const PaymentWebhookEvent: Model<PaymentWebhookEventDoc> = model<PaymentWebhookEventDoc>(
  "PaymentWebhookEvent",
  paymentWebhookEventSchema
);
