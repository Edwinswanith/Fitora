import { useEffect, useRef, useState } from "react";
import { StyleSheet, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Text } from "../AppText";
import { colors, radius } from "../../lib/theme";
import { useMobileTour } from "../../lib/tour/MobileTourProvider";
import { MASCOT_REACTIONS, subscribeMascotReactions, type MascotReactionSpec } from "../../lib/tour/reactions";
import { playSound } from "../../lib/tour/soundManager";
import { useOsReducedMotion } from "../../lib/tour/useReducedMotion";
import { BUBBLE_MARGIN, BUBBLE_MAX_WIDTH, RESERVED_BOTTOM_FAB_CLEARANCE } from "../../lib/tour/tourConfig";
import { PexMascot } from "./PexMascot";

/**
 * Renders one-off mascot reactions (check-in success/error, empty states).
 * Mounted once at the app root, independent of whether a guided tour is
 * active. Reactions never walk — they pop in at a fixed spot above the Ask
 * Agent FAB clearance and fade out on their own.
 */
export function MascotReactionOverlay() {
  const { prefs } = useMobileTour();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const osReducedMotion = useOsReducedMotion();
  const reducedMotion = osReducedMotion || !prefs.mascotAnimationsEnabled;
  const soundEnabled = prefs.soundEnabled;

  const [spec, setSpec] = useState<MascotReactionSpec | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const opacity = useSharedValue(0);

  useEffect(() => {
    return subscribeMascotReactions((event) => {
      const nextSpec = MASCOT_REACTIONS[event.name];
      setSpec(nextSpec);
      void playSound(event.name === "athlete.checkin.error" ? "reaction-error" : "reaction-success", soundEnabled);
      if (hideTimer.current) clearTimeout(hideTimer.current);

      if (reducedMotion) {
        opacity.value = 1;
        hideTimer.current = setTimeout(() => setSpec(null), nextSpec.durationMs);
        return;
      }
      opacity.value = withTiming(1, { duration: 220 });
      hideTimer.current = setTimeout(() => {
        opacity.value = withTiming(0, { duration: 220 }, (finished) => {
          if (finished) runOnJS(setSpec)(null);
        });
      }, nextSpec.durationMs);
    });
  }, [reducedMotion, soundEnabled, opacity]);

  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    []
  );

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  if (!spec) return null;

  const cardWidth = Math.min(BUBBLE_MAX_WIDTH, width - BUBBLE_MARGIN * 2);

  return (
    <Animated.View
      style={[
        styles.wrap,
        animatedStyle,
        { left: (width - cardWidth) / 2, width: cardWidth, bottom: insets.bottom + RESERVED_BOTTOM_FAB_CLEARANCE },
      ]}
      pointerEvents="none"
      accessibilityLiveRegion="polite"
    >
      <PexMascot pose={spec.pose} state="speaking" tone={spec.tone} size={44} reducedMotion={reducedMotion} />
      <Text style={styles.message}>{spec.message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
    padding: 10,
    shadowColor: "#0f172a",
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 24,
  },
  message: { flex: 1, fontSize: 13, fontWeight: "700", color: colors.ink, lineHeight: 18 },
});
