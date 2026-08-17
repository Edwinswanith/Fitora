import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

export const REVIEW_SUB_RATING_KEYS = ["trainingQuality", "communication", "knowledge", "responsiveness", "valueForMoney"] as const;
export type ReviewSubRatingKey = (typeof REVIEW_SUB_RATING_KEYS)[number];

const subRatingsSchema = new Schema(
  {
    trainingQuality: { type: Number, min: 1, max: 5, default: null },
    communication: { type: Number, min: 1, max: 5, default: null },
    knowledge: { type: Number, min: 1, max: 5, default: null },
    responsiveness: { type: Number, min: 1, max: 5, default: null },
    valueForMoney: { type: Number, min: 1, max: 5, default: null },
  },
  { _id: false }
);

/**
 * One review per coaching relationship — the unique index on `relationshipId`
 * is what actually enforces "one review per relationship" (not just an
 * app-level pre-check), tied to a specific historical CoachAthleteAssignment
 * rather than freestanding, so a review always traces back to exactly which
 * stint of coaching it's about (relevant once an athlete has switched
 * coaches and back). Eligibility (relationship must be `status: "ended"`)
 * is enforced in services/coachReview.ts, not here. `editedAt` stays null
 * until the first PATCH; there is no delete endpoint — edit-in-place only,
 * so "review re-created after deletion" is structurally impossible.
 */
const coachReviewSchema = new Schema(
  {
    relationshipId: { type: Schema.Types.ObjectId, ref: "CoachAthleteAssignment", required: true, unique: true },
    coachId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    athleteId: { type: Schema.Types.ObjectId, ref: "AthleteProfile", required: true },
    overallRating: { type: Number, required: true, min: 1, max: 5 },
    subRatings: { type: subRatingsSchema, default: () => ({}) },
    body: { type: String, trim: true, maxlength: 2000 },
    editedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

coachReviewSchema.index({ coachId: 1, createdAt: -1 });

export type CoachReviewDoc = InferSchemaType<typeof coachReviewSchema> & {
  _id: Types.ObjectId;
};
export const CoachReview: Model<CoachReviewDoc> = model<CoachReviewDoc>("CoachReview", coachReviewSchema);
