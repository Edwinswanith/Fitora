import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

/**
 * A coach broadcast: one message posted once and shown to all of that coach's
 * currently-assigned athletes (and their guardians). Distinct from CoachComment,
 * which is a private one-to-one note on a single athlete. Visibility is resolved
 * at read time from CoachAthleteAssignment (by coachId), so it always reflects
 * the coach's current squad without snapshotting a recipient list.
 */
const announcementSchema = new Schema(
  {
    coachId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    academyId: { type: Schema.Types.ObjectId, ref: "Academy", default: null },
    body: { type: String, required: true, trim: true, maxlength: 1000 },
    /** Recipient count at send time — for the coach's "sent to N" display. */
    recipientCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

announcementSchema.index({ coachId: 1, createdAt: -1 });

export type AnnouncementDoc = InferSchemaType<typeof announcementSchema> & {
  _id: Types.ObjectId;
};
export const Announcement: Model<AnnouncementDoc> = model<AnnouncementDoc>(
  "Announcement",
  announcementSchema
);
