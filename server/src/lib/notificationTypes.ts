import { NOTIFICATION_CATEGORY_KEYS } from "../models/NotificationPreference";

type NotificationCategory = (typeof NOTIFICATION_CATEGORY_KEYS)[number];

/**
 * Single source of truth for every `NotificationCandidate.type` string and the
 * category it belongs to. `Notification`/`NotificationDecision.type` stay a
 * free-form string at the schema level (existing rows and any one-off/internal
 * types aren't forced through this list), but every ROUTE/SERVICE that fires a
 * notification should look its type up here rather than inlining a fresh
 * literal + category pair — that's what let `weekly_summary` vs
 * `athlete_weekly_summary`-style drift happen before (see server tests /
 * scripts/seed.ts history). Add new types here first when building a new
 * notification-producing feature.
 */
export const NOTIFICATION_TYPES = {
  daily_checkin_reminder: "reminders",
  training_session_reminder: "reminders",
  rpe_monitoring_reminder: "reminders",
  hydration_reminder: "reminders",
  missed_activity_reminder: "reminders",
  streak_milestone: "milestones",
  athlete_weekly_summary: "digests",
  note_needs_reply: "deadlines",
  coach_squad_digest: "digests",
  message: "messages",
  announcement: "messages",
  coach_feedback: "messages",
  injury_alert: "alerts",
  readiness_risk_flag: "alerts",
  apex_test_notification: "alerts",
} as const satisfies Record<string, NotificationCategory>;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;

export function categoryForType(type: NotificationType): NotificationCategory {
  return NOTIFICATION_TYPES[type];
}
