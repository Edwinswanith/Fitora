import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

export const INJURY_STATUS = ["active", "monitoring", "cleared"] as const;
export type InjuryStatus = (typeof INJURY_STATUS)[number];

export const INJURY_SEVERITY = ["mild", "moderate", "severe"] as const;
export type InjurySeverity = (typeof INJURY_SEVERITY)[number];

const injurySchema = new Schema(
  {
    athleteId: { type: Schema.Types.ObjectId, ref: "AthleteProfile", required: true },
    bodyPart: { type: String, required: true },
    description: { type: String },
    severity: { type: String, enum: INJURY_SEVERITY },
    status: { type: String, enum: INJURY_STATUS, default: "active" },
    restriction: { type: String },
    startedAt: { type: Date, required: true, default: () => new Date() },
    clearedAt: { type: Date },
  },
  { timestamps: true }
);

injurySchema.index({ athleteId: 1, status: 1, startedAt: -1 });

export type InjuryDoc = InferSchemaType<typeof injurySchema> & {
  _id: Types.ObjectId;
};
export const Injury: Model<InjuryDoc> = model<InjuryDoc>("Injury", injurySchema);
