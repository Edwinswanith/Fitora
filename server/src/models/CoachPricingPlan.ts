import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

/**
 * A reusable pricing package a coach offers (e.g. Basic/Pro/Premium — free-
 * text `name`, not a fixed enum, since coaches name their own tiers).
 * `version` bumps on a meaningful edit (price/services change) — Phase 6's
 * AthleteCoachSubscription will snapshot a plan's terms at subscribe-time
 * against this version, so an existing subscriber's terms survive a coach
 * editing FUTURE pricing (not implemented until Phase 6 exists to consume
 * it, but the version field needs to exist now so nothing has to be
 * retrofitted). `active: false` hides a plan from the public marketplace
 * profile without deleting it (a coach may want to retire a tier while still
 * honoring history that referenced it later).
 */
const coachPricingPlanSchema = new Schema(
  {
    coachId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    monthlyPrice: { type: Number, required: true, min: 0, max: 100000 },
    currency: { type: String, required: true, trim: true, uppercase: true, minlength: 3, maxlength: 3 },
    description: { type: String, trim: true, maxlength: 1000 },
    includedServices: { type: [String], default: [] },
    liveSessionsPerCycle: { type: Number, default: 0, min: 0, max: 60 },
    nutritionIncluded: { type: Boolean, default: false },
    workoutPlanningIncluded: { type: Boolean, default: false },
    messagingIncluded: { type: Boolean, default: true },
    priority: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
    version: { type: Number, default: 1, min: 1 },
  },
  { timestamps: true }
);

coachPricingPlanSchema.index({ coachId: 1, active: 1, priority: 1 });

export type CoachPricingPlanDoc = InferSchemaType<typeof coachPricingPlanSchema> & {
  _id: Types.ObjectId;
};
export const CoachPricingPlan: Model<CoachPricingPlanDoc> = model<CoachPricingPlanDoc>(
  "CoachPricingPlan",
  coachPricingPlanSchema
);
