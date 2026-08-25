import { notificationPreview } from "./notificationCopy";

/**
 * Pure copy builders - one per sweep/event-driven notification type introduced
 * for push. No DB reads here; callers already queried whatever context they
 * need. `message`/`announcement` deliberately keep their existing inline copy
 * in services/messaging.ts / routes/coach.ts (not duplicated here) so the
 * in-app row and the push payload can never drift apart for those two.
 *
 * `link` is a best-effort default - callers that need an athlete-scoped path
 * (readiness_risk_flag, injury_alert) override it with the concrete path once
 * they know the athleteId.
 */
export type TemplateResult = { title: string; body: string; link: string | null };
type ReminderSlot = "AM" | "AFT" | "PM";

function slotLabel(slot: ReminderSlot): string {
  return slot === "AFT" ? "Afternoon" : slot;
}

export function buildDailyCheckinReminder(): TemplateResult {
  return {
    title: "Daily check-in reminder",
    body: "Please complete today's check-in so your coach can review your readiness.",
    link: "/athlete/dashboard",
  };
}

export function buildTrainingSessionReminder(input: { slot: ReminderSlot }): TemplateResult {
  const label = slotLabel(input.slot);
  return {
    title: `${label} session reminder`,
    body: `Please mark your ${label} session as completed or skipped.`,
    link: "/athlete/dashboard",
  };
}

export function buildRpeMonitoringReminder(input: { slot: ReminderSlot }): TemplateResult {
  const label = slotLabel(input.slot);
  return {
    title: `${label} RPE reminder`,
    body: `Please log your ${label} RPE so your coach can review today's load.`,
    link: "/athlete/dashboard",
  };
}

export function buildHydrationReminder(): TemplateResult {
  return {
    title: "Hydration reminder",
    body: "Please drink water and log your intake in Apex.",
    link: "/athlete/dashboard",
  };
}

export function buildMissedActivityReminder(input: { count: number }): TemplateResult {
  const sessionLabel = input.count === 1 ? "session" : "sessions";
  return {
    title: "Activity log reminder",
    body: `You still have ${input.count} planned ${sessionLabel} from yesterday to mark as completed or skipped.`,
    link: "/athlete/dashboard",
  };
}

export function buildReadinessRiskFlag(input: {
  athleteName: string;
  riskReasons: string[];
}): TemplateResult {
  return {
    title: `Readiness alert for ${input.athleteName}`,
    body: input.riskReasons.length
      ? notificationPreview(input.riskReasons.join("; "))
      : "Please review their latest RPE entry.",
    link: null,
  };
}

export function buildInjuryAlert(input: {
  athleteName: string;
  bodyPart: string;
  severity: string;
  restriction?: string | null;
}): TemplateResult {
  const label =
    input.severity === "severe"
      ? "Severe injury"
      : input.severity === "moderate"
        ? "Injury"
        : "Minor injury";
  return {
    title: `${label} alert for ${input.athleteName}`,
    body: notificationPreview(`${input.bodyPart}${input.restriction ? ` - ${input.restriction}` : ""}`),
    link: null,
  };
}

export function buildNoteNeedsReply(input: {
  athleteName: string;
  hours: number;
}): TemplateResult {
  const hourLabel = input.hours === 1 ? "hour" : "hours";
  return {
    title: "Athlete note needs a reply",
    body: `${input.athleteName} left a note ${input.hours} ${hourLabel} ago. Please review and respond.`,
    link: null,
  };
}

export function buildAthleteWeeklySummary(input: {
  checkins: number;
  sessions: number;
  readinessAvg: number | null;
}): TemplateResult {
  const avg = input.readinessAvg == null ? "n/a" : `${input.readinessAvg}%`;
  const sessionLabel = input.sessions === 1 ? "session" : "sessions";
  return {
    title: "Weekly summary ready",
    body: `This week: ${input.checkins}/7 check-ins, ${input.sessions} ${sessionLabel}, readiness average ${avg}.`,
    link: "/athlete/dashboard",
  };
}

export function buildCoachSquadDigest(input: {
  presentCount: number;
  totalSlots: number;
  flaggedCount: number;
}): TemplateResult {
  const attendanceLabel = input.totalSlots === 1 ? "attendance record" : "attendance records";
  const flagLabel = input.flaggedCount === 1 ? "readiness flag" : "readiness flags";
  return {
    title: "Squad summary ready",
    body: `This week: ${input.presentCount}/${input.totalSlots} ${attendanceLabel}, ${input.flaggedCount} ${flagLabel}.`,
    link: "/coach/dashboard",
  };
}

export function buildStreakMilestone(input: {
  goalTitle: string;
  badgeLabel: string;
  streakCount: number;
}): TemplateResult {
  const goalLabel = input.goalTitle.toLowerCase().replace(/\s+streak$/, "");
  return {
    title: `${input.badgeLabel} unlocked`,
    body: `${input.streakCount}-day ${goalLabel} streak. Keep it going.`,
    link: "/athlete/achievements",
  };
}

export function buildCoachFeedback(input: { coachName: string; preview: string }): TemplateResult {
  return {
    title: `Feedback from ${input.coachName}`,
    body: notificationPreview(input.preview),
    link: "/athlete/dashboard",
  };
}

// --- Phase 12: subscriptions, booking, workouts, nutrition, content, reviews ---

export function buildSubscriptionExpiringReminder(input: { coachName: string; daysRemaining: 1 | 7 }): TemplateResult {
  return input.daysRemaining === 1
    ? {
        title: "Your coaching plan expires tomorrow",
        body: `Renew to continue coaching with ${input.coachName}.`,
        link: "/athlete/dashboard?section=coach",
      }
    : {
        title: "Your coaching membership expires in 7 days",
        body: `Renew to continue coaching with ${input.coachName}.`,
        link: "/athlete/dashboard?section=coach",
      };
}

export function buildPaymentFailed(): TemplateResult {
  return {
    title: "Your coaching payment failed",
    body: "Update your payment to continue coaching.",
    link: "/athlete/dashboard?section=coach",
  };
}

export function buildSubscriptionExpired(): TemplateResult {
  return {
    title: "Your coaching membership has expired",
    body: "Renew any time to pick up where you left off.",
    link: "/athlete/dashboard?section=coach",
  };
}

export function buildSubscriptionRenewed(input: { coachName: string }): TemplateResult {
  return {
    title: "Coaching plan renewed",
    body: `Your subscription with ${input.coachName} has renewed successfully.`,
    link: "/athlete/dashboard?section=coach",
  };
}

export function buildBookingRequested(input: { athleteName: string }): TemplateResult {
  return {
    title: "New session request",
    body: `${input.athleteName} requested a session. Please confirm or decline.`,
    link: null,
  };
}

export function buildBookingConfirmed(input: { coachName: string }): TemplateResult {
  return {
    title: "Session confirmed",
    body: `${input.coachName} confirmed your upcoming session.`,
    link: null,
  };
}

export function buildBookingRescheduled(input: { byName: string }): TemplateResult {
  return {
    title: "Session rescheduled",
    body: `${input.byName} rescheduled your session to a new time.`,
    link: null,
  };
}

export function buildBookingCancelled(input: { byName: string }): TemplateResult {
  return {
    title: "Session cancelled",
    body: `${input.byName} cancelled the upcoming session.`,
    link: null,
  };
}

export function buildSessionStarting(input: { counterpartName: string; minutesUntil: number }): TemplateResult {
  return {
    title: "Session starting soon",
    body: `Your session with ${input.counterpartName} starts in ${input.minutesUntil} minutes.`,
    link: null,
  };
}

export function buildWorkoutAssigned(input: { coachName: string; workoutName: string }): TemplateResult {
  return {
    title: "New workout assigned",
    body: `${input.coachName} assigned you "${input.workoutName}".`,
    link: "/athlete/dashboard",
  };
}

export function buildWorkoutUpdated(input: { coachName: string; workoutName: string }): TemplateResult {
  return {
    title: "Workout template updated",
    body: `${input.coachName} updated "${input.workoutName}". Your current assignment is unaffected.`,
    link: "/athlete/dashboard",
  };
}

export function buildWorkoutDue(input: { workoutName: string }): TemplateResult {
  return {
    title: "Workout due today",
    body: `"${input.workoutName}" is on today's plan — mark it completed or skipped when you're done.`,
    link: "/athlete/dashboard",
  };
}

export function buildMealPlanAssigned(input: { coachName: string; planName: string }): TemplateResult {
  return {
    title: "New meal plan assigned",
    body: `${input.coachName} assigned you "${input.planName}".`,
    link: "/athlete/dashboard",
  };
}

export function buildMealPlanUpdated(input: { coachName: string; planName: string }): TemplateResult {
  return {
    title: "Meal plan template updated",
    body: `${input.coachName} updated "${input.planName}". Your current assignment is unaffected.`,
    link: "/athlete/dashboard",
  };
}

export function buildCoachVideoAssigned(input: { coachName: string; videoTitle: string }): TemplateResult {
  return {
    title: "New video shared with you",
    body: `${input.coachName} shared "${input.videoTitle}" with you.`,
    link: "/athlete/dashboard",
  };
}

export function buildNewReview(input: { athleteName: string; rating: number }): TemplateResult {
  return {
    title: "New review received",
    body: `${input.athleteName} left you a ${input.rating}-star review.`,
    link: "/coach/profile",
  };
}
