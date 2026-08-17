import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

export const AVAILABILITY_EXCEPTION_TYPES = ["unavailable", "custom_hours"] as const;
export type AvailabilityExceptionType = (typeof AVAILABILITY_EXCEPTION_TYPES)[number];

/**
 * A one-off override for a specific calendar date, layered on top of the
 * coach's recurring CoachAvailability rules. `date` is UTC-midnight-anchored
 * (same "date-only" convention as WorkoutAssignment.scheduledDate /
 * MealPlanAssignment.startDate elsewhere in this codebase) — one row per
 * (coach, date), enforced by the unique index, so a date has exactly one
 * override rather than needing a merge-order policy across multiple rows.
 *
 * `type: "unavailable"` with no startMinute/endMinute blocks the whole day;
 * WITH a range, only that sub-range is subtracted from the day's normal
 * recurring windows. `type: "custom_hours"` (startMinute/endMinute required)
 * entirely REPLACES the day's recurring rules — "I'm working different
 * hours today," not an addition to the usual schedule.
 */
const coachAvailabilityExceptionSchema = new Schema(
  {
    coachId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    date: { type: Date, required: true },
    type: { type: String, enum: AVAILABILITY_EXCEPTION_TYPES, required: true },
    startMinute: { type: Number, min: 0, max: 1439, default: null },
    endMinute: { type: Number, min: 1, max: 1440, default: null },
    reason: { type: String, trim: true, maxlength: 300 },
  },
  { timestamps: true }
);

coachAvailabilityExceptionSchema.index({ coachId: 1, date: 1 }, { unique: true });

export type CoachAvailabilityExceptionDoc = InferSchemaType<typeof coachAvailabilityExceptionSchema> & {
  _id: Types.ObjectId;
};
export const CoachAvailabilityException: Model<CoachAvailabilityExceptionDoc> = model<CoachAvailabilityExceptionDoc>(
  "CoachAvailabilityException",
  coachAvailabilityExceptionSchema
);
