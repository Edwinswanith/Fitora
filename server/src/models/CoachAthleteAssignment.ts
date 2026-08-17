import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

export const COACH_RELATIONSHIP_STATUSES = ["active", "ended"] as const;
export type CoachRelationshipStatus = (typeof COACH_RELATIONSHIP_STATUSES)[number];

export const COACH_RELATIONSHIP_ENDED_REASONS = [
  "user_switched",
  "athlete_left",
  "coach_ended",
  "subscription_cancelled",
  "subscription_expired",
] as const;
export type CoachRelationshipEndedReason = (typeof COACH_RELATIONSHIP_ENDED_REASONS)[number];

const coachAthleteAssignmentSchema = new Schema(
  {
    coachId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    athleteId: { type: Schema.Types.ObjectId, ref: "AthleteProfile", required: true },
    assignedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    assignedAt: { type: Date, default: () => new Date() },
    endedAt: { type: Date, default: null },
    // Explicit lifecycle status alongside endedAt (kept in sync — endedAt: null
    // implies "active", a Date implies "ended"). Having a real field simplifies
    // querying once subscription-driven nuance (payment_due, etc.) lives on a
    // linked AthleteCoachSubscription rather than here.
    status: { type: String, enum: COACH_RELATIONSHIP_STATUSES, default: "active", index: true },
    subscriptionId: { type: Schema.Types.ObjectId, ref: "AthleteCoachSubscription", default: null },
    endedReason: { type: String, enum: COACH_RELATIONSHIP_ENDED_REASONS, default: null },
  },
  { timestamps: true }
);

coachAthleteAssignmentSchema.index({ coachId: 1, endedAt: 1 });
coachAthleteAssignmentSchema.index({ athleteId: 1, endedAt: 1 });
coachAthleteAssignmentSchema.index(
  { coachId: 1, athleteId: 1 },
  { unique: true, partialFilterExpression: { endedAt: null } }
);
// One primary paid Coach at a time per athlete (V1 product rule) — enforced at
// the DB layer, not just in route handlers. Only ever one row per athlete with
// status: "active" can exist; ended relationships are exempt and accumulate as
// history. See CLAUDE.md / the Fitora backend architecture plan for context.
coachAthleteAssignmentSchema.index(
  { athleteId: 1 },
  { unique: true, partialFilterExpression: { status: "active" } }
);

export type CoachAthleteAssignmentDoc = InferSchemaType<
  typeof coachAthleteAssignmentSchema
> & { _id: Types.ObjectId };

export const CoachAthleteAssignment: Model<CoachAthleteAssignmentDoc> =
  model<CoachAthleteAssignmentDoc>(
    "CoachAthleteAssignment",
    coachAthleteAssignmentSchema
  );
