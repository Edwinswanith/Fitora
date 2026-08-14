import { Types } from "mongoose";
import { AthleteProfile } from "../models/AthleteProfile";
import { TrainingSession } from "../models/TrainingSession";
import { WaterIntake } from "../models/WaterIntake";
import { Wellness } from "../models/Wellness";
import { dayRange } from "./dashboard";

const DAY_MS = 24 * 60 * 60 * 1000;

export type AchievementTone = "green" | "amber" | "red";

export type AchievementGoalKey =
  | "check_in"
  | "training"
  | "hydration"
  | "all_rounder";

export type AchievementDay = {
  date: string;
  met: boolean;
};

export type AchievementReward = {
  title: string;
  description: string;
  badgeLabel: string;
  unlocked: boolean;
};

export type AchievementGoal = {
  key: AchievementGoalKey;
  title: string;
  description: string;
  metricLabel: string;
  target: number;
  currentStreak: number;
  completedDays: number;
  longestStreak: number;
  progress: number;
  achieved: boolean;
  tone: AchievementTone;
  reward: AchievementReward;
  history: AchievementDay[];
};

export type AthleteAchievements = {
  days: number;
  generatedAt: string;
  summary: {
    unlocked: number;
    nextGoal: {
      key: AchievementGoalKey;
      title: string;
      remaining: number;
    } | null;
    bestStreak: {
      key: AchievementGoalKey;
      title: string;
      days: number;
    } | null;
  };
  goals: AchievementGoal[];
};

export function clampAchievementDays(
  input: unknown,
  fallback = 60,
  max = 120
): number {
  const n = Number(input);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), 7), max);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function windowRange(days: number, today: Date): { start: Date; end: Date } {
  return {
    start: new Date(today.getTime() - (days - 1) * DAY_MS),
    end: new Date(today.getTime() + DAY_MS),
  };
}

function eachDay(days: number, today: Date): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    out.push(isoDay(new Date(today.getTime() - i * DAY_MS)));
  }
  return out;
}

function currentStreak(history: AchievementDay[]): number {
  let index = history.length - 1;
  if (index >= 0 && !history[index].met) index -= 1;

  let count = 0;
  while (index >= 0 && history[index].met) {
    count += 1;
    index -= 1;
  }
  return count;
}

function longestStreak(history: AchievementDay[]): number {
  let best = 0;
  let run = 0;
  for (const day of history) {
    if (day.met) {
      run += 1;
      best = Math.max(best, run);
    } else {
      run = 0;
    }
  }
  return best;
}

function toneFor(current: number, target: number): AchievementTone {
  if (current >= target) return "green";
  if (current > 0) return "amber";
  return "red";
}

function buildGoal(
  key: AchievementGoalKey,
  title: string,
  description: string,
  metricLabel: string,
  target: number,
  history: AchievementDay[],
  reward: Omit<AchievementReward, "unlocked">
): AchievementGoal {
  const current = currentStreak(history);
  const longest = longestStreak(history);
  const achieved = current >= target;
  return {
    key,
    title,
    description,
    metricLabel,
    target,
    currentStreak: current,
    completedDays: history.filter((day) => day.met).length,
    longestStreak: longest,
    progress: Math.min(100, Math.round((current / target) * 100)),
    achieved,
    tone: toneFor(current, target),
    reward: { ...reward, unlocked: achieved },
    history,
  };
}

export async function buildAthleteAchievements(
  athleteId: Types.ObjectId,
  days: number,
  today: Date = dayRange(undefined).start
): Promise<AthleteAchievements> {
  const { start, end } = windowRange(days, today);
  const [profile, wellness, sessions, water] = await Promise.all([
    AthleteProfile.findById(athleteId).select("hydrationGoalMl").lean(),
    Wellness.find({ athleteId, date: { $gte: start, $lt: end } })
      .select("date")
      .lean(),
    TrainingSession.find({ athleteId, date: { $gte: start, $lt: end } })
      .select("date status attended")
      .lean(),
    WaterIntake.find({ athleteId, date: { $gte: start, $lt: end } })
      .select("date amountMl")
      .lean(),
  ]);

  const hydrationGoalMl = (profile?.hydrationGoalMl as number | undefined) ?? 3000;
  const checkInDays = new Set(wellness.map((row) => isoDay(row.date as Date)));
  const trainingDays = new Set<string>();
  for (const row of sessions) {
    if (row.status === "completed" || row.attended === true) {
      trainingDays.add(isoDay(row.date as Date));
    }
  }

  const waterByDay = new Map<string, number>();
  for (const row of water) {
    const key = isoDay(row.date as Date);
    waterByDay.set(key, (waterByDay.get(key) ?? 0) + (row.amountMl as number));
  }

  const dates = eachDay(days, today);
  const checkInHistory = dates.map((date) => ({ date, met: checkInDays.has(date) }));
  const trainingHistory = dates.map((date) => ({ date, met: trainingDays.has(date) }));
  const hydrationHistory = dates.map((date) => ({
    date,
    met: (waterByDay.get(date) ?? 0) >= hydrationGoalMl,
  }));
  const allRounderHistory = dates.map((date) => ({
    date,
    met:
      checkInDays.has(date) &&
      trainingDays.has(date) &&
      (waterByDay.get(date) ?? 0) >= hydrationGoalMl,
  }));

  const goals = [
    buildGoal(
      "check_in",
      "Check-in streak",
      "Complete your daily wellness check-in.",
      "7-day goal",
      7,
      checkInHistory,
      {
        title: "Consistency Badge",
        description: "Earned for completing a 7-day check-in streak.",
        badgeLabel: "7 check-ins",
      }
    ),
    buildGoal(
      "training",
      "Training streak",
      "Finish at least one training session in a day.",
      "5-day goal",
      5,
      trainingHistory,
      {
        title: "Training Badge",
        description: "Earned for completing a 5-day training streak.",
        badgeLabel: "5 sessions",
      }
    ),
    buildGoal(
      "hydration",
      "Hydration streak",
      "Hit your daily water target.",
      "7-day goal",
      7,
      hydrationHistory,
      {
        title: "Hydration Badge",
        description: "Earned for hitting your water target 7 days in a row.",
        badgeLabel: "7 hydration goals",
      }
    ),
    buildGoal(
      "all_rounder",
      "All-rounder goal",
      "Check in, train, and hit hydration on the same day.",
      "3-day goal",
      3,
      allRounderHistory,
      {
        title: "All-rounder Badge",
        description: "Earned for completing all core goals 3 days in a row.",
        badgeLabel: "3 complete days",
      }
    ),
  ];

  const nextGoal =
    goals
      .filter((goal) => !goal.achieved)
      .sort(
        (a, b) =>
          a.target - a.currentStreak - (b.target - b.currentStreak) ||
          b.currentStreak - a.currentStreak
      )[0] ?? null;
  const bestGoal =
    goals
      .filter((goal) => goal.longestStreak > 0)
      .sort((a, b) => b.longestStreak - a.longestStreak)[0] ?? null;

  return {
    days,
    generatedAt: new Date().toISOString(),
    summary: {
      unlocked: goals.filter((goal) => goal.achieved).length,
      nextGoal: nextGoal
        ? {
            key: nextGoal.key,
            title: nextGoal.title,
            remaining: Math.max(0, nextGoal.target - nextGoal.currentStreak),
          }
        : null,
      bestStreak: bestGoal
        ? {
            key: bestGoal.key,
            title: bestGoal.title,
            days: bestGoal.longestStreak,
          }
        : null,
    },
    goals,
  };
}
