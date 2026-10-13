import { useEffect, useState } from "react";
import { Animated, Easing, StyleSheet } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { Text } from "./AppText";
import { useAuth } from "../lib/auth";
import { prefersReducedMotion, useAnimatedNumber } from "../lib/motion";
import { colors, fonts } from "../lib/theme";

// Same geometry as assets/images/splash-icon.png (viewBox 120, drawn at the
// splash's imageWidth of 160), so the hand-off from the native splash is
// invisible: the first frame here is exactly what the splash showed.
const MARK_SIZE = 160;
const RING_R = 38;
const RING_C = 2 * Math.PI * RING_R;
const SPLASH_ARC = 179; // the three-quarter ring baked into the splash image

/** Shortest the animation runs, so the ring completes even when the app is ready instantly. */
const MIN_VISIBLE_MS = 900;
const FADE_OUT_MS = 260;

// Once per app process: switching tabs or remounting never replays it.
let playedThisLaunch = false;

/**
 * The app-opening moment: the splash's ring closes into a full circle,
 * FITORA appears, then the screen fades into the app. The app loads
 * underneath the whole time, and it never waits longer than the app needs
 * to start (minimum about one second for the ring to close).
 */
export function LaunchOverlay() {
  const { status } = useAuth();
  const [visible, setVisible] = useState(() => !playedThisLaunch && !prefersReducedMotion());
  const [startedAt] = useState(() => Date.now());
  const [fade] = useState(() => new Animated.Value(1));
  const [word] = useState(() => new Animated.Value(0));
  const arc = useAnimatedNumber(visible ? RING_C : SPLASH_ARC, { duration: 520, from: SPLASH_ARC });

  useEffect(() => {
    playedThisLaunch = true;
    if (!visible) return;
    Animated.timing(word, { toValue: 1, duration: 320, delay: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [visible, word]);

  useEffect(() => {
    if (!visible || status === "loading") return;
    const wait = Math.max(0, MIN_VISIBLE_MS - (Date.now() - startedAt));
    const timer = setTimeout(() => {
      Animated.timing(fade, { toValue: 0, duration: FADE_OUT_MS, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => setVisible(false));
    }, wait);
    return () => clearTimeout(timer);
  }, [visible, status, startedAt, fade]);

  if (!visible) return null;

  const scale = fade.interpolate({ inputRange: [0, 1], outputRange: [1.06, 1] });
  return (
    <Animated.View pointerEvents="none" style={[styles.root, { opacity: fade }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={{ transform: [{ scale }] }}>
        <Svg width={MARK_SIZE} height={MARK_SIZE} viewBox="0 0 120 120">
          <Circle cx={60} cy={60} r={RING_R} fill="none" stroke={colors.surfaceInset} strokeWidth={10} />
          <Circle
            cx={60}
            cy={60}
            r={RING_R}
            fill="none"
            stroke={colors.primary}
            strokeWidth={10}
            strokeLinecap="round"
            strokeDasharray={`${arc} ${RING_C}`}
            transform="rotate(-90 60 60)"
          />
          <Path d="M48 42h24v8H57v6h12v8H57v14h-9z" fill={colors.ink} />
        </Svg>
      </Animated.View>
      <Animated.View
        style={[
          styles.wordWrap,
          { opacity: word, transform: [{ translateY: word.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] },
        ]}
      >
        <Text style={styles.word}>FITORA</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", zIndex: 2000, elevation: 2000 },
  // Positioned below the mark without moving it, so the mark stays exactly where the splash drew it.
  wordWrap: { position: "absolute", top: "50%", marginTop: MARK_SIZE / 2 + 18, left: 0, right: 0, alignItems: "center" },
  word: { fontFamily: fonts.display, color: colors.ink, fontSize: 36, letterSpacing: 8 },
});
