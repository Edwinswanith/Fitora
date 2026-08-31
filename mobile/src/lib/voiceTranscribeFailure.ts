/**
 * Distinguishes "the provider/service is unavailable right now" (Deepgram
 * unconfigured/down) from "you just didn't say anything clear" (empty/
 * garbled audio) for a /api/voice/transcribe response. Only the former
 * should push the user to the text-input fallback — the latter should just
 * let them try speaking again. Kept in its own pure module (no RN/Expo
 * imports) so it can be unit tested directly, unlike voiceSession.ts itself
 * which uses browser/RN-only APIs the isolated jest tsconfig can't compile.
 */
export function isSystemicTranscribeFailure(status: number, errorCode: string | undefined): boolean {
  return errorCode === "deepgram_not_configured" || status === 502;
}
