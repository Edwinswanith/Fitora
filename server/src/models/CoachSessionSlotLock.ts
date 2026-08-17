import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

/**
 * The actual double-booking guard — not the read-then-insert-if-no-overlap
 * check alone, which MongoDB's snapshot-isolated transactions do NOT
 * serialize (two concurrent transactions inserting two different NEW
 * CoachSession documents for overlapping times never touch the same
 * document, so there is no write conflict for MongoDB to detect and reject).
 *
 * Instead, booking a session also inserts one lock row per 5-minute bucket
 * the session (plus its buffer) occupies for that coach — see
 * SLOT_BUCKET_MINUTES / computeBuckets in services/bookingConcurrency.ts.
 * The unique index below is what makes two overlapping bookings for the
 * same coach genuinely impossible at the DB layer: a second booking whose
 * buckets intersect the first's hits E11000 on the very first colliding
 * insert, and (inside the transaction the insert runs in) the whole booking
 * attempt rolls back cleanly.
 */
const coachSessionSlotLockSchema = new Schema(
  {
    coachId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    bucketStart: { type: Date, required: true },
    sessionId: { type: Schema.Types.ObjectId, ref: "CoachSession", required: true },
  },
  { timestamps: true }
);

coachSessionSlotLockSchema.index({ coachId: 1, bucketStart: 1 }, { unique: true });
coachSessionSlotLockSchema.index({ sessionId: 1 });

export type CoachSessionSlotLockDoc = InferSchemaType<typeof coachSessionSlotLockSchema> & {
  _id: Types.ObjectId;
};
export const CoachSessionSlotLock: Model<CoachSessionSlotLockDoc> = model<CoachSessionSlotLockDoc>(
  "CoachSessionSlotLock",
  coachSessionSlotLockSchema
);
