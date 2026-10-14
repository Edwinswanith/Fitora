import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { colors } from "../../lib/theme";

export type PexBurstKind = "dust" | "spark";

/**
 * A short particle burst around (x, y) inside its parent: dust puffs that
 * roll out sideways when Pex lands, or orange sparks for streaks and taps.
 * Plays each time `play` changes to a new non-zero value.
 */
export function PexBurst({ x, y, kind, count, play }: { x: number; y: number; kind: PexBurstKind; count: number; play: number }) {
  const t = useSharedValue(1);
  useEffect(() => {
    if (!play) return;
    t.value = 0;
    t.value = withTiming(1, { duration: kind === "dust" ? 700 : 900, easing: Easing.out(Easing.quad) });
  }, [play, kind, t]);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {Array.from({ length: count }, (_, i) => (
        <Particle key={i} i={i} n={count} x={x} y={y} kind={kind} t={t} />
      ))}
    </View>
  );
}

function Particle({ i, n, x, y, kind, t }: { i: number; n: number; x: number; y: number; kind: PexBurstKind; t: SharedValue<number> }) {
  const dust = kind === "dust";
  // Dust rolls out left and right along the ground; sparks fly every way.
  const angle = dust ? Math.PI * (0.15 + (0.7 * i) / Math.max(1, n - 1)) : (2 * Math.PI * i) / n + 0.35;
  const dist = dust ? 38 + (i % 3) * 8 : 46 + (i % 3) * 10;
  const side = dust ? (i % 2 ? 1 : -1) : 1;
  const size = dust ? 15 : 6;
  const style = useAnimatedStyle(() => {
    const v = t.value;
    const dx = Math.cos(angle) * dist * v * side;
    const dy = dust ? -0.3 * dist * v : -Math.sin(angle) * dist * v;
    return {
      opacity: v >= 1 ? 0 : (dust ? 0.9 : 1) * (1 - v),
      transform: [{ translateX: dx }, { translateY: dy }, { scale: dust ? 0.7 + 1.3 * v : 1 - 0.4 * v }],
    };
  });
  return (
    <Animated.View
      style={[
        styles.particle,
        { left: x - size / 2, top: y - size / 2, width: size, height: size, borderRadius: size / 2, backgroundColor: dust ? "rgba(242,245,248,0.62)" : colors.energy },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  particle: { position: "absolute", opacity: 0 },
});
