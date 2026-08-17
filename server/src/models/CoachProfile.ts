import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

export const COACH_VERIFICATION_STATUSES = ["unverified", "pending", "verified"] as const;
export type CoachVerificationStatus = (typeof COACH_VERIFICATION_STATUSES)[number];

/**
 * Marketplace-facing extension of a coach User — kept as its own collection
 * rather than fields bolted onto User, since this is purely marketplace
 * metadata (bio, specializations, pricing-adjacent aggregates) that ~90% of
 * Users (never coaches) would otherwise carry unused. `active` is an
 * explicit opt-in: a coach is invisible in GET /marketplace/coaches until
 * they set it true themselves — existing/new coach accounts are never
 * auto-listed. `avgRating`/`reviewCount` are the "ratings foundation" this
 * phase asks for; they stay at their defaults until Phase 10 (CoachReview)
 * actually writes to them via a server-side recompute, never a client-
 * supplied value.
 */
const coachProfileSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    bio: { type: String, trim: true, maxlength: 2000 },
    philosophy: { type: String, trim: true, maxlength: 1000 },
    yearsExperience: { type: Number, min: 0, max: 60, default: null },
    certifications: { type: [String], default: [] },
    specializations: { type: [String], default: [] },
    languages: { type: [String], default: [] },
    coachingTypes: { type: [String], default: [] },
    nutritionSupport: { type: Boolean, default: false },
    verifiedStatus: { type: String, enum: COACH_VERIFICATION_STATUSES, default: "unverified" },
    avgRating: { type: Number, min: 0, max: 5, default: null },
    reviewCount: { type: Number, default: 0, min: 0 },
    active: { type: Boolean, default: false },
  },
  { timestamps: true }
);

coachProfileSchema.index({ active: 1, avgRating: -1 });
coachProfileSchema.index({ active: 1, specializations: 1 });

export type CoachProfileDoc = InferSchemaType<typeof coachProfileSchema> & {
  _id: Types.ObjectId;
};
export const CoachProfile: Model<CoachProfileDoc> = model<CoachProfileDoc>(
  "CoachProfile",
  coachProfileSchema
);
