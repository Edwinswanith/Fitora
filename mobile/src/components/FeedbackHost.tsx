import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "./AppText";
import { colors } from "../lib/theme";
import { setCelebrationListener, type CelebrationOptions } from "../lib/feedback";

const TOAST_MS = 2200;
const BIG_MS = 2600;

/**
 * Renders celebrate() calls: a toast that slides in from the top for normal
 * saves, a centered card with a burst ring for goals. Mounted once at the root.
 */
export function FeedbackHost() {
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState<(CelebrationOptions & { key: number }) | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  // useState (not useRef(...).current): the values are created once and read
  // during render, which React's compiler rules disallow for refs.
  const [progress] = useState(() => new Animated.Value(0));
  const [burst] = useState(() => new Animated.Value(0));
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    setCelebrationListener((options) => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setCurrent({ ...options, key: Date.now() });
    });
    return () => {
      setCelebrationListener(null);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!current) return;
    AccessibilityInfo.announceForAccessibility(current.body ? `${current.title}. ${current.body}` : current.title);
    progress.setValue(0);
    burst.setValue(0);
    const enter = reduceMotion
      ? Animated.timing(progress, { toValue: 1, duration: 120, useNativeDriver: true })
      : Animated.spring(progress, { toValue: 1, friction: 7, tension: 80, useNativeDriver: true });
    Animated.parallel([
      enter,
      reduceMotion
        ? Animated.timing(burst, { toValue: 1, duration: 0, useNativeDriver: true })
        : Animated.timing(burst, { toValue: 1, duration: 650, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
    hideTimer.current = setTimeout(() => {
      Animated.timing(progress, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => setCurrent(null));
    }, current.big ? BIG_MS : TOAST_MS);
  }, [current, progress, burst, reduceMotion]);

  if (!current) return null;

  function dismiss() {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    Animated.timing(progress, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => setCurrent(null));
  }

  if (current.big) {
    const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] });
    const ringScale = burst.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.6] });
    const ringOpacity = burst.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.5, 0.25, 0] });
    return (
      <View pointerEvents="box-none" style={styles.bigWrap}>
        <Pressable onPress={dismiss} accessibilityRole="alert">
          <Animated.View style={[styles.bigCard, { opacity: progress, transform: [{ scale }] }]}>
            <View style={styles.bigIconWrap}>
              <Animated.View style={[styles.ring, { opacity: ringOpacity, transform: [{ scale: ringScale }] }]} />
              <View style={styles.bigIcon}>
                <Ionicons name="trophy" size={34} color="#fff" />
              </View>
            </View>
            <Text style={styles.bigTitle}>{current.title}</Text>
            {current.body ? <Text style={styles.bigBody}>{current.body}</Text> : null}
          </Animated.View>
        </Pressable>
      </View>
    );
  }

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] });
  const iconScale = burst.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.4, 1.2, 1] });
  return (
    <View pointerEvents="box-none" style={[styles.toastWrap, { top: insets.top + 8 }]}>
      <Pressable onPress={dismiss} accessibilityRole="alert">
        <Animated.View style={[styles.toast, { opacity: progress, transform: [{ translateY }] }]}>
          <Animated.View style={[styles.toastIcon, { transform: [{ scale: iconScale }] }]}>
            <Ionicons name="checkmark" size={18} color="#fff" />
          </Animated.View>
          <View style={styles.toastCopy}>
            <Text style={styles.toastTitle} numberOfLines={1}>{current.title}</Text>
            {current.body ? <Text style={styles.toastBody} numberOfLines={2}>{current.body}</Text> : null}
          </View>
        </Animated.View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  toastWrap: { position: "absolute", left: 16, right: 16, alignItems: "center", zIndex: 1000, elevation: 1000 },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    maxWidth: 420,
    minWidth: 220,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: colors.ink,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  toastIcon: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.ok },
  toastCopy: { flexShrink: 1 },
  toastTitle: { color: "#fff", fontSize: 15, fontWeight: "800" },
  toastBody: { color: "#cbd5e1", fontSize: 13, lineHeight: 18, marginTop: 1 },
  bigWrap: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", zIndex: 1000, elevation: 1000, padding: 24 },
  bigCard: {
    alignItems: "center",
    gap: 8,
    width: 280,
    paddingVertical: 26,
    paddingHorizontal: 20,
    borderRadius: 24,
    backgroundColor: colors.surfaceRaised,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  bigIconWrap: { width: 96, height: 96, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  ring: { position: "absolute", width: 96, height: 96, borderRadius: 48, backgroundColor: colors.ok },
  bigIcon: { width: 68, height: 68, borderRadius: 34, alignItems: "center", justifyContent: "center", backgroundColor: colors.ok },
  bigTitle: { color: colors.ink, fontSize: 20, fontWeight: "900", textAlign: "center" },
  bigBody: { color: colors.inkMuted, fontSize: 14, lineHeight: 20, textAlign: "center" },
});
