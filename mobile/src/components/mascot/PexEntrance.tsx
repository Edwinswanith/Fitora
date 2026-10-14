import { useEffect, useMemo } from "react";
import { Modal, Pressable, StyleSheet, useWindowDimensions } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { colors } from "../../lib/theme";
import { impactFeedback } from "../../lib/feedback";
import type { PexRect } from "../../lib/pex/anchors";
import type { PexFace } from "../../lib/pex/faces";
import { PexMascot } from "./PexMascot";

const AnimatedPath = Animated.createAnimatedComponent(Path);

const LAUNCH_MS = 380;
const FLIGHT_MS = 1300;
const LAND_MS = 420;
const TOTAL_MS = LAUNCH_MS + FLIGHT_MS + LAND_MS;

type Route = { xs: number[]; ys: number[]; at: number[]; d: string; length: number };

/** A smooth route out of the profile picture, down the screen, through a loop, and into the slot. */
function buildRoute(a: { x: number; y: number }, s: { x: number; y: number }, width: number, size: number): Route {
  const clampX = (x: number) => Math.max(size / 2, Math.min(width - size / 2, x));
  const pts: [number, number][] = [
    [a.x, a.y],
    [a.x - 30, a.y + 70],
    [a.x - 80, a.y + 210],
    [a.x - 150, a.y + 300],
    [s.x + 70, s.y + 250],
    [s.x + 20, s.y + 190],
    [s.x + 60, s.y + 130],
    [s.x + 110, s.y + 175],
    [s.x + 70, s.y + 220],
    [s.x + 10, s.y + 90],
    [s.x, s.y],
  ].map(([x, y]) => [clampX(x), y] as [number, number]);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let step = 0; step < 24; step += 1) {
      const t = step / 24;
      const t2 = t * t;
      const t3 = t2 * t;
      const point = [0, 1].map((k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3));
      xs.push(point[0]);
      ys.push(point[1]);
    }
  }
  xs.push(s.x);
  ys.push(s.y);
  const lens = [0];
  for (let i = 1; i < xs.length; i += 1) lens.push(lens[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]));
  const length = lens[lens.length - 1] || 1;
  const d = xs.map((x, i) => `${i ? "L" : "M"}${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(" ");
  return { xs, ys, at: lens.map((l) => l / length), d, length };
}

/**
 * Pex's daily entrance: it pops out of the profile picture in pilot goggles,
 * swoops down the screen with a barrel roll, and lands in its spot on the
 * Today card. One tap anywhere lands it at once. The parent then shows the
 * welcome (ring closes, wave, greeting).
 */
export function PexEntrance({ from, to, size, face, streak, onLanded }: { from: PexRect; to: PexRect; size: number; face: PexFace; streak: boolean; onLanded: () => void }) {
  const { width } = useWindowDimensions();
  const a = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  const s = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
  const route = useMemo(() => buildRoute(a, s, width, size), [a.x, a.y, s.x, s.y, width, size]); // eslint-disable-line react-hooks/exhaustive-deps
  const { xs, ys, at } = route;
  const clock = useSharedValue(0);

  useEffect(() => {
    clock.value = withTiming(TOTAL_MS, { duration: TOTAL_MS, easing: Easing.linear }, (finished) => {
      if (finished) runOnJS(onLanded)();
    });
    return () => cancelAnimation(clock);
  }, [clock, onLanded]);

  // A soft bump the moment Pex touches down.
  useAnimatedReaction(
    () => clock.value >= LAUNCH_MS + FLIGHT_MS,
    (landed, before) => {
      if (landed && !before) runOnJS(impactFeedback)();
    },
  );

  const pexStyle = useAnimatedStyle(() => {
    const el = clock.value;
    let x = a.x;
    let y = a.y;
    let scaleX = 1;
    let scaleY = 1;
    let rotZ = 0;
    let rotY = 0;
    let rotX = 0;
    if (el < LAUNCH_MS) {
      const u = el / LAUNCH_MS;
      const back = 1 + 2.4 * Math.pow(u - 1, 3) + 1.4 * Math.pow(u - 1, 2);
      x = a.x - 8 * u;
      y = a.y - 18 * Math.sin(u * Math.PI);
      scaleX = scaleY = 0.18 + 0.27 * back;
      rotZ = -20 * u;
    } else if (el < LAUNCH_MS + FLIGHT_MS) {
      const r = (el - LAUNCH_MS) / FLIGHT_MS;
      const u = r < 0.5 ? 4 * r * r * r : 1 - Math.pow(-2 * r + 2, 3) / 2;
      let i = 1;
      while (i < at.length - 1 && at[i] < u) i += 1;
      const f = (u - at[i - 1]) / Math.max(1e-6, at[i] - at[i - 1]);
      x = xs[i - 1] + (xs[i] - xs[i - 1]) * f;
      y = ys[i - 1] + (ys[i] - ys[i - 1]) * f;
      const dx = xs[i] - xs[i - 1];
      const dy = ys[i] - ys[i - 1];
      const dl = Math.max(1e-6, Math.hypot(dx, dy));
      const depth = Math.sin(u * Math.PI);
      scaleX = scaleY = 0.45 + 0.55 * u + 0.35 * depth;
      rotZ = Math.max(-35, Math.min(35, (dx / dl) * 35));
      rotX = Math.max(-25, Math.min(25, (-dy / dl) * 20));
      rotY = u > 0.45 && u < 0.8 ? ((u - 0.45) / 0.35) * 360 : 0;
    } else {
      const u = Math.min(1, (el - LAUNCH_MS - FLIGHT_MS) / LAND_MS);
      const squash = Math.sin(u * Math.PI) * (1 - u);
      x = s.x;
      y = s.y + 6 * squash;
      scaleX = 1 + 0.16 * squash;
      scaleY = 1 - 0.18 * squash;
    }
    return {
      transform: [
        { translateX: x - size / 2 },
        { translateY: y - size / 2 },
        { perspective: 800 },
        { rotateZ: `${rotZ}deg` },
        { rotateY: `${rotY}deg` },
        { rotateX: `${rotX}deg` },
        { scaleX },
        { scaleY },
      ],
    };
  });

  // Goggles flip up and the scarf fades as Pex lands.
  const gearStyle = useAnimatedStyle(() => {
    const start = LAUNCH_MS + FLIGHT_MS + LAND_MS * 0.35;
    const g = clock.value < start ? 0 : Math.min(1, (clock.value - start) / (LAND_MS * 0.6));
    return { opacity: 1 - g, transform: [{ translateY: -g * size * 0.28 }, { scale: 1 - 0.18 * g }] };
  });
  const scarfStyle = useAnimatedStyle(() => {
    const el = clock.value;
    let flip = 1;
    if (el >= LAUNCH_MS && el < LAUNCH_MS + FLIGHT_MS) {
      const r = (el - LAUNCH_MS) / FLIGHT_MS;
      const u = r < 0.5 ? 4 * r * r * r : 1 - Math.pow(-2 * r + 2, 3) / 2;
      let i = 1;
      while (i < at.length - 1 && at[i] < u) i += 1;
      flip = xs[i] - xs[i - 1] > 0 ? -1 : 1;
    }
    const fade = el < LAUNCH_MS + FLIGHT_MS ? 1 : Math.max(0, 1 - (el - LAUNCH_MS - FLIGHT_MS) / (LAND_MS * 0.5));
    return { opacity: fade, transform: [{ scaleX: flip }] };
  });

  const trailProps = useAnimatedProps(() => {
    const el = clock.value;
    let u = 0;
    if (el >= LAUNCH_MS + FLIGHT_MS) u = 1;
    else if (el > LAUNCH_MS) {
      const r = (el - LAUNCH_MS) / FLIGHT_MS;
      u = r < 0.5 ? 4 * r * r * r : 1 - Math.pow(-2 * r + 2, 3) / 2;
    }
    const fade = el < LAUNCH_MS + FLIGHT_MS ? 0.7 : Math.max(0, 0.7 * (1 - (el - LAUNCH_MS - FLIGHT_MS) / LAND_MS));
    return { strokeDashoffset: route.length * (1 - u), strokeOpacity: fade };
  });

  const shadowStyle = useAnimatedStyle(() => {
    const el = clock.value;
    if (el < LAUNCH_MS || el > LAUNCH_MS + FLIGHT_MS + LAND_MS * 0.5) return { opacity: 0 };
    const r = Math.min(1, (el - LAUNCH_MS) / FLIGHT_MS);
    const u = r < 0.5 ? 4 * r * r * r : 1 - Math.pow(-2 * r + 2, 3) / 2;
    let i = 1;
    while (i < at.length - 1 && at[i] < u) i += 1;
    const depth = Math.sin(u * Math.PI);
    return {
      opacity: 0.2 + 0.35 * (1 - depth),
      transform: [{ translateX: xs[i] - 30 }, { translateY: s.y + size * 0.5 + depth * 40 }, { scale: 0.6 + 0.6 * (1 - depth) }],
    };
  });

  function skip() {
    cancelAnimation(clock);
    onLanded();
  }

  return (
    <Modal transparent visible animationType="none" statusBarTranslucent onRequestClose={skip}>
      <Pressable style={StyleSheet.absoluteFill} onPress={skip} accessibilityLabel="Skip Pex's entrance" accessibilityRole="button">
        <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
          <AnimatedPath
            d={route.d}
            animatedProps={trailProps}
            stroke={streak ? colors.energy : colors.progress}
            strokeWidth={3}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${route.length} ${route.length}`}
          />
        </Svg>
        <Animated.View pointerEvents="none" style={[styles.shadow, shadowStyle]} />
        <Animated.View pointerEvents="none" style={[styles.pex, { width: size, height: size }, pexStyle]}>
          <Animated.View style={[StyleSheet.absoluteFill, scarfStyle]}>
            <Svg width={size} height={size} viewBox="-4 -4 128 128">
              <Path d="M34 88 C 22 96, 10 94, -2 102 C 8 106, 20 104, 34 98 Z" fill={colors.energy} />
              <Path d="M36 92 C 26 104, 14 108, 2 116 C 14 114, 24 108, 38 100 Z" fill="#e5732a" />
            </Svg>
          </Animated.View>
          <PexMascot face={face} size={size} progress={0} reducedMotion />
          <Animated.View style={[StyleSheet.absoluteFill, gearStyle]}>
            <Svg width={size} height={size} viewBox="-4 -4 128 128">
              <Path d="M22 50 Q60 36 98 50" stroke="#6b4a2e" strokeWidth={7} fill="none" strokeLinecap="round" />
              <Circle cx={46} cy={54} r={15} fill="rgba(255,181,71,0.28)" stroke="#c9a15a" strokeWidth={4} />
              <Circle cx={74} cy={54} r={15} fill="rgba(255,181,71,0.28)" stroke="#c9a15a" strokeWidth={4} />
              <Path d="M58 53 Q60 50 62 53" stroke="#c9a15a" strokeWidth={3} fill="none" />
              <Path d="M38 47 Q42 44 46 45" stroke="#ffffff" strokeWidth={2.2} fill="none" opacity={0.75} strokeLinecap="round" />
              <Path d="M66 47 Q70 44 74 45" stroke="#ffffff" strokeWidth={2.2} fill="none" opacity={0.75} strokeLinecap="round" />
            </Svg>
          </Animated.View>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  pex: { position: "absolute", left: 0, top: 0 },
  shadow: { position: "absolute", left: 0, top: 0, width: 60, height: 14, borderRadius: 30, backgroundColor: "#000000" },
});
