import AsyncStorage from "@react-native-async-storage/async-storage";
import { localDayOf, shiftDay } from "./progressWindow";
import { FIRST_STEPS_DAYS } from "./firstSteps";

// Who sees the one-time setup flow after signing up, and the per-user flag
// that stops it from showing twice. Anything skipped is picked up later by the
// Day 1 card (athlete) or the Profile tab's setup hero (coach).

const SEEN_KEY = "fitora.onboarding.v1:";

export type AthleteOnboardingInput = {
  today: string;
  createdAt: string | null | undefined;
  fitnessGoal?: string | null;
  weightKg?: number | null;
};

/** A new athlete (first week) who hasn't told us their goal or body basics yet. */
export function athleteNeedsOnboarding(input: AthleteOnboardingInput): boolean {
  const joined = localDayOf(input.createdAt);
  if (!joined || shiftDay(joined, FIRST_STEPS_DAYS - 1) < input.today) return false;
  return !input.fitnessGoal && !input.weightKg;
}

export type CoachOnboardingInput = {
  bio?: string | null;
  specializations?: string[] | null;
  active?: boolean | null;
  availabilityRuleCount: number;
};

/** A coach who hasn't set up anything athletes would see. */
export function coachNeedsOnboarding(input: CoachOnboardingInput): boolean {
  return !input.bio?.trim() && !input.specializations?.length && !input.active && input.availabilityRuleCount === 0;
}

export async function hasSeenOnboarding(userId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(SEEN_KEY + userId)) === "1";
  } catch {
    return false;
  }
}

/** Set when the flow opens, so leaving it half way never loops back into it. */
export async function markOnboardingSeen(userId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(SEEN_KEY + userId, "1");
  } catch {
    // storage unavailable: the profile checks above still stop most repeats
  }
}

/** Kilograms and centimetres an athlete may enter; matches PATCH /api/athlete/me. */
export const WEIGHT_RANGE_KG = { min: 20, max: 250 } as const;
export const HEIGHT_RANGE_CM = { min: 50, max: 250 } as const;

/** Field errors for the "About you" step, or null when it can be saved. */
/** Calorie targets are only calculated for ages 13 to 100 (the server refuses others). */
export const MIN_AGE = 13;
export const MAX_AGE = 100;

/** Whole years between two local "YYYY-MM-DD" dates. */
export function ageOn(dob: string, today: string): number {
  const [by, bm, bd] = dob.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

export function dobError(dob: string, today: string): string | null {
  if (!dob) return "Pick your birthday.";
  if (dob > today) return "Your birthday can't be in the future.";
  const age = ageOn(dob, today);
  if (age < MIN_AGE) return `You need to be at least ${MIN_AGE} to use Fitora.`;
  if (age > MAX_AGE) return "Check your birthday: that's over 100 years ago.";
  return null;
}

export function bodyBasicsError(values: { weightKg: string; heightCm: string; dob: string; sex: string; today: string }): string | null {
  const weight = Number(values.weightKg);
  const height = Number(values.heightCm);
  if (!values.weightKg.trim() || !Number.isFinite(weight) || weight < WEIGHT_RANGE_KG.min || weight > WEIGHT_RANGE_KG.max) {
    return `Enter your weight in kg (${WEIGHT_RANGE_KG.min} to ${WEIGHT_RANGE_KG.max}).`;
  }
  if (!values.heightCm.trim() || !Number.isFinite(height) || height < HEIGHT_RANGE_CM.min || height > HEIGHT_RANGE_CM.max) {
    return `Enter your height in cm (${HEIGHT_RANGE_CM.min} to ${HEIGHT_RANGE_CM.max}).`;
  }
  const dobProblem = dobError(values.dob, values.today);
  if (dobProblem) return dobProblem;
  if (!values.sex) return "Pick male or female.";
  return null;
}

/** Specialties offered in coach setup; anything else goes in "Other". */
export const COACH_SPECIALTIES = ["Fat loss", "Strength", "Muscle gain", "Nutrition", "Running", "Cricket", "Football", "Mobility", "Rehab", "Yoga"] as const;
export const MAX_SPECIALTIES = 5;
export const COACH_BIO_MAX = 300;

export type HoursWindow = { start: string; end: string };
export type SetupAvailabilityRule = {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  timezone: string;
  sessionDurationMin: number;
  bufferMin: number;
};

/** Same defaults as the Profile tab's hours editor. */
const SETUP_SESSION_MIN = 30;
const SETUP_BUFFER_MIN = 10;

function minutesOf(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Turns the setup screen's days and time windows into the rules
 * PUT /api/coach/availability takes, or explains what to fix.
 */
export function buildAvailabilityRules(
  days: number[],
  windows: HoursWindow[],
  timezone: string
): { rules: SetupAvailabilityRule[]; error: null } | { rules: null; error: string } {
  if (!days.length) return { rules: null, error: "Pick at least one day." };
  if (!windows.length) return { rules: null, error: "Add at least one time window." };
  const ranges: { start: number; end: number }[] = [];
  for (const window of windows) {
    const start = minutesOf(window.start);
    const end = minutesOf(window.end);
    if (start == null || end == null) return { rules: null, error: "Pick a start and end time." };
    if (end <= start) return { rules: null, error: "Each window must end after it starts." };
    if (end - start < SETUP_SESSION_MIN) return { rules: null, error: `Each window needs at least ${SETUP_SESSION_MIN} minutes.` };
    ranges.push({ start, end });
  }
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].start < sorted[i - 1].end) return { rules: null, error: "Two of your time windows overlap." };
  }
  const rules = [...new Set(days)].sort((a, b) => a - b).flatMap((dayOfWeek) =>
    sorted.map((range) => ({
      dayOfWeek,
      startMinute: range.start,
      endMinute: range.end,
      timezone,
      sessionDurationMin: SETUP_SESSION_MIN,
      bufferMin: SETUP_BUFFER_MIN,
    }))
  );
  return { rules, error: null };
}
