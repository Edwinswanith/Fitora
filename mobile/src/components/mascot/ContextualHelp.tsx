import { Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMobileTour } from "../../lib/tour/MobileTourProvider";
import type { MobileTourStep } from "../../lib/tour/steps";

type ContextualHelpProps = {
  steps: MobileTourStep[];
  accent: string;
};

/** A "(?)" header-actions icon that starts a short, scoped mini-tour over a
 * subset of existing steps — for reintroducing a feature without replaying
 * the whole onboarding tour. */
export function ContextualHelp({ steps, accent }: ContextualHelpProps) {
  const { startMiniTour } = useMobileTour();
  return (
    <Pressable
      onPress={() => startMiniTour(steps)}
      hitSlop={8}
      style={styles.button}
      accessibilityRole="button"
      accessibilityLabel="Show quick help"
    >
      <Ionicons name="help-circle-outline" size={20} color={accent} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
});
