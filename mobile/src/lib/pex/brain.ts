// What Pex says and how it looks on the athlete Today screen. Pure and unit
// tested: it only re-words and re-ranks the next action deriveNextAction
// already picked, plus a few situations around it (first days, a coach invite,
// coming back after a break, low readiness, late night). Every number it says
// comes from the input; when something is unknown it asks instead of guessing.

import type { NextAction, NextActionKind } from "../fitoraData";
import type { FirstStepsState } from "../firstSteps";
import { shiftDay } from "../progressWindow";
import type { PexFace, PexTone } from "./faces";

/** What the card's button does. Next-action kinds keep their existing handlers. */
export type PexActionKey = NextActionKind | "onboarding" | "coach" | "messageCoach" | "progress";

export type PexReaction = {
  /** Stable id for tests and analytics, e.g. "checkin.morning". */
  id: string;
  face: PexFace;
  tone: PexTone;
  /** Today's ring, 0..1. */
  progress: number;
  /** Orange spark on the ring: a check-in streak of 2+ days is alive. */
  spark: boolean;
  eyebrow: string;
  title: string;
  body: string;
  /** Empty when the card has no button. */
  ctaLabel: string;
  action: PexActionKey | null;
  calm: boolean;
};

export type PexInput = {
  next: NextAction;
  /** Local hour, 0..23. */
  hour: number;
  firstSteps: FirstStepsState | null;
  readinessScore: number | null;
  /** Days since the last check-in before today; null when there has never been one. */
  daysSinceCheckIn: number | null;
  streak: number;
  dayProgress: number;
  hasCoach: boolean;
  coachName: string | null;
  /** Coach the athlete asked to join, while that request is pending. */
  pendingRequestCoach: string | null;
  /** Coach who invited the athlete, while the invite is open. */
  inviteCoach: string | null;
};

export const LOW_READINESS = 40;
export const COMEBACK_DAYS = 3;
const NIGHT_FROM = 22;
const NIGHT_UNTIL = 4;
const MORNING_UNTIL = 11;

function first(name: string | null | undefined): string | null {
  const word = name?.trim().split(/\s+/)[0];
  return word ? word : null;
}

export function isNight(hour: number): boolean {
  return hour >= NIGHT_FROM || hour < NIGHT_UNTIL;
}

export function derivePexReaction(input: PexInput): PexReaction {
  const { next } = input;
  const coach = first(input.coachName);
  const lowReadiness = input.readinessScore != null && input.readinessScore < LOW_READINESS;
  const base = {
    tone: (lowReadiness ? "caution" : "ready") as PexTone,
    progress: clamp01(input.dayProgress),
    spark: input.streak >= 2,
    calm: false,
  };
  const fromNext = (id: string, face: PexFace, over: Partial<PexReaction> = {}): PexReaction => ({
    ...base,
    id,
    face,
    eyebrow: next.eyebrow,
    title: next.title,
    body: next.body,
    ctaLabel: next.ctaLabel,
    action: next.kind,
    ...over,
  });

  if (next.kind === "payment") {
    return fromNext("payment", "alarm", { tone: "alert", spark: false });
  }

  const inviter = first(input.inviteCoach);
  if (inviter && !input.hasCoach) {
    return {
      ...base,
      id: "invite",
      face: "news",
      eyebrow: "New invite",
      title: `${inviter} wants to coach you`,
      body: "Nothing is shared with them unless you accept.",
      ctaLabel: "See Invite",
      action: "coach",
    };
  }

  // A coach's plan (a workout under way, a session today) outranks setup chores.
  const coachDriven = next.kind === "workout_active" || next.kind === "workout_upcoming" || next.kind === "rpe" || next.kind === "session" || next.kind === "meal";
  const steps = input.firstSteps;
  if (steps && !steps.allDone) {
    const todo = steps.steps.find((step) => !step.done);
    const eyebrow = `Day ${steps.day} · ${steps.doneCount} of ${steps.steps.length} done`;
    if (todo?.key === "target") {
      return {
        ...base,
        id: "setup.target",
        face: "welcome",
        eyebrow: steps.day === 1 ? "Hi, I'm Pex" : eyebrow,
        title: "Let's set you up",
        body: "Your goal and body basics. I'll work out your daily calories.",
        ctaLabel: "Start Setup",
        action: "onboarding",
      };
    }
    if (!coachDriven && todo?.key === "checkin") {
      return { ...base, id: "setup.checkin", face: "guide", eyebrow, title: "Your first check-in", body: "Five quick scores. It tells me how ready you are today.", ctaLabel: "Check In", action: "checkin" };
    }
    if (!coachDriven && todo?.key === "water") {
      return { ...base, id: "setup.water", face: "thirsty", eyebrow, title: "Log your first glass", body: "One tap. It starts your water streak.", ctaLabel: "Log Water", action: "hydration" };
    }
    if (!coachDriven && todo?.key === "coach" && next.kind === "complete") {
      return waitingOrFindCoach(input, base, eyebrow);
    }
  }

  if (next.kind === "checkin" && input.daysSinceCheckIn != null && input.daysSinceCheckIn >= COMEBACK_DAYS) {
    return fromNext("checkin.comeback", "gentle", { eyebrow: "Welcome back", title: "Good to see you", body: "Let's start small. Just a check-in today.", spark: false });
  }

  const night = isNight(input.hour);
  if (night && next.kind !== "workout_active" && next.kind !== "session") {
    if (next.kind === "complete") {
      return { ...base, id: "night.done", face: "sleepy", eyebrow: "Late night", title: "Day done", body: "Everything's logged. Sleep well, see you tomorrow.", ctaLabel: "", action: null, calm: true };
    }
    return fromNext("night", "sleepy", { eyebrow: "Late night", title: "Wind down", body: "Log anything left, then get some sleep.", calm: true });
  }

  if (lowReadiness && next.kind === "workout_upcoming") {
    return fromNext("workout.lowReadiness", "worried", {
      eyebrow: `Readiness ${Math.round(input.readinessScore as number)}`,
      title: "Take it easy today",
      body: coach ? `Your body says go lighter. Tell ${coach} before you train hard.` : "Your body says go lighter. Keep today's workout easy.",
      ctaLabel: coach ? `Message ${coach}` : next.ctaLabel,
      action: coach ? "messageCoach" : next.kind,
    });
  }

  switch (next.kind) {
    case "checkin":
      return input.hour < MORNING_UNTIL
        ? fromNext("checkin.morning", "sleepyMorning", { eyebrow: "Good morning", title: "How did you sleep?", body: "Check in first. It sets today's readiness." })
        : fromNext("checkin", "guide", { title: "Check in", body: "Under a minute. It sets today's readiness." });
    case "workout_upcoming": {
      const ready = input.readinessScore != null && input.readinessScore >= 70 ? ` Readiness ${Math.round(input.readinessScore)}, you're good to go.` : "";
      return fromNext("workout.upcoming", "pumped", { body: `${next.body}${coach ? ` from ${coach}` : ""}.${ready}` });
    }
    case "workout_active":
      return fromNext("workout.active", "focus", { eyebrow: "In progress", title: next.body.replace(" exercises complete", " done"), body: `${next.title}. Keep going.` });
    case "rpe":
      return fromNext("rpe", "curious", { eyebrow: "Nice work", title: "How hard was it?", body: coach ? `Rate today's session from 1 to 10. ${coach} uses it to plan tomorrow.` : "Rate today's session from 1 to 10.", ctaLabel: "Log Effort" });
    case "session":
      return fromNext("session", "news");
    case "meal":
      return fromNext("meal", "hungry");
    case "hydration":
      return fromNext("hydration", "thirsty", { title: next.body, body: "A glass now keeps you on track." });
    case "complete":
    default:
      if (!input.hasCoach) return waitingOrFindCoach(input, base, "All set");
      return { ...base, id: "complete", face: "calm", eyebrow: "All set", title: "Day done", body: "Everything's logged. Rest well.", ctaLabel: "See Progress", action: "progress", calm: true };
  }
}

function waitingOrFindCoach(input: PexInput, base: Pick<PexReaction, "tone" | "progress" | "spark" | "calm">, eyebrow: string): PexReaction {
  const asked = first(input.pendingRequestCoach);
  if (asked) {
    return { ...base, id: "coach.waiting", face: "waiting", eyebrow: "Request sent", title: `Waiting on ${asked}`, body: `I'll tell you when ${asked} replies. Keep logging meanwhile.`, ctaLabel: "", action: null, calm: true };
  }
  return { ...base, id: "coach.find", face: "curious", eyebrow, title: "Find your coach", body: "A coach builds your workouts and meals. Browse a few and send a request.", ctaLabel: "Find a Coach", action: "coach" };
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

/**
 * Today's ring: the average of what applies today. Check-in always counts;
 * water and calories count once there is a goal; a workout counts when one is
 * assigned for today.
 */
export function dayProgress(input: {
  checkedIn: boolean;
  waterMl?: number | null;
  waterGoalMl?: number | null;
  calories?: number | null;
  calorieTarget?: number | null;
  workout?: { status: string; completedCount: number; exerciseCount: number } | null;
}): number {
  const parts: number[] = [input.checkedIn ? 1 : 0];
  if (input.waterGoalMl && input.waterGoalMl > 0) parts.push(clamp01((input.waterMl ?? 0) / input.waterGoalMl));
  if (input.calorieTarget && input.calorieTarget > 0) parts.push(clamp01((input.calories ?? 0) / input.calorieTarget));
  if (input.workout) {
    const w = input.workout;
    parts.push(w.status === "completed" ? 1 : w.exerciseCount > 0 ? clamp01(w.completedCount / w.exerciseCount) : 0);
  }
  return parts.reduce((sum, part) => sum + part, 0) / parts.length;
}

/** Whole days between the last check-in before today and today; null when none is known. */
export function daysSinceLastCheckIn(trends: readonly { date: string; readiness: number | null }[], today: string): number | null {
  const days = trends
    .filter((t) => typeof t.readiness === "number" && Number.isFinite(t.readiness))
    .map((t) => t.date.slice(0, 10))
    .filter((day) => day < today)
    .sort();
  const last = days[days.length - 1];
  if (!last) return null;
  let count = 0;
  for (let day = last; day < today && count < 400; day = shiftDay(day, 1)) count += 1;
  return count;
}

/** Streak lengths worth a moment. */
export const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100] as const;

export function streakMilestoneLine(streak: number): string | null {
  return (STREAK_MILESTONES as readonly number[]).includes(streak) ? `${streak} days in a row. That's a streak!` : null;
}
