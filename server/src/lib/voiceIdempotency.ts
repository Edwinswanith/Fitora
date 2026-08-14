import type { Types } from "mongoose";
import { VoiceActionReceipt } from "../models/VoiceActionReceipt";

const DUPLICATE_KEY_ERROR_CODE = 11000;

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === DUPLICATE_KEY_ERROR_CODE;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type IdempotentOutcome<T> = { result: T; duplicate: boolean };

/**
 * Server-side idempotency guard for voice-triggered append-only writes
 * (plan §6). Atomically claims `clientActionId` for this user via an insert
 * against VoiceActionReceipt's unique (userId, clientActionId) index; a
 * duplicate-key error means the action already ran (or is running), so the
 * cached result is returned instead of re-executing `handler`.
 *
 * This is a best-effort guard against a genuinely concurrent double-tap, not
 * a distributed lock — if the original request's handler hasn't finished
 * writing its result yet, a short bounded poll gives it a chance to land
 * before falling back to `duplicate: true, result: null`. The primary target
 * is retries after a client-perceived failure (app killed mid-request,
 * network retry logic) where the original call has long since completed —
 * the mobile-side execution lock is the first line of defense for the truly
 * simultaneous double-tap case.
 */
export async function withIdempotency<T>(
  userId: Types.ObjectId,
  clientActionId: string,
  route: string,
  handler: () => Promise<T>
): Promise<IdempotentOutcome<T>> {
  try {
    await VoiceActionReceipt.create({ userId, clientActionId, route, resultSummary: null });
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const existing = await VoiceActionReceipt.findOne({ userId, clientActionId }).lean();
      if (existing?.resultSummary !== null && existing?.resultSummary !== undefined) {
        return { result: existing.resultSummary as T, duplicate: true };
      }
      await sleep(150);
    }
    return { result: null as T, duplicate: true };
  }

  const result = await handler();
  await VoiceActionReceipt.updateOne({ userId, clientActionId }, { $set: { resultSummary: result } });
  return { result, duplicate: false };
}
