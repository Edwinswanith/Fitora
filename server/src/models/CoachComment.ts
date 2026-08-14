import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

const coachCommentSchema = new Schema(
  {
    athleteId: { type: Schema.Types.ObjectId, ref: "AthleteProfile", required: true },
    coachId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    date: { type: Date, required: true },
    body: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

coachCommentSchema.index({ athleteId: 1, date: -1 });

export type CoachCommentDoc = InferSchemaType<typeof coachCommentSchema> & {
  _id: Types.ObjectId;
};
export const CoachComment: Model<CoachCommentDoc> = model<CoachCommentDoc>(
  "CoachComment",
  coachCommentSchema
);
