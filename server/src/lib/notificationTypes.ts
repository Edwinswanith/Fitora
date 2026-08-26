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
 * Phase 12 note: as of this pass, every entry below (including the pre-
 * existing Phase 1-10 ones) is now actually consumed by `categoryForType` at
 * its call site — the "registered but never imported" gap Phase 11 flagged is
 * closed. Two entries stay intentionally unwired, for reasons documented at
 * their call site rather than left silently undone:
 *   - `exercise_video_added`: ExerciseMedia is a coach's private, reusable
 *     demo-video library with no per-athlete assignment link at upload time —
 *     there is no natural "who gets notified" recipient without inventing new
 *     product scope (e.g. "every athlete with this exercise in an active
 *     assignment"), which is a design decision, not a wiring task.
 *   - `routine_ready`: `POST /athlete/nutrition/routine/generate` is athlete-
 *     initiated and fully synchronous — the HTTP response IS the "it's ready"
 *     signal; a push notification for something the caller is already looking
 *     at on screen would be a redundant, not a missing, notification.
 */
export const NOTIFICATION_TYPES = {
  // --- Baseline (Phase 1) ---
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

  // --- Workouts (Phase 2) ---
  workout_assigned: "reminders",
  workout_updated: "reminders",
  exercise_video_added: "milestones", // registered, intentionally unwired — see file doc comment
  workout_due: "reminders",

  // --- Nutrition (Phase 3-4) ---
  meal_plan_assigned: "reminders",
  meal_plan_updated: "reminders",
  routine_ready: "milestones", // registered, intentionally unwired — see file doc comment

  // --- Subscriptions & payments (Phase 6) ---
  payment_failed: "alerts",
  subscription_cancelled: "deadlines",
  subscription_expired: "deadlines",
  subscription_expiring: "deadlines",
  subscription_renewed: "milestones",

  // --- Booking (Phase 7) ---
  booking_requested: "reminders",
  booking_confirmed: "reminders",
  booking_rescheduled: "reminders",
  booking_cancelled: "reminders",
  session_starting: "reminders",

  // --- Content library (Phase 9) ---
  coach_video_assigned: "milestones",

  // --- Reviews (Phase 10) ---
  new_review: "milestones",

  // --- Coach switching (Phase 13 hardening) ---
  coach_athlete_left: "alerts",
} as const satisfies Record<string, NotificationCategory>;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;

export function categoryForType(type: NotificationType): NotificationCategory {
  return NOTIFICATION_TYPES[type];
}
