import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useLocalSearchParams, usePathname, useRouter } from "expo-router";
import { AskAgentControl } from "../AskAgentControl";
import { Banner } from "../ui";
import { ROLE_THEMES, space } from "../../lib/theme";
import { useVoiceAssistant } from "../../lib/voiceAssistant/useVoiceAssistant";
import type { VoiceIntentNameV2 } from "../../lib/voiceAssistant/types";
import { loadAthleteDashboardData, updateCachedData, type AthleteDashboardData, type Meal, type WaterDay } from "../../lib/fitoraData";
import { ConfirmationCard } from "./ConfirmationCard";

const DASHBOARD_CACHE_KEY = "athlete-dashboard";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Intents whose write response doesn't map onto a single dashboard field the
 * way add_water/log_meal/set_water_goal/update_profile do below — synced with
 * a silent background refetch instead of a bespoke per-field patch, so the
 * dashboard (if mounted) still reconciles moments later without ever
 * blocking or navigating the athlete off whatever screen they're actually on.
 */
const BACKGROUND_SYNC_INTENTS: VoiceIntentNameV2[] = [
  "log_wellness",
  "log_session",
  "log_rpe",
  "change_hydration_reminder",
  "log_recovery",
  "mark_rest_day",
  "log_heart_rate",
  "add_note",
];

/**
 * Maps the athlete's actual current route to the same coarse tab vocabulary
 * the server's OPEN_SCREEN_ALLOWLIST uses (see voiceIntentPolicy.ts), so a
 * vague command ("add this") can be disambiguated by where the athlete
 * actually is — the dashboard is a single screen with a `section` tab param
 * rather than separate routes, so that param is checked first.
 */
function screenContextFor(pathname: string, section?: string): string | undefined {
  if (pathname === "/athlete/dashboard") {
    if (section === "workouts") return "workouts";
    if (section === "nutrition") return "nutrition";
    if (section === "coach") return "coach";
    if (section === "progress") return "progress";
    return "today";
  }
  if (pathname === "/athlete/water") return "water";
  if (pathname === "/athlete/log-meal" || pathname === "/athlete/meal-scan") return "nutrition";
  if (pathname === "/athlete/active-workout" || pathname === "/athlete/rpe") return "workouts";
  if (pathname === "/athlete/trends") return "progress";
  if (pathname === "/athlete/coach-discovery") return "coach";
  return undefined;
}

/**
 * The V2 athlete voice assistant surface — gated behind
 * EXPO_PUBLIC_VOICE_ASSISTANT_V2 (see RoleAskAgentOverlays.tsx's branch into
 * this component). Reuses AskAgentControl unchanged for the mic/listening/
 * speaking UI; everything about confirmation-before-write is new here.
 */
export function AthleteAskAgentOverlayV2() {
  const router = useRouter();
  const pathname = usePathname();
  const { section } = useLocalSearchParams<{ section?: string }>();
  const currentScreen = screenContextFor(pathname, section);
  const accent = ROLE_THEMES.athlete.accent;
  const accentInk = ROLE_THEMES.athlete.accentInk;
  const [inputOpen, setInputOpen] = useState(false);

  function handleNavigate(screen: string) {
    if (screen === "notifications") {
      router.push("/notifications" as never);
      return;
    }
    const section =
      screen === "workouts" || screen === "log" ? "workouts"
      : screen === "nutrition" || screen === "water" ? "nutrition"
      : screen === "coach" || screen === "messages" ? "coach"
      : screen === "progress" || screen === "goals" || screen === "trends" ? "progress"
      : "today";
    // replace, not push — this is a voice-triggered "take me to X" jump, not
    // a fresh forward navigation, so it shouldn't stack a new dashboard
    // instance (and the resulting remount+reload) on top of the existing one.
    router.replace({ pathname: "/athlete/dashboard", params: { section } } as never);
  }

  const syncAfterExecute = useCallback((intent: VoiceIntentNameV2, entities: Record<string, unknown>, response: unknown) => {
    // Patches the shared dashboard cache in place — the same
    // setData/updateCachedData pattern log-meal.tsx and the rest of the app
    // use — instead of navigating/remounting. Whatever screen the athlete is
    // actually on stays put; the dashboard (if mounted underneath) updates
    // instantly, and picks up the change on its next visit otherwise.
    if (intent === "add_water" && isRecord(response)) {
      updateCachedData<AthleteDashboardData>(DASHBOARD_CACHE_KEY, (prev) => (prev ? { ...prev, water: response as unknown as WaterDay } : prev));
      return;
    }
    if (intent === "log_meal" && isRecord(response) && isRecord(response.meal)) {
      const meal = response.meal as unknown as Meal;
      updateCachedData<AthleteDashboardData>(DASHBOARD_CACHE_KEY, (prev) => {
        if (!prev) return prev;
        const addedCalories = meal.foods.reduce((sum, f) => sum + (Number(f.calories) || 0), 0);
        const addedProtein = meal.foods.reduce((sum, f) => sum + (Number(f.proteinG) || 0), 0);
        const addedCarbs = meal.foods.reduce((sum, f) => sum + (Number(f.carbsG) || 0), 0);
        const addedFat = meal.foods.reduce((sum, f) => sum + (Number(f.fatG) || 0), 0);
        return {
          ...prev,
          meals: [...prev.meals, meal],
          mealTotals: {
            calories: (prev.mealTotals?.calories ?? 0) + addedCalories,
            proteinG: (prev.mealTotals?.proteinG ?? 0) + addedProtein,
            carbsG: (prev.mealTotals?.carbsG ?? 0) + addedCarbs,
            fatG: (prev.mealTotals?.fatG ?? 0) + addedFat,
          },
        };
      });
      return;
    }
    if ((intent === "set_water_goal" || intent === "update_profile") && isRecord(response) && isRecord(response.athlete)) {
      const athlete = response.athlete as unknown as AthleteDashboardData["profile"];
      updateCachedData<AthleteDashboardData>(DASHBOARD_CACHE_KEY, (prev) => (prev ? { ...prev, profile: athlete } : prev));
      return;
    }
    if (BACKGROUND_SYNC_INTENTS.includes(intent)) {
      loadAthleteDashboardData()
        .then((data) => updateCachedData<AthleteDashboardData>(DASHBOARD_CACHE_KEY, () => data))
        .catch(() => undefined);
    }
  }, []);

  const { state, handleCommand, confirm, cancel, editField, chooseCoach, reset } = useVoiceAssistant({
    onNavigate: handleNavigate,
    onExecuted: syncAfterExecute,
    currentScreen,
  });

  useEffect(() => {
    if (state.phase !== "done" && state.phase !== "error") return;
    // Answers get longer on-screen time — there's more to read than a
    // one-line save confirmation.
    const timer = setTimeout(() => reset(), state.answerText ? 7000 : 4000);
    return () => clearTimeout(timer);
  }, [state.phase, state.answerText, reset]);

  return (
    <>
      <AskAgentControl accent={accent} accentInk={accentInk} onCommand={handleCommand} onInputOpenChange={setInputOpen} />
      {!inputOpen && (state.phase === "confirming" || state.phase === "needs_coach") ? (
        <ConfirmationCard state={state} accent={accent} accentInk={accentInk} onConfirm={confirm} onCancel={cancel} onEditField={editField} onChooseCoach={chooseCoach} />
      ) : null}
      {!inputOpen && state.phase === "done" && state.answerText ? (
        <View style={styles.banner}>
          <Banner kind="ok">{state.answerText}</Banner>
        </View>
      ) : null}
      {!inputOpen && state.phase === "done" && state.successMessage ? (
        <View style={styles.banner}>
          <Banner kind="ok">{state.successMessage}</Banner>
        </View>
      ) : null}
      {!inputOpen && state.phase === "error" && state.errorMessage ? (
        <View style={styles.banner}>
          <Banner kind="error">{state.errorMessage}</Banner>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  banner: { position: "absolute", left: space(4), right: space(4), bottom: space(24) },
});
