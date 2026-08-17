import { NOTIFICATION_TYPES, categoryForType } from "../src/lib/notificationTypes";
import { NOTIFICATION_CATEGORY_KEYS } from "../src/models/NotificationPreference";

describe("NOTIFICATION_TYPES registry", () => {
  test("every registered type maps to a valid NotificationPreference category", () => {
    for (const [type, category] of Object.entries(NOTIFICATION_TYPES)) {
      expect(NOTIFICATION_CATEGORY_KEYS).toContain(category);
      expect(categoryForType(type as never)).toBe(category);
    }
  });

  test("includes every type string verified live in the codebase today", () => {
    const liveTypes = [
      "daily_checkin_reminder",
      "training_session_reminder",
      "rpe_monitoring_reminder",
      "hydration_reminder",
      "missed_activity_reminder",
      "streak_milestone",
      "athlete_weekly_summary",
      "note_needs_reply",
      "coach_squad_digest",
      "message",
      "announcement",
      "coach_feedback",
      "readiness_risk_flag",
      "injury_alert",
    ];
    for (const type of liveTypes) {
      expect(NOTIFICATION_TYPES).toHaveProperty(type);
    }
  });
});
