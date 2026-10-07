import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

export const JOIN_REQUEST_STATUSES = ["pending", "accepted", "declined", "cancelled"] as const;
export type JoinRequestStatus = (typeof JOIN_REQUEST_STATUSES)[number];

/**
 * An athlete asking a listed coach to take them on, the in-app path to a
 * coach while payments are off (the paid path is a subscription instead).
 * Accepting creates the CoachAthleteAssignment; until then the coach sees
 * only what the athlete chose to share here (name, sport, message), so the
 * coach-scope invariant is untouched.
 *
 * At most one pending request per athlete (unique partial index), so an
 * athlete can never end up accepted by two coaches at once; the one-active-
 * coach index on CoachAthleteAssignment is the final guard at accept time.
 */
const coachJoinRequestSchema = new Schema(
  {
    athleteId: { type: Schema.Types.ObjectId, ref: "AthleteProfile", required: true },
    athleteUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    coachId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: JOIN_REQUEST_STATUSES, default: "pending" },
    message: { type: String, trim: true, maxlength: 500, default: "" },
    decidedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

coachJoinRequestSchema.index({ athleteId: 1 }, { unique: true, partialFilterExpression: { status: "pending" } });
coachJoinRequestSchema.index({ coachId: 1, status: 1, createdAt: -1 });

export type CoachJoinRequestDoc = InferSchemaType<typeof coachJoinRequestSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};
export const CoachJoinRequest: Model<CoachJoinRequestDoc> = model<CoachJoinRequestDoc>("CoachJoinRequest", coachJoinRequestSchema);
