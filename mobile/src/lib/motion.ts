import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, LayoutAnimation, Platform } from "react-native";

// Shared motion helpers. Every animation here snaps instantly when the OS
// "reduce motion" setting is on.

let reduceMotionNow = false;
AccessibilityInfo.isReduceMotionEnabled()
  .then((value) => {
    reduceMotionNow = value;
  })
  .catch(() => undefined);
AccessibilityInfo.addEventListener?.("reduceMotionChanged", (value) => {
  reduceMotionNow = value;
});

/** Current OS reduce-motion setting, for code outside React render. */
export function prefersReducedMotion(): boolean {
  return reduceMotionNow;
}

/** Ease out: fast start, gentle stop. */
export function easeOutCubic(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - clamped, 3);
}

/**
 * Tween a number toward `target` (progress rings, bars, counters). Starts at
 * `from` on mount so a ring fills up when a screen opens, then glides between
 * later values. Runs on requestAnimationFrame so it behaves the same on
 * native and web; the rings are small SVGs, so a re-render per frame is cheap.
 */
export function useAnimatedNumber(target: number, { duration = 450, from = 0 }: { duration?: number; from?: number } = {}): number {
  const [value, setShown] = useState(() => (reduceMotionNow ? target : from));
  // Last shown value, so a new target glides on from wherever the tween is.
  const shownRef = useRef<number | null>(null);

  useEffect(() => {
    const setValue = (next: number) => {
      shownRef.current = next;
      setShown(next);
    };
    const start = shownRef.current ?? (reduceMotionNow ? target : from);
    if (reduceMotionNow || duration <= 0 || start === target || !Number.isFinite(target)) {
      setValue(target);
      return;
    }
    let frame = 0;
    const startedAt = Date.now();
    const step = () => {
      const t = (Date.now() - startedAt) / duration;
      if (t >= 1) {
        setValue(target);
        return;
      }
      setValue(start + (target - start) * easeOutCubic(t));
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, duration, from]);

  return value;
}

/**
 * Call right before a state change that opens or closes a section, so the
 * content below glides instead of jumping. Native only (react-native-web has
 * no LayoutAnimation); web snaps, which is fine.
 */
export function animateNextLayout(): void {
  if (Platform.OS === "web" || reduceMotionNow) return;
  LayoutAnimation.configureNext(LayoutAnimation.create(220, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));
}

/**
 * A one-shot "pop" (scale dips to `low`, springs back past 1, settles), for a
 * check that lands, a flame that grows, a tab that is picked. Returns the
 * scale to put in a transform and the function that plays it.
 */
export function usePop(low = 0.7): [Animated.Value, () => void] {
  const [scale] = useState(() => new Animated.Value(1));
  const play = useCallback(() => {
    if (reduceMotionNow) return;
    scale.stopAnimation();
    scale.setValue(low);
    Animated.spring(scale, { toValue: 1, friction: 4, tension: 160, useNativeDriver: true }).start();
  }, [scale, low]);
  return [scale, play];
}

/** A short sideways shake for a value that was refused (put it in translateX). */
export function useShake(): [Animated.Value, () => void] {
  const [x] = useState(() => new Animated.Value(0));
  const play = useCallback(() => {
    if (reduceMotionNow) return;
    x.stopAnimation();
    x.setValue(0);
    const step = (toValue: number) => Animated.timing(x, { toValue, duration: 60, easing: Easing.linear, useNativeDriver: true });
    Animated.sequence([step(-7), step(6), step(-4), step(2), step(0)]).start();
  }, [x]);
  return [x, play];
}
