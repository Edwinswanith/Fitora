import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

const academySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    timezone: { type: String, default: "UTC" },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export type AcademyDoc = InferSchemaType<typeof academySchema> & { _id: Types.ObjectId };
export const Academy: Model<AcademyDoc> = model<AcademyDoc>("Academy", academySchema);
