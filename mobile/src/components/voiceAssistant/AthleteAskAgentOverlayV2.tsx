import { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { usePathname } from "expo-router";
import { AskAgentControl } from "../AskAgentControl";
import { Banner } from "../ui";
import { ROLE_THEMES, space } from "../../lib/theme";
import { useVoiceAssistant } from "../../lib/voiceAssistant/useVoiceAssistant";
import { ConfirmationCard } from "./ConfirmationCard";

/**
 * The V2 athlete voice assistant surface — gated behind
 * EXPO_PUBLIC_VOICE_ASSISTANT_V2 (see RoleAskAgentOverlays.tsx's branch into
 * this component). Reuses AskAgentControl unchanged for the mic/listening/
 * speaking UI; everything about confirmation-before-write is new here.
 */
export function AthleteAskAgentOverlayV2() {
  const pathname = usePathname();
  const accent = ROLE_THEMES.athlete.accent;
  const accentInk = ROLE_THEMES.athlete.accentInk;
  const [inputOpen, setInputOpen] = useState(false);
  // Same suppression V1 uses — the dashboard screen still runs its own
  // (untouched, V1) inline voice UI this pass, so avoid a second FAB there.
  const hidden = useMemo(() => pathname === "/athlete/dashboard", [pathname]);
  const { state, handleCommand, confirm, cancel, editField, chooseCoach, reset } = useVoiceAssistant();

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
