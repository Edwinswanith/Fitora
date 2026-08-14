import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

const wellnessSchema = new Schema(
  {
    athleteId: { type: Schema.Types.ObjectId, ref: "AthleteProfile", required: true },
    date: { type: Date, required: true },
    sleepHours: { type: Number, min: 0, max: 14 },
    sleepQuality: { type: Number, min: 1, max: 5 },
    mood: { type: Number, min: 1, max: 5 },
    stress: { type: Number, min: 1, max: 5 },
    soreness: { type: Number, min: 1, max: 5 },
    fatigue: { type: Number, min: 1, max: 5 },
    // Twice-daily heart rate (bpm). Each measurement keeps its own timestamp,
    // since they're taken at different times of day (before bed / on waking).
    bedHrBpm: { type: Number, min: 25, max: 220 },
    bedHrAt: { type: Date },
    wakeHrBpm: { type: Number, min: 25, max: 220 },
    wakeHrAt: { type: Date },
    note: { type: String },
  },
  { timestamps: true }
);

wellnessSchema.index({ athleteId: 1, date: -1 }, { unique: true });

export type WellnessDoc = InferSchemaType<typeof wellnessSchema> & {
  _id: Types.ObjectId;
};
export const Wellness: Model<WellnessDoc> = model<WellnessDoc>(
  "Wellness",
  wellnessSchema
);
