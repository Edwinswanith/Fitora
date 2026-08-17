import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

export const COACH_SESSION_TYPES = [
  "progress_review",
  "workout_guidance",
  "nutrition_review",
  "form_check",
  "consultation",
  "general",
] as const;
export type CoachSessionType = (typeof COACH_SESSION_TYPES)[number];

export const COACH_SESSION_STATUSES = [
  "requested",
  "confirmed",
  "rescheduled",
  "cancelled",
  "completed",
  "missed",
] as const;
export type CoachSessionStatus = (typeof COACH_SESSION_STATUSES)[number];

export const COACH_SESSION_EVENT_TYPES = [
  "requested",
  "confirmed",
  "rescheduled",
  "cancelled",
  "completed",
  "missed_by_system",
] as const;
export type CoachSessionEventType = (typeof COACH_SESSION_EVENT_TYPES)[number];

const coachSessionEventSchema = new Schema(
  {
    at: { type: Date, default: () => new Date() },
    type: { type: String, enum: COACH_SESSION_EVENT_TYPES, required: true },
    previousStart: { type: Date, default: null },
    previousEnd: { type: Date, default: null },
    actorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    note: { type: String, trim: true, maxlength: 500 },
  },
  { _id: false }
);

/**
 * A booked coaching session between an active coach/athlete pair. One
 * document IS the current booking state — a reschedule mutates
 * scheduledStart/End in place and appends to `events` rather than creating a
 * new linked row, since there is exactly one "current" state a UI ever needs
 * to show and a handful of embedded events is enough audit trail (no
 * separate CoachSessionEvent collection).
 *
 * `bufferMin` is snapshotted from the CoachAvailability rule in effect at
 * booking time — services/bookingConcurrency.ts needs the exact buffer that
 * was used to compute this session's lock buckets so a later cancel/
 * reschedule releases exactly the buckets that were actually acquired, even
 * if the coach's availability rule (and its buffer) changes afterward.
 *
 * `coachNotes` is coach-private (never serialized to the athlete);
 * `summary` is the athlete-visible post-session note — deliberately two
 * separate fields, not a single note field with a visibility flag, so a
 * serializer bug can't accidentally leak private notes by omitting a filter.
 */
const coachSessionSchema = new Schema(
  {
    coachId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    athleteId: { type: Schema.Types.ObjectId, ref: "AthleteProfile", required: true },
    relationshipId: { type: Schema.Types.ObjectId, ref: "CoachAthleteAssignment", required: true },
    type: { type: String, enum: COACH_SESSION_TYPES, required: true },
    scheduledStart: { type: Date, required: true },
    scheduledEnd: { type: Date, required: true },
    bufferMin: { type: Number, required: true, min: 0, max: 120 },
    status: { type: String, enum: COACH_SESSION_STATUSES, default: "requested" },
    events: { type: [coachSessionEventSchema], default: [] },
    coachNotes: { type: String, trim: true, maxlength: 2000 },
    summary: { type: String, trim: true, maxlength: 2000 },
  },
  { timestamps: true }
);

coachSessionSchema.index({ coachId: 1, scheduledStart: 1 });
coachSessionSchema.index({ athleteId: 1, scheduledStart: 1 });

export type CoachSessionEventDoc = InferSchemaType<typeof coachSessionEventSchema>;
export type CoachSessionDoc = InferSchemaType<typeof coachSessionSchema> & {
  _id: Types.ObjectId;
};
export const CoachSession: Model<CoachSessionDoc> = model<CoachSessionDoc>("CoachSession", coachSessionSchema);
