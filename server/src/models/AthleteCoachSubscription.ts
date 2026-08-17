import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

export const PAYMENT_PROVIDERS = ["razorpay"] as const;
export type PaymentProviderName = (typeof PAYMENT_PROVIDERS)[number];

export const SUBSCRIPTION_STATUSES = [
  "pending",
  "active",
  "payment_due",
  "payment_failed",
  "cancelled",
  "expired",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/**
 * A separate domain from CoachRelationship (CoachAthleteAssignment) by
 * design — payment/subscription status must never be mixed into workout
 * completion status or the relationship's own active/ended state. The
 * relationship is only ever created once this subscription's payment is
 * WEBHOOK-VERIFIED active (relationshipId starts null) — never at checkout-
 * initiation time, so a coach can never see a User's data before payment is
 * actually confirmed server-side. `pricingPlanSnapshot` is copied at
 * subscribe-time so a coach editing their pricing later never changes what
 * an existing subscriber pays (mirrors WorkoutAssignment/MealPlanAssignment
 * snapshotting). `expiring_soon` is deliberately NOT a stored status — it is
 * always derived from currentPeriodEnd at read/sweep time (see
 * services/subscription.ts), matching the plan's own "derive, don't persist"
 * principle used elsewhere (MealPlanAssignment's "completed").
 */
const athleteCoachSubscriptionSchema = new Schema(
  {
    relationshipId: { type: Schema.Types.ObjectId, ref: "CoachAthleteAssignment", default: null },
    coachId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    athleteId: { type: Schema.Types.ObjectId, ref: "AthleteProfile", required: true },
    pricingPlanId: { type: Schema.Types.ObjectId, ref: "CoachPricingPlan", required: true },
    pricingPlanSnapshot: {
      name: { type: String, required: true },
      monthlyPrice: { type: Number, required: true },
      currency: { type: String, required: true },
      includedServices: { type: [String], default: [] },
      liveSessionsPerCycle: { type: Number, default: 0 },
      nutritionIncluded: { type: Boolean, default: false },
      workoutPlanningIncluded: { type: Boolean, default: false },
      messagingIncluded: { type: Boolean, default: true },
      version: { type: Number, required: true },
    },
    provider: { type: String, enum: PAYMENT_PROVIDERS, required: true },
    providerSubscriptionId: { type: String, default: null },
    status: { type: String, enum: SUBSCRIPTION_STATUSES, default: "pending" },
    currentPeriodStart: { type: Date, default: null },
    currentPeriodEnd: { type: Date, default: null },
    nextBillingAt: { type: Date, default: null },
    cancelAtPeriodEnd: { type: Boolean, default: false },
    cancelledAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// At most one NON-TERMINAL subscription per athlete at a time — this is what
// actually stops "simultaneous subscribe to two different coaches" (a real
// race the plan explicitly calls out): both requests can pass an app-level
// pre-check, but only one create() survives this index; the loser gets a
// clean 409, matching the same DB-enforced pattern as the one-primary-coach
// index on CoachAthleteAssignment.
athleteCoachSubscriptionSchema.index(
  { athleteId: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ["pending", "active", "payment_due"] } } }
);
athleteCoachSubscriptionSchema.index({ providerSubscriptionId: 1 }, { unique: true, sparse: true });
athleteCoachSubscriptionSchema.index({ coachId: 1, status: 1 });

export type AthleteCoachSubscriptionDoc = InferSchemaType<typeof athleteCoachSubscriptionSchema> & {
  _id: Types.ObjectId;
};
export const AthleteCoachSubscription: Model<AthleteCoachSubscriptionDoc> = model<AthleteCoachSubscriptionDoc>(
  "AthleteCoachSubscription",
  athleteCoachSubscriptionSchema
);
