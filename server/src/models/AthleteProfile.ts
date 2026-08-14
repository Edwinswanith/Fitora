import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

const athleteProfileSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    academyId: { type: Schema.Types.ObjectId, ref: "Academy", index: true },
    dob: { type: Date },
    sport: { type: String, required: true, index: true },
    position: { type: String },
    heightCm: { type: Number },
    weightKg: { type: Number },
    timezone: { type: String, default: "UTC" },
    /** Daily hydration target in millilitres (progress is measured against this). */
    hydrationGoalMl: { type: Number, default: 3000, min: 500, max: 8000 },
  },
  { timestamps: true }
);

export type AthleteProfileDoc = InferSchemaType<typeof athleteProfileSchema> & {
  _id: Types.ObjectId;
};
export const AthleteProfile: Model<AthleteProfileDoc> = model<AthleteProfileDoc>(
  "AthleteProfile",
  athleteProfileSchema
);
