// How the coach assistant treats a pending confirmation ("Send this
// announcement to the squad?"). A confirmation only lives for a short time,
// only an explicit yes/no answers it, and anything else drops it, so a stale
// announcement can never be broadcast by an unrelated later sentence.

export const COACH_PENDING_TTL_MS = 60_000;

const CONFIRM = /^(yes|yeah|yep|confirm|send it|do it|save it|go ahead)\b/;
const CANCEL = /^(no|nope|cancel|stop|never mind|dont|don't)\b/;

export type PendingReply = "confirm" | "cancel" | "expired" | "other";

/** `lower` is the normalised (lower-case, trimmed) utterance. */
export function classifyPendingReply(lower: string, pendingAt: number, now: number = Date.now()): PendingReply {
  if (now - pendingAt > COACH_PENDING_TTL_MS) return "expired";
  if (CONFIRM.test(lower)) return "confirm";
  if (CANCEL.test(lower)) return "cancel";
  return "other";
}

/** Per-user storage key for the coach assistant's chat memory (never shared between accounts). */
export const COACH_AGENT_MEMORY_PREFIX = "scp.coach.askAgent.memory";
export function coachAgentMemoryKey(userId: string | null | undefined): string {
  return `${COACH_AGENT_MEMORY_PREFIX}:${userId ?? "anonymous"}`;
}
