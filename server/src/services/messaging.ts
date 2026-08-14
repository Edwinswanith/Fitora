import { Types } from "mongoose";
import { Message, type MessageDoc, type MessageSenderRole } from "../models/Message";
import { AthleteProfile } from "../models/AthleteProfile";
import { User } from "../models/User";
import { WorkoutMedia, type WorkoutMediaDoc } from "../models/WorkoutMedia";
import { serializeMedia, type MediaView } from "./media";
import { createNotification } from "./notifications";
import { evaluateAndDispatch } from "./notificationEligibility";
import { resolveTimezoneForUser } from "./timezone";
import { notificationPreview } from "./notificationCopy";

/** Shape returned to the client for one message. `mine` is viewer-relative. */
export type MessageView = {
  id: string;
  body: string;
  senderRole: MessageSenderRole;
  mine: boolean;
  read: boolean;
  createdAt: string;
  /** Present when this message is a coach-shared image (see WorkoutMedia). */
  media: MediaView | null;
};

/** Builds the client-facing view for one message given its (already-resolved) media doc, if any. */
export function messageView(
  m: MessageDoc,
  viewerRole: MessageSenderRole,
  media: WorkoutMediaDoc | null
): MessageView {
  return {
    id: m._id.toString(),
    body: m.body,
    senderRole: m.senderRole as MessageSenderRole,
    mine: m.senderRole === viewerRole,
    read: m.readAt != null,
    createdAt: (m.createdAt as Date).toISOString(),
    media: media ? serializeMedia(media) : null,
  };
}

function serializeMessage(
  m: MessageDoc,
  viewerRole: MessageSenderRole,
  mediaById: Map<string, WorkoutMediaDoc>
): MessageView {
  const mediaId = (m.mediaId as Types.ObjectId | null | undefined)?.toString();
  const media = mediaId ? mediaById.get(mediaId) ?? null : null;
  return messageView(m, viewerRole, media);
}

/** Batch-loads the WorkoutMedia docs referenced by a page of messages. */
async function loadMediaFor(rows: MessageDoc[]): Promise<Map<string, WorkoutMediaDoc>> {
  const ids = rows
    .map((r) => (r.mediaId as Types.ObjectId | null | undefined)?.toString())
    .filter((id): id is string => Boolean(id));
  if (ids.length === 0) return new Map();
  const docs = await WorkoutMedia.find({ _id: { $in: ids } }).lean<WorkoutMediaDoc[]>();
  return new Map(docs.map((d) => [d._id.toString(), d]));
}

export function clampMsgLimit(raw: unknown, fallback = 30, max = 100): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), 1), max);
}

/**
 * Fetch one coach⇄athlete thread, newest-first, optionally paged with `before`
 * (an ISO timestamp — returns messages strictly older than it). Returned in
 * chronological (oldest-first) order so clients can append directly.
 */
export async function fetchThread(args: {
  coachId: Types.ObjectId;
  athleteId: Types.ObjectId;
  viewerRole: MessageSenderRole;
  before?: Date;
  limit: number;
}): Promise<{ messages: MessageView[]; hasMore: boolean }> {
  const filter: Record<string, unknown> = {
    coachId: args.coachId,
    athleteId: args.athleteId,
  };
  if (args.before) filter.createdAt = { $lt: args.before };

  // Pull limit+1 newest to detect whether an older page exists.
  const rows = await Message.find(filter)
    .sort({ createdAt: -1 })
    .limit(args.limit + 1)
    .lean<MessageDoc[]>();

  const hasMore = rows.length > args.limit;
  const page = hasMore ? rows.slice(0, args.limit) : rows;
  page.reverse(); // chronological
  const mediaById = await loadMediaFor(page);
  return {
    messages: page.map((m) => serializeMessage(m, args.viewerRole, mediaById)),
    hasMore,
  };
}

/**
 * Create a message and fire one in-app notification to the recipient. Best-effort
 * notification (never throws). Returns the persisted message plus its resolved
 * media doc (if `mediaId` was given), so callers can build the view without a
 * second lookup.
 */
export async function sendMessage(args: {
  coachId: Types.ObjectId;
  athleteId: Types.ObjectId;
  senderRole: MessageSenderRole;
  body?: string;
  mediaId?: Types.ObjectId;
}): Promise<{ message: MessageDoc; media: WorkoutMediaDoc | null }> {
  const body = args.body?.trim() ?? "";
  const media = args.mediaId
    ? await WorkoutMedia.findById(args.mediaId).lean<WorkoutMediaDoc>()
    : null;

  const created = await Message.create({
    coachId: args.coachId,
    athleteId: args.athleteId,
    senderRole: args.senderRole,
    body,
    mediaId: args.mediaId ?? null,
  });

  const notifBody = body ? notificationPreview(body) : media ? "Sent an image. Tap to view it." : "";

  // Resolve the recipient user + a friendly sender name for the notification.
  if (args.senderRole === "coach") {
    const [profile, coach] = await Promise.all([
      AthleteProfile.findById(args.athleteId).select("userId academyId").lean(),
      User.findById(args.coachId).select("name").lean(),
    ]);
    if (profile?.userId) {
      const recipientUserId = profile.userId as Types.ObjectId;
      const academyId = (profile.academyId as Types.ObjectId | undefined) ?? null;
      const title = `New message from ${(coach?.name as string) || "your coach"}`;
      const link = `/athlete/dashboard?section=coach&coachId=${args.coachId.toString()}`;
      await createNotification({
        recipientUserId,
        type: "message",
        title,
        body: notifBody,
        priority: "medium",
        link,
        academyId,
      });
      const timezone = await resolveTimezoneForUser({ userId: recipientUserId, role: "athlete" });
      await evaluateAndDispatch(
        {
          userId: recipientUserId,
          type: "message",
          category: "messages",
          priorityTier: 2,
          dedupKey: `message:${created._id.toString()}`,
          title,
          body: notifBody,
          link,
          academyId,
          entityRef: { collection: "Message", id: created._id as Types.ObjectId },
          timezone,
        },
        { createInAppNotification: false }
      );
    }
  } else {
    const profile = await AthleteProfile.findById(args.athleteId)
      .select("userId academyId")
      .lean();
    const [athleteUser, coachDoc] = await Promise.all([
      profile?.userId ? User.findById(profile.userId).select("name").lean() : null,
      User.findById(args.coachId).select("academyId").lean(),
    ]);
    const academyId = (profile?.academyId as Types.ObjectId | undefined) ?? null;
    const title = `New message from ${(athleteUser?.name as string) || "your athlete"}`;
    const link = `/coach/messages?athleteId=${args.athleteId.toString()}`;
    await createNotification({
      recipientUserId: args.coachId,
      type: "message",
      title,
      body: notifBody,
      priority: "medium",
      link,
      academyId,
    });
    const timezone = await resolveTimezoneForUser({
      userId: args.coachId,
      role: "coach",
      academyId: (coachDoc?.academyId as Types.ObjectId | undefined) ?? null,
    });
    await evaluateAndDispatch(
      {
        userId: args.coachId,
        type: "message",
        category: "messages",
        priorityTier: 2,
        dedupKey: `message:${created._id.toString()}`,
        title,
        body: notifBody,
        link,
        academyId,
        entityRef: { collection: "Message", id: created._id as Types.ObjectId },
        timezone,
      },
      { createInAppNotification: false }
    );
  }

  return { message: created, media };
}

/**
 * Mark every message the OTHER party sent in this thread as read. `readerRole`
 * is the role of the actor doing the reading, so a coach reading marks the
 * athlete-authored messages, and vice-versa. Returns how many were updated.
 */
export async function markThreadRead(args: {
  coachId: Types.ObjectId;
  athleteId: Types.ObjectId;
  readerRole: MessageSenderRole;
}): Promise<number> {
  const otherRole: MessageSenderRole = args.readerRole === "coach" ? "athlete" : "coach";
  const res = await Message.updateMany(
    {
      coachId: args.coachId,
      athleteId: args.athleteId,
      senderRole: otherRole,
      readAt: null,
    },
    { $set: { readAt: new Date() } }
  );
  return res.modifiedCount ?? 0;
}

/** Per-thread unread count for the reader (messages the other party sent). */
async function unreadFor(
  coachId: Types.ObjectId,
  athleteId: Types.ObjectId,
  readerRole: MessageSenderRole
): Promise<number> {
  const otherRole: MessageSenderRole = readerRole === "coach" ? "athlete" : "coach";
  return Message.countDocuments({ coachId, athleteId, senderRole: otherRole, readAt: null });
}

export type ThreadSummary = {
  /** The OTHER party's id: athleteId for a coach viewer, coachId for an athlete. */
  partyId: string;
  partyName: string;
  lastMessage: string;
  lastAt: string;
  lastSenderRole: MessageSenderRole;
  unreadCount: number;
};

/** Thread list for a coach across the given assigned athletes (most-recent first). */
export async function buildCoachThreads(
  coachId: Types.ObjectId,
  assignedAthleteIds: Types.ObjectId[]
): Promise<ThreadSummary[]> {
  if (assignedAthleteIds.length === 0) return [];
  const lasts = await latestPerAthlete(coachId, assignedAthleteIds);
  if (lasts.length === 0) return [];

  const profiles = await AthleteProfile.find({ _id: { $in: lasts.map((l) => l.athleteId) } })
    .select("_id userId")
    .lean();
  const users = await User.find({ _id: { $in: profiles.map((p) => p.userId) } })
    .select("_id name")
    .lean();
  const nameByUser = new Map(users.map((u) => [u._id.toString(), u.name as string]));
  const nameByAthlete = new Map(
    profiles.map((p) => [p._id.toString(), nameByUser.get((p.userId as Types.ObjectId).toString()) ?? "Athlete"])
  );

  const summaries = await Promise.all(
    lasts.map(async (l) => ({
      partyId: l.athleteId.toString(),
      partyName: nameByAthlete.get(l.athleteId.toString()) ?? "Athlete",
      lastMessage: l.body,
      lastAt: l.createdAt.toISOString(),
      lastSenderRole: l.senderRole,
      unreadCount: await unreadFor(coachId, l.athleteId, "coach"),
    }))
  );
  return summaries;
}

/** Thread list for an athlete across the given assigned coaches (most-recent first). */
export async function buildAthleteThreads(
  athleteId: Types.ObjectId,
  coachIds: Types.ObjectId[]
): Promise<ThreadSummary[]> {
  if (coachIds.length === 0) return [];
  const lasts = await latestPerCoach(athleteId, coachIds);
  if (lasts.length === 0) return [];

  const coaches = await User.find({ _id: { $in: lasts.map((l) => l.coachId) } })
    .select("_id name")
    .lean();
  const nameByCoach = new Map(coaches.map((c) => [c._id.toString(), c.name as string]));

  return Promise.all(
    lasts.map(async (l) => ({
      partyId: l.coachId.toString(),
      partyName: nameByCoach.get(l.coachId.toString()) ?? "Coach",
      lastMessage: l.body,
      lastAt: l.createdAt.toISOString(),
      lastSenderRole: l.senderRole,
      unreadCount: await unreadFor(l.coachId, athleteId, "athlete"),
    }))
  );
}

type LastRow = {
  athleteId: Types.ObjectId;
  coachId: Types.ObjectId;
  body: string;
  senderRole: MessageSenderRole;
  createdAt: Date;
};

async function latestPerAthlete(
  coachId: Types.ObjectId,
  athleteIds: Types.ObjectId[]
): Promise<LastRow[]> {
  const rows = await Message.aggregate<LastRow>([
    { $match: { coachId, athleteId: { $in: athleteIds } } },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: "$athleteId",
        athleteId: { $first: "$athleteId" },
        coachId: { $first: "$coachId" },
        body: { $first: "$body" },
        senderRole: { $first: "$senderRole" },
        createdAt: { $first: "$createdAt" },
      },
    },
    { $sort: { createdAt: -1 } },
  ]);
  return rows;
}

async function latestPerCoach(
  athleteId: Types.ObjectId,
  coachIds: Types.ObjectId[]
): Promise<LastRow[]> {
  const rows = await Message.aggregate<LastRow>([
    { $match: { athleteId, coachId: { $in: coachIds } } },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: "$coachId",
        athleteId: { $first: "$athleteId" },
        coachId: { $first: "$coachId" },
        body: { $first: "$body" },
        senderRole: { $first: "$senderRole" },
        createdAt: { $first: "$createdAt" },
      },
    },
    { $sort: { createdAt: -1 } },
  ]);
  return rows;
}

/** Total unread messages across all of a coach's threads (for a global badge). */
export async function coachTotalUnread(
  coachId: Types.ObjectId,
  assignedAthleteIds: Types.ObjectId[]
): Promise<number> {
  if (assignedAthleteIds.length === 0) return 0;
  return Message.countDocuments({
    coachId,
    athleteId: { $in: assignedAthleteIds },
    senderRole: "athlete",
    readAt: null,
  });
}

/** Total unread messages across all of an athlete's coach threads. */
export async function athleteTotalUnread(athleteId: Types.ObjectId): Promise<number> {
  return Message.countDocuments({ athleteId, senderRole: "coach", readAt: null });
}
