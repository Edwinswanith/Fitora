import type { Role } from "../roles";
import type { PexPose, PexTone } from "./mascotPoses";
import type { SpotlightPadding } from "./tourConfig";

export type MobileTourStepContext = {
  isAcademyOwner?: boolean;
};

export type MobileTourStep = {
  /** Also the id passed to useTourHighlight(id) on the target component. */
  id: string;
  /** Screen path to navigate to first, e.g. "/coach/athletes". Omit for same-screen steps. */
  route?: string;
  /** Id of an in-page action (registered via useTourAction) to run before waiting for the target. */
  action?: string;
  title: string;
  fallbackNote: string;
  /** Where the explanation card anchors — "bottom" (default) or "top" for targets near the screen bottom. */
  cardPosition?: "top" | "bottom";
  /** Pex's expression while explaining this step — defaults to a neutral "guiding" pointing pose. */
  mascotPose?: PexPose;
  /** Ring color for this step's mascot — defaults to "ready". Pair with `mascotPose: "warning"` for risk-flagging steps. */
  mascotTone?: PexTone;
  /** Per-edge override of the spotlight's outer padding — merged over `DEFAULT_SPOTLIGHT_PADDING`. Use when a
   * target's own visual bounds need more/less breathing room on a particular side (e.g. a wide banner). */
  spotlightPadding?: Partial<SpotlightPadding>;
  /** Overrides `SPOTLIGHT_RADIUS` for this step — match the target's own corner radius (e.g. a pill vs. a card). */
  spotlightRadius?: number;
  /** When this returns true, skip the step entirely — and don't even navigate for it. */
  skipIf?: (ctx: MobileTourStepContext) => boolean;
};

export const ATHLETE_TOUR_STEPS: MobileTourStep[] = [
  {
    id: "mobile-athlete-header",
    action: "athlete:section:today",
    title: "Your day header",
    fallbackNote: "Use the header for notifications, the calendar, and Ask Agent voice or text commands.",
    mascotPose: "welcoming",
  },
  {
    id: "mobile-athlete-readiness",
    title: "Readiness",
    fallbackNote: "Your readiness card shows whether your body is ready to train, needs caution, or should recover.",
  },
  {
    id: "mobile-athlete-training",
    title: "Training summary",
    fallbackNote: "AM, afternoon, and PM sessions show what is planned and which logs still need updates.",
  },
  {
    id: "mobile-athlete-progress",
    action: "athlete:section:progress",
    title: "Progress",
    fallbackNote: "The Progress tab tracks goals, water, streaks, and trends across recent days.",
  },
  {
    id: "mobile-athlete-log",
    action: "athlete:section:log",
    title: "Log",
    fallbackNote: "The Log tab is where you update session status, RPM, effort, mood, soreness, fatigue, and notes.",
    mascotPose: "encouraging",
  },
  {
    id: "mobile-athlete-coach",
    action: "athlete:section:coach",
    title: "Coach updates",
    fallbackNote: "Announcements, feedback, and recent activity from your coach show up here.",
    mascotPose: "welcoming",
  },
  {
    id: "mobile-athlete-chat",
    action: "athlete:section:messages",
    title: "Chat",
    fallbackNote: "Message your coach directly here, and see your full conversation history in one thread.",
    mascotPose: "welcoming",
  },
  {
    id: "mobile-athlete-agent",
    action: "athlete:section:today",
    title: "Ask Agent",
    fallbackNote: "Tap Ask Agent for voice commands, or hold it for two seconds to type a command.",
    cardPosition: "top",
    mascotPose: "thinking",
  },
];

export const COACH_TOUR_STEPS: MobileTourStep[] = [
  {
    id: "mobile-coach-header",
    title: "Squad controls",
    fallbackNote: "Use the top controls to change the day, add athletes, open notifications, and manage your profile.",
    mascotPose: "welcoming",
  },
  {
    id: "mobile-coach-kpis",
    title: "Squad KPIs",
    fallbackNote: "Athletes, present count, sessions done, and average readiness summarize the squad at a glance.",
  },
  {
    id: "mobile-coach-attention",
    title: "Needs attention",
    fallbackNote: "This section highlights athletes with injury, low readiness, or high training-risk signals.",
    mascotPose: "warning",
    mascotTone: "caution",
  },
  {
    id: "mobile-coach-notes",
    title: "Athlete notes",
    fallbackNote: "Recent athlete notes and reply status help you keep follow-up work visible.",
  },
  {
    id: "mobile-coach-analytics",
    title: "Squad analytics",
    fallbackNote: "Trend cards summarize readiness, attendance, and load across assigned athletes.",
    mascotPose: "thinking",
  },
  {
    id: "mobile-coach-roster",
    route: "/coach/athletes",
    title: "Roster",
    fallbackNote: "Search and filter your full roster, and tap an athlete for their full daily card.",
  },
  {
    id: "mobile-coach-messages",
    route: "/coach/messages",
    title: "Messages",
    fallbackNote: "All your 1:1 conversation threads with athletes in one place.",
  },
  {
    id: "mobile-coach-announce",
    route: "/coach/announcements",
    title: "Announce",
    fallbackNote: "Broadcast one message to your whole squad at once.",
    mascotPose: "encouraging",
  },
  {
    id: "mobile-coach-coaches",
    route: "/coach/coaches",
    title: "Coaches",
    fallbackNote: "As the academy owner, add other coaches to your academy here.",
    skipIf: (ctx) => !ctx.isAcademyOwner,
  },
  {
    id: "mobile-coach-agent",
    route: "/coach/dashboard",
    title: "Ask Agent",
    fallbackNote: "Ask Agent can open squad areas, filter attention lists, change date, or take voice and text commands.",
    cardPosition: "top",
    mascotPose: "thinking",
  },
];

export const GUARDIAN_TOUR_STEPS: MobileTourStep[] = [
  {
    id: "mobile-guardian-header",
    title: "Athlete summary",
    fallbackNote: "The header shows the selected athlete, date, notifications, and your account menu.",
    mascotPose: "welcoming",
  },
  {
    id: "mobile-guardian-switcher",
    title: "Switch athlete",
    fallbackNote: "If you have more than one linked athlete, switch between them here.",
  },
  {
    id: "mobile-guardian-sleep",
    title: "Sleep",
    fallbackNote: "Sleep quality and hours show whether your athlete has checked in for the selected day.",
  },
  {
    id: "mobile-guardian-water",
    title: "Water intake",
    fallbackNote: "Water intake compares logged hydration against the athlete's daily goal.",
    mascotPose: "encouraging",
  },
  {
    id: "mobile-guardian-attendance",
    title: "Attendance",
    fallbackNote: "Attendance shows whether training was logged as present, late, excused, rest, or missed.",
  },
];

export const MOBILE_TOUR_STEPS: Record<Role, MobileTourStep[]> = {
  athlete: ATHLETE_TOUR_STEPS,
  coach: COACH_TOUR_STEPS,
  guardian: GUARDIAN_TOUR_STEPS,
};
