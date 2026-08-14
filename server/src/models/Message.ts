import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

/**
 * One direct message in a coach⇄athlete conversation.
 *
 * The conversation itself is identified by the pair `(coachId, athleteId)` — no
 * separate Conversation document. This keeps the coach-scope invariant trivial:
 * every message is bound to a specific coach AND a specific athlete profile, so
 * a coach can only ever read/write threads for athletes assigned to them and an
 * athlete can only ever reach coaches assigned to them (the routes enforce both
 * before any write).
 *
 * `senderRole` says who authored it; the *recipient* is therefore the other
 * party. A message is unread by its recipient while `readAt` is null — so a
 * coach's unread count in a thread is `senderRole: "athlete", readAt: null`, and
 * an athlete's is `senderRole: "coach", readAt: null`.
 */
export const MESSAGE_SENDER_ROLES = ["coach", "athlete"] as const;
export type MessageSenderRole = (typeof MESSAGE_SENDER_ROLES)[number];

const messageSchema = new Schema(
  {
    coachId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    athleteId: { type: Schema.Types.ObjectId, ref: "AthleteProfile", required: true },
    senderRole: { type: String, enum: MESSAGE_SENDER_ROLES, required: true },
    /** Optional when `mediaId` is set — an image can be sent with no caption. */
    body: { type: String, default: "", trim: true, maxlength: 4000 },
    /** Set when this message is a coach-shared image (see WorkoutMedia). */
    mediaId: { type: Schema.Types.ObjectId, ref: "WorkoutMedia", default: null },
    /** Set when the recipient (the non-sender) has read it; null = unread. */
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Thread history (newest-first) for a given coach⇄athlete pair.
messageSchema.index({ coachId: 1, athleteId: 1, createdAt: -1 });
// Fast unread scans per recipient side.
messageSchema.index({ coachId: 1, athleteId: 1, senderRole: 1, readAt: 1 });

export type MessageDoc = InferSchemaType<typeof messageSchema> & {
  _id: Types.ObjectId;
};
export const Message: Model<MessageDoc> = model<MessageDoc>("Message", messageSchema);
