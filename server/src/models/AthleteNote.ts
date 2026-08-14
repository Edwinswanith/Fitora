import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

const athleteNoteSchema = new Schema(
  {
    athleteId: { type: Schema.Types.ObjectId, ref: "AthleteProfile", required: true },
    date: { type: Date, required: true },
    body: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

athleteNoteSchema.index({ athleteId: 1, date: -1 });

export type AthleteNoteDoc = InferSchemaType<typeof athleteNoteSchema> & {
  _id: Types.ObjectId;
};
export const AthleteNote: Model<AthleteNoteDoc> = model<AthleteNoteDoc>(
  "AthleteNote",
  athleteNoteSchema
);
