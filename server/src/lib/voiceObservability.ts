/**
 * Structured logging for the voice pipeline (STT stream/upload, TTS, NLU
 * interpret, confirmed-write execution). Follows this codebase's existing
 * console.log("[module] ...") convention (see db-integrity-audit.ts,
 * objectStorage.ts) rather than introducing a logging library — the only
 * addition is a consistent field shape so voice events are greppable
 * ("[voice:interpret]") and comparable across stages by latencyMs/outcome.
 *
 * Never pass transcript text, entity values, or any other user-authored
 * content here — VoicePendingState's doc comment states raw transcript text
 * is deliberately the ONLY place user speech is ever persisted in this app;
 * logging it elsewhere would quietly violate that. Stick to counts,
 * lengths, categorical fields (intent name, language code, status), and
 * timing.
 */
export function logVoiceEvent(stage: string, fields: Record<string, unknown> = {}): void {
  console.log(`[voice:${stage}]`, JSON.stringify(fields));
}
