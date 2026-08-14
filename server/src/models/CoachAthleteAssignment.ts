import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

const coachAthleteAssignmentSchema = new Schema(
  {
    coachId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    athleteId: { type: Schema.Types.ObjectId, ref: "AthleteProfile", required: true },
    assignedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    assignedAt: { type: Date, default: () => new Date() },
    endedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

coachAthleteAssignmentSchema.index({ coachId: 1, endedAt: 1 });
coachAthleteAssignmentSchema.index({ athleteId: 1, endedAt: 1 });
coachAthleteAssignmentSchema.index(
  { coachId: 1, athleteId: 1 },
  { unique: true, partialFilterExpression: { endedAt: null } }
);

export type CoachAthleteAssignmentDoc = InferSchemaType<
  typeof coachAthleteAssignmentSchema
> & { _id: Types.ObjectId };

export const CoachAthleteAssignment: Model<CoachAthleteAssignmentDoc> =
  model<CoachAthleteAssignmentDoc>(
    "CoachAthleteAssignment",
    coachAthleteAssignmentSchema
  );
