import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

export const COACH_INVITE_STATUSES = ["pending", "accepted", "declined", "cancelled"] as const;
export type CoachInviteStatus = (typeof COACH_INVITE_STATUSES)[number];

/** How long an unanswered invite stays usable. */
export const COACH_INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * A coach asking an existing athlete (found by email) to train with them,
 * the coach-initiated counterpart of CoachJoinRequest. Nothing about the
 * athlete is visible to the coach until the athlete accepts: accepting is
 * what creates the CoachAthleteAssignment, so an email address alone never
 * grants access to anyone's data.
 *
 * At most one pending invite per (coach, athlete); the one-active-coach index
 * on CoachAthleteAssignment is the final guard at accept time.
 */
const coachInviteSchema = new Schema(
  {
    coachId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    athleteId: { type: Schema.Types.ObjectId, ref: "AthleteProfile", required: true },
    athleteUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: COACH_INVITE_STATUSES, default: "pending" },
    expiresAt: { type: Date, required: true },
    decidedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

coachInviteSchema.index({ coachId: 1, athleteId: 1 }, { unique: true, partialFilterExpression: { status: "pending" } });
coachInviteSchema.index({ athleteUserId: 1, status: 1, createdAt: -1 });

export type CoachInviteDoc = InferSchemaType<typeof coachInviteSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};
export const CoachInvite: Model<CoachInviteDoc> = model<CoachInviteDoc>("CoachInvite", coachInviteSchema);
