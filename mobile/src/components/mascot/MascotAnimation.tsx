import { useEffect, useRef } from "react";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { PexMascot } from "./PexMascot";
import type { PexMascotState, PexPose, PexTone } from "../../lib/tour/mascotPoses";
import { ENTER_DURATION_MS, LEAVE_DURATION_MS, MASCOT_SIZE, MOVE_DURATION_MS } from "../../lib/tour/tourConfig";

type MascotAnimationProps = {
  /** Top-left target position for the mascot; null while there's nowhere to stand yet. */
  x: number | null;
  y: number | null;
  pose?: PexPose;
  state: PexMascotState;
  tone: PexTone;
  size?: number;
  reducedMotion: boolean;
};

/**
 * Owns the mascot's shared x/y and tweens between the previous and new
 * position with `withTiming` — this is the "walk" (same-screen steps move
 * continuously; cross-screen steps effectively teleport because the target
 * unmounts first, dropping x/y to null, then reappears at a fresh position).
 */
export function MascotAnimation({ x, y, pose, state, tone, size = MASCOT_SIZE, reducedMotion }: MascotAnimationProps) {
  const tx = useSharedValue(x ?? 0);
  const ty = useSharedValue(y ?? 0);
  const opacity = useSharedValue(0);
  const hasPositionedRef = useRef(false);

  useEffect(() => {
    if (x === null || y === null) {
      opacity.value = reducedMotion ? 0 : withTiming(0, { duration: LEAVE_DURATION_MS });
      return;
    }
    if (!hasPositionedRef.current) {
      tx.value = x;
      ty.value = y;
      opacity.value = reducedMotion ? 1 : 0;
      if (!reducedMotion) opacity.value = withTiming(1, { duration: ENTER_DURATION_MS });
      hasPositionedRef.current = true;
      return;
    }
    if (reducedMotion) {
      tx.value = x;
      ty.value = y;
      opacity.value = 1;
    } else {
      tx.value = withTiming(x, { duration: MOVE_DURATION_MS });
      ty.value = withTiming(y, { duration: MOVE_DURATION_MS });
      opacity.value = withTiming(1, { duration: 160 });
    }
  }, [x, y, reducedMotion, tx, ty, opacity]);

  const style = useAnimatedStyle(() => ({
    position: "absolute" as const,
    left: tx.value,
    top: ty.value,
    opacity: opacity.value,
  }));

  return (
    <Animated.View style={style} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <PexMascot pose={pose} state={state} tone={tone} size={size} reducedMotion={reducedMotion} />
    </Animated.View>
  );
}
