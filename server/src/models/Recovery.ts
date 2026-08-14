import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

export const RECOVERY_STATUS = ["green", "amber", "red"] as const;
export type RecoveryStatus = (typeof RECOVERY_STATUS)[number];

const recoverySchema = new Schema(
  {
    athleteId: { type: Schema.Types.ObjectId, ref: "AthleteProfile", required: true },
    date: { type: Date, required: true },
    restingHr: { type: Number },
    hrv: { type: Number },
    recoveryScore: { type: Number, min: 0, max: 100 },
    status: { type: String, enum: RECOVERY_STATUS },
    modalities: [{ type: String }],
    note: { type: String },
  },
  { timestamps: true }
);

recoverySchema.index({ athleteId: 1, date: -1 }, { unique: true });

export type RecoveryDoc = InferSchemaType<typeof recoverySchema> & {
  _id: Types.ObjectId;
};
export const Recovery: Model<RecoveryDoc> = model<RecoveryDoc>(
  "Recovery",
  recoverySchema
);
