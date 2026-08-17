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
 *
 * Phase 11 note: none of the call sites above actually import from this file
 * (confirmed by grep) — every one of the 14 "live" entries below still
 * hand-inlines its own literal + category pair at the call site. This file
 * has existed, unconsumed, since Phase 1. Retrofitting the working call
 * sites to import from here is low-risk but out of scope for this pass
 * (nothing is broken today); the entries below stay correct as
 * documentation either way. The 11 "registered, not yet wired" entries are
 * new — added for the Phase 6-10 subsystems (subscriptions, booking,
 * reviews) per the architecture plan's Notification Mapping (§I). None of
 * those events fire any notification anywhere yet (confirmed by audit) —
 * wiring them up is future work, not done here.
 */
export const NOTIFICATION_TYPES = {
  // --- Live call sites (verified against real code) ---
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

  // --- Registered, not yet wired to any call site (Phase 6-10) ---
  payment_failed: "alerts",
  subscription_cancelled: "deadlines",
  subscription_expired: "deadlines",
  subscription_expiring: "deadlines",
  booking_requested: "reminders",
  booking_confirmed: "reminders",
  booking_rescheduled: "reminders",
  booking_cancelled: "reminders",
  session_starting: "reminders",
  coach_video_assigned: "milestones",
  new_review: "milestones",
} as const satisfies Record<string, NotificationCategory>;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;

export function categoryForType(type: NotificationType): NotificationCategory {
  return NOTIFICATION_TYPES[type];
}
