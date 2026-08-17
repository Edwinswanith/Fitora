import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

/**
 * A coach's recurring weekly availability rule — "every Monday, 09:00-17:00
 * my own time, bookable in 30-minute slots with a 10-minute buffer." A coach
 * may have multiple rows for the same dayOfWeek (e.g. a morning block and an
 * evening block); `timezone` is the coach's own IANA zone, never assumed
 * from the athlete or the server — booking math always converts through it
 * (see services/timezone.ts zonedMinuteToUtc).
 */
const coachAvailabilitySchema = new Schema(
  {
    coachId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    dayOfWeek: { type: Number, required: true, min: 0, max: 6 },
    startMinute: { type: Number, required: true, min: 0, max: 1439 },
    endMinute: { type: Number, required: true, min: 1, max: 1440 },
    timezone: { type: String, required: true, default: "UTC" },
    sessionDurationMin: { type: Number, required: true, min: 5, max: 240, default: 30 },
    bufferMin: { type: Number, default: 0, min: 0, max: 120 },
  },
  { timestamps: true }
);

coachAvailabilitySchema.index({ coachId: 1, dayOfWeek: 1 });

export type CoachAvailabilityDoc = InferSchemaType<typeof coachAvailabilitySchema> & {
  _id: Types.ObjectId;
};
export const CoachAvailability: Model<CoachAvailabilityDoc> = model<CoachAvailabilityDoc>(
  "CoachAvailability",
  coachAvailabilitySchema
);
