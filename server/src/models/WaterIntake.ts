import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

/**
 * A single water-intake log. Unlike most daily collections (one upserted row per
 * day), hydration is logged MANY times a day, so this is append-only: one
 * document per sip/bottle. `date` is the UTC day it counts toward (for daily
 * totals + trends); `loggedAt` is the exact moment it was recorded.
 */
const waterIntakeSchema = new Schema(
  {
    athleteId: { type: Schema.Types.ObjectId, ref: "AthleteProfile", required: true },
    date: { type: Date, required: true },
    amountMl: { type: Number, required: true, min: 1, max: 4000 },
    loggedAt: { type: Date, required: true },
  },
  { timestamps: true }
);

// Daily lookups + newest-first within a day.
waterIntakeSchema.index({ athleteId: 1, date: -1, loggedAt: -1 });

export type WaterIntakeDoc = InferSchemaType<typeof waterIntakeSchema> & {
  _id: Types.ObjectId;
};
export const WaterIntake: Model<WaterIntakeDoc> = model<WaterIntakeDoc>(
  "WaterIntake",
  waterIntakeSchema
);
