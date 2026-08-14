export const TRAINING_CATEGORIES = [
  "ENDURANCE",
  "TEMPO / EXTENSIVE",
  "ACCELERATION (SHORT)",
  "MAX SPEED",
  "SPEED ENDURANCE",
  "SPECIAL ENDURANCE I",
  "SPECIAL ENDURANCE II",
  "LOW INTENSITY PLYO",
  "MODERATE PLYOS",
  "HIGH INTENSITY PLYOS",
  "TECHNIQUE / COORDINATION DRILLS",
  "CORE / STABILITY",
  "GENERAL STRENGTH & MOBILITY",
  "EXPLOSIVE / OLYMPIC LIFTS",
  "STRENGTH ENDURANCE",
  "Mental Skills / Focus",
  "Visualization / Breathing",
  "Competition Simulation",
  "SWIMMING",
  "MASSAGE",
  "ICE BATH",
  "ACTIVE REST / REST",
  "REHAB",
  "SUB MAX VELOCITY - SPEED ENDURANCE/SPECIAL",
  "SUB MAX VELOCITY - SPECIAL ENDURANCE 2",
  "Test / Trials",
  "Elastic Reactive Strength",
] as const;

export type TrainingCategory = (typeof TRAINING_CATEGORIES)[number];

export const DAYS_OF_WEEK = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export function dayOfWeek(date: Date): string {
  return DAYS_OF_WEEK[date.getUTCDay()];
}

export type RpeRiskFlag = "green" | "amber" | "red";
export type RpeReadinessBand = "green" | "amber" | "red";

export type RpeDerivedInput = {
  plannedIntensityPercent: number;
  rpe: number;
  fatigue: number;
  muscleSoreness: number;
  sleepQuality: number;
  moodMotivation: number;
  restingHeartRate?: number | null;
};

export type RpeDerivedOutput = {
  calculatedTrainingLoad: number;
  riskFlag: RpeRiskFlag;
  riskReasons: string[];
  readinessScore: number;
  readinessBand: RpeReadinessBand;
};

/**
 * Composite readiness from RPE wellness signals.
 * All inputs are 0–5.
 *
 * - sleepQuality (higher better)   → contributes (sq/5) * 25
 * - moodMotivation (higher better) → contributes (mm/5) * 25
 * - fatigue (lower better)         → contributes ((5-fat)/5) * 25
 * - muscleSoreness (lower better)  → contributes ((5-ms)/5)  * 25
 *
 * Sum → 0–100 (rounded).
 * Band: green ≥ 80, amber 60–79, red < 60.
 */
export function computeRpeReadiness(input: {
  sleepQuality: number;
  moodMotivation: number;
  fatigue: number;
  muscleSoreness: number;
}): { readinessScore: number; readinessBand: RpeReadinessBand } {
  const parts = [
    (input.sleepQuality / 5) * 25,
    (input.moodMotivation / 5) * 25,
    ((5 - input.fatigue) / 5) * 25,
    ((5 - input.muscleSoreness) / 5) * 25,
  ];
  const readinessScore = Math.round(parts.reduce((a, b) => a + b, 0));
  const readinessBand: RpeReadinessBand =
    readinessScore >= 80 ? "green" : readinessScore >= 60 ? "amber" : "red";
  return { readinessScore, readinessBand };
}

/**
 * Risk flag rules:
 *   RED   if (rpe ≥ 8 AND fatigue ≥ 4) OR (muscleSoreness ≥ 4 AND fatigue ≥ 4)
 *   AMBER if sleepQuality ≤ 2 OR moodMotivation ≤ 2 OR restingHeartRate ≥ 100
 *   GREEN otherwise
 *
 * restingHeartRate is optional; the elevated-RHR rule only fires when a value
 * is supplied. riskReasons returns a human-readable list of which rule(s) fired.
 */
export function deriveLoadAndRisk(input: RpeDerivedInput): RpeDerivedOutput {
  const calculatedTrainingLoad = input.plannedIntensityPercent * input.rpe;
  const reasons: string[] = [];

  const rpeFatigue = input.rpe >= 8 && input.fatigue >= 4;
  const soreFatigue = input.muscleSoreness >= 4 && input.fatigue >= 4;
  const lowSleep = input.sleepQuality <= 2;
  const lowMood = input.moodMotivation <= 2;
  const highRestingHr =
    typeof input.restingHeartRate === "number" && input.restingHeartRate >= 100;

  if (rpeFatigue) reasons.push(`RPE ${input.rpe} with high fatigue ${input.fatigue}`);
  if (soreFatigue)
    reasons.push(
      `Muscle soreness ${input.muscleSoreness} with high fatigue ${input.fatigue}`
    );

  let riskFlag: RpeRiskFlag;
  if (rpeFatigue || soreFatigue) {
    riskFlag = "red";
  } else if (lowSleep || lowMood || highRestingHr) {
    riskFlag = "amber";
    if (lowSleep) reasons.push(`Low sleep quality ${input.sleepQuality}`);
    if (lowMood) reasons.push(`Low mood/motivation ${input.moodMotivation}`);
    if (highRestingHr)
      reasons.push(`Elevated resting heart rate ${input.restingHeartRate}`);
  } else {
    riskFlag = "green";
  }

  const { readinessScore, readinessBand } = computeRpeReadiness(input);

  return {
    calculatedTrainingLoad,
    riskFlag,
    riskReasons: reasons,
    readinessScore,
    readinessBand,
  };
}

/**
 * Strict UTC midnight parser for YYYY-MM-DD or ISO strings.
 * Returns null on invalid input.
 */
export function parseDateOrNull(input: unknown): Date | null {
  if (input === undefined || input === null || input === "") return null;
  if (typeof input !== "string") return null;
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  );
}
