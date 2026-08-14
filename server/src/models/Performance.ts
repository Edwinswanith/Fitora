import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

const performanceSchema = new Schema(
  {
    athleteId: { type: Schema.Types.ObjectId, ref: "AthleteProfile", required: true },
    date: { type: Date, required: true },
    metric: { type: String, required: true },
    value: { type: Number, required: true },
    unit: { type: String, required: true },
    context: { type: String },
  },
  { timestamps: true }
);

performanceSchema.index({ athleteId: 1, metric: 1, date: -1 });
performanceSchema.index({ athleteId: 1, date: -1 });

export type PerformanceDoc = InferSchemaType<typeof performanceSchema> & {
  _id: Types.ObjectId;
};
export const Performance: Model<PerformanceDoc> = model<PerformanceDoc>(
  "Performance",
  performanceSchema
);
