import mongoose, { Types, type ClientSession, type HydratedDocument } from "mongoose";
import { CoachSession, type CoachSessionDoc, type CoachSessionEventType } from "../models/CoachSession";
import { CoachSessionSlotLock } from "../models/CoachSessionSlotLock";
import { getVideoProvider } from "./videoProvider";

export class BookingConflictError extends Error {
  constructor() {
    super("slot_conflict");
  }
}

/** MongoMemoryServer (standalone, used by most test files) doesn't support transactions; Atlas (deployed) does. Same detection used by routes/athleteVoiceV2.ts. */
function isUnsupportedTransactionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /Transaction numbers are only allowed|IllegalOperation/i.test(msg);
}

/**
 * Runs `fn` inside a real Mongo transaction when the deployment supports one
 * (Atlas, any replica set); falls back to running it without a session on a
 * standalone dev mongod. The fallback loses atomicity (a mid-way failure can
 * leave partial state) but is only ever exercised on non-replica-set local
 * dev — production always runs against Atlas.
 */
export async function withOptionalTransaction<T>(fn: (session: ClientSession | null) => Promise<T>): Promise<T> {
  const mongoSession = await mongoose.startSession();
  try {
    let result: T | undefined;
    try {
      await mongoSession.withTransaction(async () => {
        result = await fn(mongoSession);
      });
    } catch (err) {
      if (isUnsupportedTransactionError(err)) {
        result = await fn(null);
      } else {
        throw err;
      }
    }
    return result as T;
  } finally {
    await mongoSession.endSession();
  }
}

export const SLOT_BUCKET_MINUTES = 5;

/** Bucket-start Dates (5-minute grid) covering [start - bufferMin, end + bufferMin). */
export function computeBuckets(start: Date, end: Date, bufferMin: number): Date[] {
  const bucketMs = SLOT_BUCKET_MINUTES * 60_000;
  const paddedStartMs = start.getTime() - bufferMin * 60_000;
  const paddedEndMs = end.getTime() + bufferMin * 60_000;
  const firstBucketMs = Math.floor(paddedStartMs / bucketMs) * bucketMs;
  const buckets: Date[] = [];
  for (let t = firstBucketMs; t < paddedEndMs; t += bucketMs) {
    buckets.push(new Date(t));
  }
  return buckets;
}

async function acquireLocks(
  coachId: Types.ObjectId,
  sessionId: Types.ObjectId,
  start: Date,
  end: Date,
  bufferMin: number,
  txnSession: ClientSession | null
): Promise<void> {
  const buckets = computeBuckets(start, end, bufferMin);
  const opts = txnSession ? { session: txnSession, ordered: true as const } : { ordered: true as const };
  try {
    await CoachSessionSlotLock.insertMany(
      buckets.map((bucketStart) => ({ coachId, bucketStart, sessionId })),
      opts
    );
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw new BookingConflictError();
    throw err;
  }
}

async function releaseLocks(sessionId: Types.ObjectId, txnSession: ClientSession | null): Promise<void> {
  const opts = txnSession ? { session: txnSession } : {};
  await CoachSessionSlotLock.deleteMany({ sessionId }, opts);
}

export type CreateSessionParams = {
  coachId: Types.ObjectId;
  athleteId: Types.ObjectId;
  relationshipId: Types.ObjectId;
  type: CoachSessionDoc["type"];
  scheduledStart: Date;
  scheduledEnd: Date;
  bufferMin: number;
  requestedBy: Types.ObjectId;
};

/**
 * Creates the CoachSession row and acquires its slot locks atomically — on
 * the transactional path, a lock conflict aborts the whole transaction so
 * the session document is never left behind; on the non-transactional
 * fallback (dev-only), a conflict triggers a manual compensating delete.
 */
export async function createSessionWithLock(params: CreateSessionParams): Promise<HydratedDocument<CoachSessionDoc>> {
  return withOptionalTransaction(async (txnSession) => {
    const opts = txnSession ? { session: txnSession } : undefined;
    const [session] = await CoachSession.create(
      [
        {
          coachId: params.coachId,
          athleteId: params.athleteId,
          relationshipId: params.relationshipId,
          type: params.type,
          scheduledStart: params.scheduledStart,
          scheduledEnd: params.scheduledEnd,
          bufferMin: params.bufferMin,
          status: "requested",
          events: [{ at: new Date(), type: "requested", actorId: params.requestedBy }],
        },
      ],
      opts
    );
    try {
      await acquireLocks(params.coachId, session._id, params.scheduledStart, params.scheduledEnd, params.bufferMin, txnSession);
    } catch (err) {
      if (!txnSession) {
        await CoachSession.deleteOne({ _id: session._id }).catch(() => undefined);
      }
      throw err;
    }
    return session;
  });
}

/** Releases the old slot locks and acquires new ones for the rescheduled range, atomically with the document update. */
export async function rescheduleSessionWithLock(
  session: HydratedDocument<CoachSessionDoc>,
  newStart: Date,
  newEnd: Date,
  actorId: Types.ObjectId,
  note?: string
): Promise<HydratedDocument<CoachSessionDoc>> {
  const previousStart = session.scheduledStart;
  const previousEnd = session.scheduledEnd;
  await withOptionalTransaction(async (txnSession) => {
    await releaseLocks(session._id, txnSession);
    await acquireLocks(session.coachId as Types.ObjectId, session._id, newStart, newEnd, session.bufferMin, txnSession);
    session.scheduledStart = newStart;
    session.scheduledEnd = newEnd;
    session.status = "confirmed";
    session.events.push({ at: new Date(), type: "rescheduled", previousStart, previousEnd, actorId, note });
    await session.save(txnSession ? { session: txnSession } : undefined);
  });
  return session;
}

/** Ends the session (cancel/complete/missed) and frees its slot locks atomically. */
export async function closeSessionAndReleaseLocks(
  session: HydratedDocument<CoachSessionDoc>,
  status: Extract<CoachSessionDoc["status"], "cancelled" | "completed" | "missed">,
  eventType: CoachSessionEventType,
  actorId: Types.ObjectId,
  note?: string
): Promise<HydratedDocument<CoachSessionDoc>> {
  await withOptionalTransaction(async (txnSession) => {
    await releaseLocks(session._id, txnSession);
    session.status = status;
    session.events.push({ at: new Date(), type: eventType, actorId, note });
    await session.save(txnSession ? { session: txnSession } : undefined);
  });
  return session;
}

/**
 * Cancels every still-open (requested/confirmed/rescheduled) CoachSession for
 * a relationship and releases their slot locks — used when a coach/athlete
 * relationship ends (Phase 12), so a straggler booking never keeps its slot
 * locked against the coach's real availability once the relationship that
 * authorized it no longer exists. Deliberately not scoped to "future only":
 * any non-terminal session for the relationship is closed regardless of
 * scheduledStart, since a non-terminal-but-past session is itself a data
 * anomaly this cleanup should also resolve, not leave behind. Runs inside one
 * transaction (or the sequential dev fallback) so a partial failure can't
 * leave some sessions cancelled and others still holding a lock. Idempotent:
 * calling this twice for the same relationship finds nothing left to do the
 * second time, since the query only matches non-terminal statuses.
 */
export async function cancelOpenSessionsForRelationship(
  relationshipId: Types.ObjectId,
  actorId: Types.ObjectId,
  note: string
): Promise<HydratedDocument<CoachSessionDoc>[]> {
  return withOptionalTransaction(async (txnSession) => {
    const query = CoachSession.find({
      relationshipId,
      status: { $in: ["requested", "confirmed", "rescheduled"] },
    });
    const sessions = txnSession ? await query.session(txnSession) : await query;
    const closed: HydratedDocument<CoachSessionDoc>[] = [];
    for (const session of sessions) {
      await releaseLocks(session._id, txnSession);
      session.status = "cancelled";
      session.events.push({ at: new Date(), type: "cancelled", actorId, note });
      await session.save(txnSession ? { session: txnSession } : undefined);
      closed.push(session);
    }
    return closed;
  });
}

/**
 * Same as cancelOpenSessionsForRelationship, plus best-effort live-video-room
 * teardown for anything that had one — the combined operation used by
 * coachRelationship.ts (endRelationship / a completed coach switch) so
 * neither caller needs its own import of services/coachSession.ts (which
 * itself imports services/subscription.ts, and subscription.ts is one of the
 * two callers here — importing coachSession.ts from either would be
 * circular). Video teardown failures are swallowed, matching
 * coachSession.ts's own terminateVideoRoomIfAny.
 */
export async function cancelOpenSessionsAndVideoRoomsForRelationship(
  relationshipId: Types.ObjectId,
  actorId: Types.ObjectId,
  note: string
): Promise<HydratedDocument<CoachSessionDoc>[]> {
  const closed = await cancelOpenSessionsForRelationship(relationshipId, actorId, note);
  await Promise.all(
    closed
      .filter((s) => s.videoRoomRef)
      .map((s) => getVideoProvider().terminateRoom(s.videoRoomRef as string).catch(() => undefined))
  );
  return closed;
}
