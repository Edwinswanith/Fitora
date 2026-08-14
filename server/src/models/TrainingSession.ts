import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

// Ordered through the day: AM → Afternoon → PM. Order matters for sorting,
// display, and "latest session" logic — use SESSION_SLOT_ORDER, never the raw
// alphabetical string order (which would mis-sort "AFT" before "AM").
export const SESSION_SLOTS = ["AM", "AFT", "PM"] as const;
export type SessionSlot = (typeof SESSION_SLOTS)[number];

export const SESSION_SLOT_LABELS: Record<SessionSlot, string> = {
  AM: "AM",
  AFT: "Afternoon",
  PM: "PM",
};

export const SESSION_SLOT_ORDER: Record<SessionSlot, number> = {
  AM: 0,
  AFT: 1,
  PM: 2,
};

/** Chronological comparator for slots (AM < AFT < PM). */
export function compareSlots(a: SessionSlot, b: SessionSlot): number {
  return SESSION_SLOT_ORDER[a] - SESSION_SLOT_ORDER[b];
}

export const SESSION_STATUS = [
  "planned",
  "in_progress",
  "completed",
  "skipped",
  "rest",
] as const;
export type SessionStatus = (typeof SESSION_STATUS)[number];

// Small image attachments alongside a session's notes (e.g. a photo of a
// whiteboard plan, an injury, form-check still). Raw bytes live on local disk
// under env.upload.dir, named by `storedFilename` — same secure pattern as
// WorkoutMedia (never the client's original filename, never statically
// served; every read goes through an authenticated, ownership-checked route).
// Unlike WorkoutMedia, these are visible to both coach and athlete immediately
// on upload — same as the shared, no-gate `notes` field they sit next to.
// storedFilename is a randomUUID()-generated name — already globally unique by
// construction, so no DB-level unique index here. A `unique: true` on a field
// nested in an array is a collection-wide index: Mongo indexes an empty
// `photos: []` as a null entry, so a second session with no photos would
// collide with the first under a unique constraint.
const sessionPhotoSchema = new Schema(
  {
    storedFilename: { type: String, required: true },
    originalName: { type: String, required: true, trim: true, maxlength: 255 },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true, min: 1 },
    uploadedAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

const trainingSessionSchema = new Schema(
  {
    athleteId: { type: Schema.Types.ObjectId, ref: "AthleteProfile", required: true },
    coachId: { type: Schema.Types.ObjectId, ref: "User" },
    date: { type: Date, required: true },
    slot: { type: String, enum: SESSION_SLOTS, required: true },
    type: { type: String },
    status: { type: String, enum: SESSION_STATUS, default: "planned" },
    plan: { type: Schema.Types.Mixed },
    durationMin: { type: Number },
    intensityRpe: { type: Number, min: 1, max: 100 },
    attended: { type: Boolean },
    workoutType: { type: String, trim: true },
    sets: { type: Number, min: 0 },
    reps: { type: String, trim: true },
    actualDurationMin: { type: Number, min: 0 },
    effortRating: { type: Number, min: 1, max: 10 },
    notes: { type: String },
    photos: { type: [sessionPhotoSchema], default: [] },
  },
  { timestamps: true }
);

trainingSessionSchema.index(
  { athleteId: 1, date: -1, slot: 1 },
  { unique: true }
);

export type TrainingSessionDoc = InferSchemaType<typeof trainingSessionSchema> & {
  _id: Types.ObjectId;
};
export const TrainingSession: Model<TrainingSessionDoc> = model<TrainingSessionDoc>(
  "TrainingSession",
  trainingSessionSchema
);
