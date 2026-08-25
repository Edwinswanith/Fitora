/**
 * Pure formatters that turn already-fetched real data into the spoken/shown
 * answer for a show_* voice query. No network/Expo/React import — the
 * fetching glue (answerFetchers.ts) calls these after awaiting the API.
 *
 * This is the piece that was missing: the server deliberately never states
 * real data itself (voiceIntentPolicy.ts's spokenResponseFor returns a fixed
 * "Here's what you asked for." for every show_* intent, on purpose, so the
 * model/policy engine can never invent a number). The app was always meant
 * to fetch the real record and say it — these functions are that step.
 */

export type DailyCardSlot = { status: string | null; workoutType: string | null };
export type DailyCardForAnswers = {
  readinessScore: number | null;
  isRestDay: boolean;
  sessions: Record<"AM" | "AFT" | "PM", DailyCardSlot>;
};

export function formatReadinessAnswer(card: DailyCardForAnswers): string {
  if (card.readinessScore == null) return "You haven't checked in today, so there's no readiness score yet.";
  return `Your readiness today is ${card.readinessScore} out of 100.`;
}

const SLOT_ORDER = ["AM", "AFT", "PM"] as const;

export function formatTodayPlanAnswer(card: DailyCardForAnswers): string {
  if (card.isRestDay) return "Today is a rest day.";
  const parts = SLOT_ORDER.map((slot) => {
    const s = card.sessions[slot];
    if (!s?.status || s.status === "planned") return null;
    return `${slot} ${s.workoutType ?? "session"} ${s.status}`;
  }).filter((x): x is string => x !== null);
  if (!parts.length) return "You have no sessions logged yet today.";
  return `Today: ${parts.join(", ")}.`;
}

export type TrendPointForAnswers = { readiness: number | null };

export function formatProgressAnswer(series: TrendPointForAnswers[]): string {
  const points = series.filter((p): p is { readiness: number } => typeof p.readiness === "number");
  if (points.length < 2) return "There isn't enough recent data yet to show a trend.";
  const first = points[0].readiness;
  const last = points[points.length - 1].readiness;
  const diff = last - first;
  const direction = diff > 3 ? "up" : diff < -3 ? "down" : "about the same";
  return `Your readiness is ${direction} over the last week, currently ${last} out of 100.`;
}

export function formatCoachFeedbackAnswer(comments: { body: string }[]): string {
  if (!comments.length) return "No coach feedback for today yet.";
  return `Your coach said: "${comments[0].body}"`;
}

export function formatHydrationAnswer(totalMl: number, goalMl: number): string {
  const remaining = Math.max(0, goalMl - totalMl);
  if (remaining === 0) return `You've reached your ${goalMl} millilitre water goal today.`;
  return `You've had ${totalMl} millilitres, ${remaining} millilitres left to reach your goal.`;
}

export type NutritionTargetForAnswers = {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
} | null;

export type NutritionTotalsForAnswers = {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
};

function gramsLine(label: string, consumed: number, target: number): string {
  return `${label} ${Math.max(0, Math.round(target - consumed))} grams left`;
}

export function formatNutritionAnswer(target: NutritionTargetForAnswers, totals: NutritionTotalsForAnswers): string {
  if (!target) return "No nutrition target is set for today yet.";
  const caloriesLeft = Math.max(0, Math.round(target.calories - totals.calories));
  return [
    `You've logged ${Math.round(totals.calories)} calories today, with ${caloriesLeft} calories remaining.`,
    gramsLine("Protein", totals.proteinG, target.proteinG),
    gramsLine("carbs", totals.carbsG, target.carbsG),
    gramsLine("fat", totals.fatG, target.fatG),
  ].join(" ");
}

export type CoachSessionForAnswers = {
  status: string;
  type: string;
  scheduledStart: string;
  scheduledEnd: string;
  coachName?: string | null;
};

export function formatUpcomingSessionAnswer(sessions: CoachSessionForAnswers[], nowMs = Date.now()): string {
  const next = sessions
    .filter((session) => {
      const start = new Date(session.scheduledStart).getTime();
      return Number.isFinite(start) && start >= nowMs && !["cancelled", "completed", "missed"].includes(session.status);
    })
    .sort((a, b) => new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime())[0];
  if (!next) return "You do not have an upcoming coach session scheduled.";
  const start = new Date(next.scheduledStart);
  const end = new Date(next.scheduledEnd);
  const durationMin = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  const when = start.toLocaleString(undefined, { weekday: "long", hour: "numeric", minute: "2-digit" });
  const coach = next.coachName ? ` with Coach ${next.coachName}` : "";
  const sessionType = next.type.replace(/[_-]+/g, " ");
  return `Your next session is ${sessionType}${coach} on ${when}${durationMin ? ` for ${durationMin} minutes` : ""}.`;
}

const CHECKLIST_LABELS: Record<string, string> = {
  wellness: "your wellness check-in",
  session: "a training session",
  water: "water",
  recovery: "recovery",
};

export function formatDailyChecklistAnswer(missing: string[]): string {
  if (!missing.length) return "You're all caught up — nothing missing today.";
  const parts = missing.map((m) => CHECKLIST_LABELS[m] ?? m);
  return `You still need to log ${parts.join(", ")} today.`;
}
