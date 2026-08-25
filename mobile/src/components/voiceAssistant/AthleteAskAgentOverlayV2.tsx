import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { usePathname, useRouter } from "expo-router";
import { AskAgentControl } from "../AskAgentControl";
import { Banner } from "../ui";
import { ROLE_THEMES, space } from "../../lib/theme";
import { useVoiceAssistant } from "../../lib/voiceAssistant/useVoiceAssistant";
import type { VoiceIntentNameV2 } from "../../lib/voiceAssistant/types";
import { ConfirmationCard } from "./ConfirmationCard";

/**
 * The V2 athlete voice assistant surface — gated behind
 * EXPO_PUBLIC_VOICE_ASSISTANT_V2 (see RoleAskAgentOverlays.tsx's branch into
 * this component). Reuses AskAgentControl unchanged for the mic/listening/
 * speaking UI; everything about confirmation-before-write is new here.
 */
export function AthleteAskAgentOverlayV2() {
  const router = useRouter();
  const pathname = usePathname();
  const accent = ROLE_THEMES.athlete.accent;
  const accentInk = ROLE_THEMES.athlete.accentInk;
  const [inputOpen, setInputOpen] = useState(false);
  const hidden = useMemo(() => pathname === "/athlete/dashboard", [pathname]);

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
    router.push({ pathname: "/athlete/dashboard", params: { section } } as never);
  }

  const refreshAfterExecute = useCallback(
    (intent: VoiceIntentNameV2) => {
      const section =
        intent === "add_water" || intent === "log_meal" || intent === "set_water_goal" || intent === "change_hydration_reminder"
          ? "nutrition"
          : intent === "send_coach_note" || intent === "add_note"
            ? "coach"
            : "today";
      router.replace({ pathname: "/athlete/dashboard", params: { section, refresh: String(Date.now()) } } as never);
    },
    [router]
  );

  const { state, handleCommand, confirm, cancel, editField, chooseCoach, reset } = useVoiceAssistant({ onNavigate: handleNavigate, onExecuted: refreshAfterExecute });

  useEffect(() => {
    if (state.phase !== "done" && state.phase !== "error") return;
    // Answers get longer on-screen time — there's more to read than a
    // one-line save confirmation.
    const timer = setTimeout(() => reset(), state.answerText ? 7000 : 4000);
    return () => clearTimeout(timer);
  }, [state.phase, state.answerText, reset]);

  if (hidden) return null;

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
