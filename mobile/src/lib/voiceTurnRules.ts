// Pure rules for the voice conversation loop (lib/voiceSession.ts), kept free
// of Expo/React Native imports so they can be unit tested.

export const DEFAULT_SILENCE_TIMEOUT_MS = 10000;
export const DEFAULT_FOLLOW_UP_WINDOW_MS = 8000;
export const DEFAULT_MAX_EMPTY_LISTENS = 2;

/**
 * Whether the assistant should keep listening after speaking `reply`. Only a
 * reply that asks something ("How many calories?") opens a follow-up window;
 * anything else ends the conversation, so the mic never stays on by itself.
 */
export function shouldListenAfterReply(reply: string | null | undefined): boolean {
  return Boolean(reply && reply.trim().endsWith("?"));
}

/** Batch recorder end-of-speech tuning (dBFS from the recorder's meter). */
export const BATCH_SPEECH_DB = -42;
export const BATCH_END_SILENCE_MS = 1200;
export const BATCH_NO_SPEECH_MS = 8000;
export const BATCH_MAX_RECORDING_MS = 30000;

export type BatchEndpointState = { heardSpeech: boolean; lastSpeechAt: number; startedAt: number };

/**
 * Decides when a batch recording is finished from its meter readings:
 * "send" once speech was heard and then ~1.2 s of quiet followed, "no_speech"
 * if nobody spoke for 8 s, "max" at the hard cap. Pure so it can be tested.
 */
export function batchEndpoint(state: BatchEndpointState, meteringDb: number | undefined, now: number): { state: BatchEndpointState; decision: "continue" | "send" | "no_speech" | "max" } {
  const next = { ...state };
  if (typeof meteringDb === "number" && meteringDb > BATCH_SPEECH_DB) {
    next.heardSpeech = true;
    next.lastSpeechAt = now;
  }
  if (now - next.startedAt >= BATCH_MAX_RECORDING_MS) return { state: next, decision: next.heardSpeech ? "send" : "max" };
  if (next.heardSpeech && now - next.lastSpeechAt >= BATCH_END_SILENCE_MS) return { state: next, decision: "send" };
  if (!next.heardSpeech && now - next.startedAt >= BATCH_NO_SPEECH_MS) return { state: next, decision: "no_speech" };
  return { state: next, decision: "continue" };
}

