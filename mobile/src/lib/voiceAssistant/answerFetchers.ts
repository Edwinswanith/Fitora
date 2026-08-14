import { apiJson } from "../api";
import type { VoiceIntentNameV2 } from "./types";
import {
  formatReadinessAnswer,
  formatTodayPlanAnswer,
  formatProgressAnswer,
  formatCoachFeedbackAnswer,
  formatHydrationAnswer,
  formatDailyChecklistAnswer,
  type DailyCardForAnswers,
} from "./answerFormatting";

async function fetchDailyCard(): Promise<DailyCardForAnswers> {
  const res = await apiJson<{ card: DailyCardForAnswers }>("/api/athlete/daily");
  return res.card;
}

async function answerReadiness(): Promise<string> {
  return formatReadinessAnswer(await fetchDailyCard());
}

async function answerTodayPlan(): Promise<string> {
  return formatTodayPlanAnswer(await fetchDailyCard());
}

async function answerProgress(): Promise<string> {
  const res = await apiJson<{ series: { readiness: number | null }[] }>("/api/athlete/trends?days=7");
  return formatProgressAnswer(res.series);
}

async function answerCoachFeedback(): Promise<string> {
  const res = await apiJson<{ comments: { body: string }[] }>("/api/athlete/coach-comments");
  return formatCoachFeedbackAnswer(res.comments);
}

async function answerHydration(): Promise<string> {
  const res = await apiJson<{ totalMl: number; goalMl: number }>("/api/athlete/water");
  return formatHydrationAnswer(res.totalMl, res.goalMl);
}

async function answerDailyChecklist(): Promise<string> {
  const res = await apiJson<{ missing: string[] }>("/api/athlete/voice/today-checklist");
  return formatDailyChecklistAnswer(res.missing);
}

/**
 * Fetches the real record behind a show_* intent and returns the spoken/
 * shown answer. Falls back to the policy engine's own generic text for
 * anything not in this list (explain_app_field already carries real text
 * from the server, so it never reaches here).
 */
export async function fetchAnswerFor(intent: VoiceIntentNameV2, fallback: string): Promise<string> {
  switch (intent) {
    case "show_readiness":
      return answerReadiness();
    case "show_today_plan":
      return answerTodayPlan();
    case "show_progress":
      return answerProgress();
    case "show_coach_feedback":
      return answerCoachFeedback();
    case "show_hydration":
      return answerHydration();
    case "show_daily_checklist":
      return answerDailyChecklist();
    default:
      return fallback;
  }
}
