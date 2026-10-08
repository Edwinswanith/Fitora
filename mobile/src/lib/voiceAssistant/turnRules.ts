// Pure helpers for the athlete voice assistant (useVoiceAssistant.ts), free of
// React/Expo imports so they can be unit tested.

/**
 * What to tell the athlete when a turn fails, by cause, instead of blaming
 * the network for everything (rate limit, server error and a client bug used
 * to all read "couldn't reach the server").
 */
export function turnFailureMessage(err: unknown): string {
  const status = typeof (err as { status?: unknown })?.status === "number" ? (err as { status: number }).status : null;
  if (status !== null) {
    if (status === 429) return "You're going a bit fast. Try again in a moment.";
    if (status === 401 || status === 403) return "Please sign in again to use the assistant.";
    if (status >= 500) return "Something went wrong on our side. Please try again.";
    return "I couldn't do that. Please try saying it another way.";
  }
  if (err instanceof TypeError || (err instanceof Error && /network|timeout|abort/i.test(err.message))) {
    return "Sorry, I couldn't reach the server. Check your connection and try again.";
  }
  return "Something went wrong. Please try again.";
}

/**
 * The idempotency key for a write: the same command (same intent and values)
 * keeps the same key across retries, so a save that committed on the server
 * but timed out on the phone is never stored twice. A different command
 * always gets a new key, so it can never be answered with an old result.
 */
export function actionKey(intent: string, entities: Record<string, unknown>): string {
  const sorted = Object.keys(entities)
    .sort()
    .map((key) => [key, entities[key]]);
  return JSON.stringify([intent, sorted]);
}

