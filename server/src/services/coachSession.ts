import { Types, type HydratedDocument } from "mongoose";
import { CoachSession, type CoachSessionDoc, type CoachSessionType } from "../models/CoachSession";
import { findMatchingWindow } from "./coachAvailability";
import { checkSessionBookingEntitlement } from "./subscription";
import {
  createSessionWithLock,
  rescheduleSessionWithLock,
  closeSessionAndReleaseLocks,
  BookingConflictError,
} from "./bookingConcurrency";

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

export async function confirmSession(
  session: HydratedDocument<CoachSessionDoc>,
  actorId: Types.ObjectId
): Promise<HydratedDocument<CoachSessionDoc>> {
  if (session.status !== "requested") throw new CoachSessionError(409, "invalid_transition");
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

export async function cancelSession(
  session: HydratedDocument<CoachSessionDoc>,
  actorId: Types.ObjectId,
  note: string | undefined
): Promise<HydratedDocument<CoachSessionDoc>> {
  if (!CANCELLABLE_STATUSES.includes(session.status)) throw new CoachSessionError(409, "invalid_transition");
  return closeSessionAndReleaseLocks(session, "cancelled", "cancelled", actorId, note);
}

const COMPLETABLE_STATUSES: CoachSessionDoc["status"][] = ["confirmed", "rescheduled"];

export async function completeSession(
  session: HydratedDocument<CoachSessionDoc>,
  actorId: Types.ObjectId,
  summary: string | undefined,
  coachNotes: string | undefined
): Promise<HydratedDocument<CoachSessionDoc>> {
  if (!COMPLETABLE_STATUSES.includes(session.status)) throw new CoachSessionError(409, "invalid_transition");
  if (summary !== undefined) session.summary = summary;
  if (coachNotes !== undefined) session.coachNotes = coachNotes;
  return closeSessionAndReleaseLocks(session, "completed", "completed", actorId);
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
