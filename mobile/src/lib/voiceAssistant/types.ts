/**
 * Mirrors server/src/services/voiceIntentPolicy.ts's exported types. The
 * mobile app and server are separate packages with no shared-types package,
 * so this is a deliberate, minimal re-declaration — keep it in sync by hand
 * if the server's VOICE_INTENTS_V2 / VoiceAction list changes.
 */
export const VOICE_INTENTS_V2 = [
  "start_check_in",
  "log_wellness",
  "log_session",
  "log_rpe",
  "add_water",
  "show_hydration",
  "set_water_goal",
  "change_hydration_reminder",
  "log_recovery",
  "mark_rest_day",
  "log_heart_rate",
  "update_profile",
  "send_coach_note",
  "add_note",
  "show_readiness",
  "show_today_plan",
  "show_progress",
  "show_coach_feedback",
  "show_daily_checklist",
  "open_screen",
  "explain_app_field",
  "update_field",
  "confirm_action",
  "cancel_action",
  "unknown_intent",
] as const;
export type VoiceIntentNameV2 = (typeof VOICE_INTENTS_V2)[number];

export const VOICE_ACTIONS_V2 = ["collect_fields", "ready_to_confirm", "execute", "navigate", "answer", "reject"] as const;
export type VoiceActionV2 = (typeof VOICE_ACTIONS_V2)[number];

/** The exact shape POST /api/athlete/voice/interpret-v2 returns. */
export type InterpretV2Response = {
  intent: VoiceIntentNameV2;
  entities: Record<string, unknown>;
  missingFields: string[];
  action: VoiceActionV2;
  requiresConfirmation: boolean;
  spokenResponse: string;
};

/** Client fallback sent as pendingIntentHint — the server's own VoicePendingState wins whenever present. */
export type PendingIntentHint = {
  intent: VoiceIntentNameV2;
  entities: Record<string, unknown>;
  missingFields: string[];
};

export type CoachOption = { coachId: string; name: string };
