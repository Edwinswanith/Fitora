import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";
import { PAYMENT_PROVIDERS } from "./AthleteCoachSubscription";

export const PAYMENT_STATUSES = ["pending", "succeeded", "failed", "refunded"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * One payment/charge event against a subscription. `providerPaymentId` is
 * the ACTUAL idempotency/replay guard for payment-side webhook duplicates —
 * a unique index, not merely a business key — so a redelivered
 * payment.captured webhook hits E11000 on the second insert attempt and is
 * treated as already-processed rather than double-crediting the
 * subscription. `rawEventRef` is kept for audit/support only, never served
 * back to a client as trusted data (same "AI/external output is not truth"
 * discipline as MealScan.rawModelOutputRef). There is no separate Invoice
 * collection — a "receipt" view is derived at read time from this document
 * plus its subscription's pricingPlanSnapshot, which is enough to answer
 * every receipt/invoice question this phase asks without a redundant
 * duplicate collection to keep in sync.
 */
const paymentSchema = new Schema(
  {
    subscriptionId: { type: Schema.Types.ObjectId, ref: "AthleteCoachSubscription", required: true },
    provider: { type: String, enum: PAYMENT_PROVIDERS, required: true },
    providerPaymentId: { type: String, required: true, unique: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true },
    status: { type: String, enum: PAYMENT_STATUSES, required: true },
    periodStart: { type: Date, default: null },
    periodEnd: { type: Date, default: null },
    rawEventRef: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

paymentSchema.index({ subscriptionId: 1, createdAt: -1 });

export type PaymentDoc = InferSchemaType<typeof paymentSchema> & { _id: Types.ObjectId };
export const Payment: Model<PaymentDoc> = model<PaymentDoc>("Payment", paymentSchema);
