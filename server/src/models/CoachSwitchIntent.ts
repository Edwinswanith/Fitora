import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

export const COACH_SWITCH_INTENT_STATUSES = ["pending", "completed", "failed", "expired"] as const;
export type CoachSwitchIntentStatus = (typeof COACH_SWITCH_INTENT_STATUSES)[number];

/**
 * Tracks an in-flight coach switch (Phase 12 — replaces the old unsafe
 * "end Coach A, then hope Coach B's checkout succeeds" flow). The OLD
 * relationship stays fully active and untouched for as long as this intent is
 * `pending` — it is only ended, atomically together with activating the new
 * one, once the new coach's payment is webhook-verified (see
 * services/subscription.ts `completeSwitchIntent`). If payment fails or is
 * abandoned, this row just moves to `failed`/`expired` and nothing about the
 * old relationship was ever touched — there's nothing to roll back.
 *
 * This is a separate collection from AthleteCoachSubscription (not a second
 * `pending` row on that model) specifically to avoid AthleteCoachSubscription's
 * own unique-partial index (`{athleteId}` unique where status is
 * pending|active|payment_due — the anti-double-subscribe race guard):
 * starting checkout for a new coach while the athlete is still validly
 * subscribed to their current one would collide with that same index if it
 * tried to create a second AthleteCoachSubscription row up front. The real
 * AthleteCoachSubscription for the new coach is only created at the moment
 * this intent completes, by which point the old one has just been made
 * terminal in the same transaction, freeing that index slot.
 */
const coachSwitchIntentSchema = new Schema(
  {
    athleteId: { type: Schema.Types.ObjectId, ref: "AthleteProfile", required: true },
    fromRelationshipId: { type: Schema.Types.ObjectId, ref: "CoachAthleteAssignment", required: true },
    toCoachId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    toPricingPlanId: { type: Schema.Types.ObjectId, ref: "CoachPricingPlan", required: true },
    toPricingPlanSnapshot: {
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
    provider: { type: String, enum: ["razorpay"], required: true },
    providerSubscriptionId: { type: String, default: null },
    status: { type: String, enum: COACH_SWITCH_INTENT_STATUSES, default: "pending" },
    resultingSubscriptionId: { type: Schema.Types.ObjectId, ref: "AthleteCoachSubscription", default: null },
    failureReason: { type: String, default: null },
  },
  { timestamps: true }
);

// At most one pending switch intent per athlete — same race-guard shape as
// AthleteCoachSubscription's own unique-partial index, scoped to intents only.
coachSwitchIntentSchema.index({ athleteId: 1 }, { unique: true, partialFilterExpression: { status: "pending" } });
coachSwitchIntentSchema.index({ providerSubscriptionId: 1 }, { unique: true, sparse: true });

export type CoachSwitchIntentDoc = InferSchemaType<typeof coachSwitchIntentSchema> & {
  _id: Types.ObjectId;
};
export const CoachSwitchIntent: Model<CoachSwitchIntentDoc> = model<CoachSwitchIntentDoc>(
  "CoachSwitchIntent",
  coachSwitchIntentSchema
);
