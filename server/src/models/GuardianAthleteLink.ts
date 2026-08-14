import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

const guardianAthleteLinkSchema = new Schema(
  {
    guardianId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    athleteId: { type: Schema.Types.ObjectId, ref: "AthleteProfile", required: true },
    relationship: { type: String, trim: true },
    endedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

guardianAthleteLinkSchema.index({ guardianId: 1, endedAt: 1 });
guardianAthleteLinkSchema.index({ athleteId: 1, endedAt: 1 });
guardianAthleteLinkSchema.index(
  { guardianId: 1, athleteId: 1 },
  { unique: true, partialFilterExpression: { endedAt: null } }
);

export type GuardianAthleteLinkDoc = InferSchemaType<typeof guardianAthleteLinkSchema> & {
  _id: Types.ObjectId;
};

export const GuardianAthleteLink: Model<GuardianAthleteLinkDoc> =
  model<GuardianAthleteLinkDoc>("GuardianAthleteLink", guardianAthleteLinkSchema);
