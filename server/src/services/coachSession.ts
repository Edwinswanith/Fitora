import { Types, type HydratedDocument } from "mongoose";
import { CoachSession, type CoachSessionDoc, type CoachSessionType } from "../models/CoachSession";
import { CoachAthleteAssignment } from "../models/CoachAthleteAssignment";
import { findMatchingWindow } from "./coachAvailability";
import { checkSessionBookingEntitlement } from "./subscription";
import {
  createSessionWithLock,
  rescheduleSessionWithLock,
  closeSessionAndReleaseLocks,
  BookingConflictError,
} from "./bookingConcurrency";
import { getVideoProvider, roomNameForSession, type ParticipantRole, type IssuedToken } from "./videoProvider";

/**
 * Full date+time parser for booking timestamps — deliberately distinct from
 * lib/trainingCategories.ts's parseDateOrNull, which truncates to UTC
 * midnight (correct for date-only fields like scheduledDate, wrong here
 * since a session's actual clock time is the whole point).
 */
export function parseDateTimeOrNull(input: unknown): Date | null {
  if (typeof input !== "string" || !input) return null;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

export class CoachSessionError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type RequestSessionParams = {
  coachId: Types.ObjectId;
  athleteId: Types.ObjectId;
  relationshipId: Types.ObjectId;
  type: CoachSessionType;
  scheduledStart: Date;
  requestedBy: Types.ObjectId;
};

/** Athlete-initiated booking request — the concurrency-critical create path. */
export async function requestSession(params: RequestSessionParams): Promise<HydratedDocument<CoachSessionDoc>> {
  const entitlement = await checkSessionBookingEntitlement(params.athleteId, params.coachId);
  if (!entitlement.allowed) throw new CoachSessionError(403, entitlement.reason);

  const window = await findMatchingWindow(params.coachId, params.scheduledStart);
  if (!window) throw new CoachSessionError(422, "outside_availability");

  try {
    return await createSessionWithLock({
      coachId: params.coachId,
      athleteId: params.athleteId,
      relationshipId: params.relationshipId,
      type: params.type,
      scheduledStart: params.scheduledStart,
      scheduledEnd: window.scheduledEnd,
      bufferMin: window.bufferMin,
      requestedBy: params.requestedBy,
    });
  } catch (err) {
    if (err instanceof BookingConflictError) throw new CoachSessionError(409, "slot_conflict");
    throw err;
  }
}

/**
 * Once a coach/athlete relationship ends (coach removes the athlete, athlete
 * leaves, or either switches), neither party should still be able to
 * manage or join a straggler booking together — that would mean live
 * interaction (including video) between two people no longer in an active
 * coaching relationship. Checked before every action that grants NEW
 * capability (confirm, reschedule, complete, join-token); deliberately NOT
 * checked before cancel, which must always stay available to clean up a
 * stale booking regardless of relationship state.
 */
async function assertRelationshipStillActive(session: HydratedDocument<CoachSessionDoc>): Promise<void> {
  const relationship = await CoachAthleteAssignment.findById(session.relationshipId).select("status").lean();
  if (!relationship || relationship.status !== "active") {
    throw new CoachSessionError(409, "relationship_ended");
  }
}

export async function confirmSession(
  session: HydratedDocument<CoachSessionDoc>,
  actorId: Types.ObjectId
): Promise<HydratedDocument<CoachSessionDoc>> {
  if (session.status !== "requested") throw new CoachSessionError(409, "invalid_transition");
  await assertRelationshipStillActive(session);
  session.status = "confirmed";
  session.events.push({ at: new Date(), type: "confirmed", actorId });
  await session.save();
  return session;
}

/** Per the state machine, only a confirmed session can be rescheduled — it re-enters as confirmed with an event logged. */
export async function rescheduleSession(
  session: HydratedDocument<CoachSessionDoc>,
  newStart: Date,
  actorId: Types.ObjectId,
  note: string | undefined
): Promise<HydratedDocument<CoachSessionDoc>> {
  if (session.status !== "confirmed") throw new CoachSessionError(409, "invalid_transition");
  await assertRelationshipStillActive(session);

  const window = await findMatchingWindow(session.coachId as Types.ObjectId, newStart);
  if (!window) throw new CoachSessionError(422, "outside_availability");

  try {
    return await rescheduleSessionWithLock(session, newStart, window.scheduledEnd, actorId, note);
  } catch (err) {
    if (err instanceof BookingConflictError) throw new CoachSessionError(409, "slot_conflict");
    throw err;
  }
}

const CANCELLABLE_STATUSES: CoachSessionDoc["status"][] = ["requested", "confirmed", "rescheduled"];

/** Best-effort — cleanup must never block or fail the caller's actual state transition. */
async function terminateVideoRoomIfAny(session: HydratedDocument<CoachSessionDoc>): Promise<void> {
  if (!session.videoRoomRef) return;
  await getVideoProvider().terminateRoom(session.videoRoomRef).catch(() => undefined);
}

export async function cancelSession(
  session: HydratedDocument<CoachSessionDoc>,
  actorId: Types.ObjectId,
  note: string | undefined
): Promise<HydratedDocument<CoachSessionDoc>> {
  if (!CANCELLABLE_STATUSES.includes(session.status)) throw new CoachSessionError(409, "invalid_transition");
  const updated = await closeSessionAndReleaseLocks(session, "cancelled", "cancelled", actorId, note);
  await terminateVideoRoomIfAny(updated);
  return updated;
}

const COMPLETABLE_STATUSES: CoachSessionDoc["status"][] = ["confirmed", "rescheduled"];

export async function completeSession(
  session: HydratedDocument<CoachSessionDoc>,
  actorId: Types.ObjectId,
  summary: string | undefined,
  coachNotes: string | undefined
): Promise<HydratedDocument<CoachSessionDoc>> {
  if (!COMPLETABLE_STATUSES.includes(session.status)) throw new CoachSessionError(409, "invalid_transition");
  await assertRelationshipStillActive(session);
  if (summary !== undefined) session.summary = summary;
  if (coachNotes !== undefined) session.coachNotes = coachNotes;
  const updated = await closeSessionAndReleaseLocks(session, "completed", "completed", actorId);
  await terminateVideoRoomIfAny(updated);
  return updated;
}

// Join tokens are only issuable for a confirmed booking, within a window
// around the scheduled time — not the instant it's requested (unconfirmed),
// and not indefinitely after it ends.
const JOINABLE_STATUSES: CoachSessionDoc["status"][] = ["confirmed", "rescheduled"];
const JOIN_WINDOW_BEFORE_MIN = 10;
const JOIN_WINDOW_AFTER_MIN = 15;
const JOIN_TOKEN_TTL_SEC = 3 * 60 * 60;

/**
 * Issues a live-video join token for one of the session's two participants.
 * The video room itself is created lazily here (first join-token request),
 * not at booking time — see CoachSession.videoRoomRef.
 */
export async function issueJoinToken(
  session: HydratedDocument<CoachSessionDoc>,
  role: ParticipantRole,
  participantUserId: Types.ObjectId,
  participantName: string
): Promise<IssuedToken> {
  if (!JOINABLE_STATUSES.includes(session.status)) throw new CoachSessionError(409, "session_not_joinable");
  await assertRelationshipStillActive(session);

  const now = Date.now();
  const windowStartMs = session.scheduledStart.getTime() - JOIN_WINDOW_BEFORE_MIN * 60_000;
  const windowEndMs = session.scheduledEnd.getTime() + JOIN_WINDOW_AFTER_MIN * 60_000;
  if (now < windowStartMs || now > windowEndMs) throw new CoachSessionError(403, "outside_join_window");

  const provider = getVideoProvider();
  if (!session.videoRoomRef) {
    const { roomRef } = await provider.createRoom(roomNameForSession(session._id.toString()));
    session.videoRoomRef = roomRef;
    await session.save();
  }

  return provider.issueParticipantToken(session.videoRoomRef, `${role}:${participantUserId.toString()}`, participantName, JOIN_TOKEN_TTL_SEC);
}

export function serializeSession(session: HydratedDocument<CoachSessionDoc>, viewerRole: "coach" | "athlete") {
  return {
    id: session._id.toString(),
    coachId: (session.coachId as Types.ObjectId).toString(),
    athleteId: (session.athleteId as Types.ObjectId).toString(),
    relationshipId: (session.relationshipId as Types.ObjectId).toString(),
    type: session.type,
    scheduledStart: session.scheduledStart,
    scheduledEnd: session.scheduledEnd,
    status: session.status,
    events: session.events,
    summary: session.summary ?? null,
    // Coach-private — never serialized to an athlete viewer, regardless of caller.
    coachNotes: viewerRole === "coach" ? (session.coachNotes ?? null) : undefined,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}
