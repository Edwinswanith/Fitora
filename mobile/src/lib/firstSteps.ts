// The "Day 1" setup card on the athlete Today screen: three small steps that
// give a brand-new athlete something to do instead of empty cards. Shown only
// in the first days after joining; it disappears once everything is done
// (except on the join day itself, where "You're all set" is the payoff).

import { localDayOf, shiftDay } from "./progressWindow";

export type FirstStepKey = "target" | "water" | "checkin" | "coach";
export type FirstStep = { key: FirstStepKey; done: boolean };

/** How many days after joining the card can still show. */
export const FIRST_STEPS_DAYS = 7;

export type FirstStepsInput = {
  today: string;
  createdAt: string | null | undefined;
  waterMl: number | null | undefined;
  readinessScore: number | null | undefined;
  hasCoach: boolean;
  /** False while goal, body basics or activity are missing (skipped in onboarding). */
  hasTarget: boolean;
};

export type FirstStepsState = {
  /** 1 on the join day. */
  day: number;
  steps: FirstStep[];
  doneCount: number;
  allDone: boolean;
};

/** Null when the card should not show. */
export function firstStepsState(input: FirstStepsInput): FirstStepsState | null {
  const joined = localDayOf(input.createdAt);
  if (!joined || joined > input.today) return null;
  if (shiftDay(joined, FIRST_STEPS_DAYS - 1) < input.today) return null;
  let day = 1;
  while (shiftDay(joined, day) <= input.today && day < FIRST_STEPS_DAYS) day += 1;

  const steps: FirstStep[] = [
    // Until the athlete has a calorie target, finishing setup matters more than a first glass.
    input.hasTarget ? { key: "water", done: (input.waterMl ?? 0) > 0 } : { key: "target", done: false },
    { key: "checkin", done: input.readinessScore != null },
    { key: "coach", done: input.hasCoach },
  ];
  const doneCount = steps.filter((step) => step.done).length;
  const allDone = doneCount === steps.length;
  if (allDone && day > 1) return null;
  return { day, steps, doneCount, allDone };
}
