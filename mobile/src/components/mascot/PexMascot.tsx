import { useEffect, useId } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, ClipPath, Defs, Ellipse, G, Line, Path, RadialGradient, Rect, Stop, Text as SvgText } from "react-native-svg";
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { colors } from "../../lib/theme";
import { MASCOT_SIZE } from "../../lib/tour/tourConfig";
import { DEFAULT_POSE_FOR_STATE, type PexMascotState, type PexPose, type PexTone } from "../../lib/tour/mascotPoses";
import { FACE_FOR_LEGACY_POSE, PEX_FACES, type PexFace, type PexFaceSpec, type PexMotion } from "../../lib/pex/faces";

const AnimatedRect = Animated.createAnimatedComponent(Rect);
const AnimatedEllipse = Animated.createAnimatedComponent(Ellipse);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const BLINK_CLOSE_MS = 90;
const BLINK_OPEN_MS = 140;
const BLINK_MIN_GAP_MS = 2400;
const BLINK_MAX_GAP_MS = 5200;
const LASH = "#05070a";

const RING_COLOR: Record<PexTone, string> = {
  ready: colors.progress,
  caution: colors.warn,
  alert: colors.bad,
};

export type PexMascotProps = {
  /** Expression. Wins over `pose`. */
  face?: PexFace;
  /** Older pose names (guided tour, reaction overlay). */
  pose?: PexPose;
  state?: PexMascotState;
  tone?: PexTone;
  size?: number;
  reducedMotion?: boolean;
  /** Today's progress, 0..1, drawn as the ring. Omit for a full ring. */
  progress?: number;
  /** Orange spark at the tip of the ring (a live streak). */
  spark?: boolean;
  /** A little hand pops out and waves (greetings). */
  wave?: boolean;
  /** Extra gaze from outside (eyes following a finger), in tenths of the eye radius. */
  lookX?: SharedValue<number>;
  lookY?: SharedValue<number>;
};

/** One eyeball: shaded white, black iris, two glints, and an eyelid that blinks. */
function Eye({
  id,
  cx,
  cy,
  r,
  lid,
  spec,
  side,
  blink,
  glance,
  lookX,
  lookY,
}: {
  id: string;
  cx: number;
  cy: number;
  r: number;
  lid: number;
  spec: PexFaceSpec;
  side: "left" | "right";
  blink: SharedValue<number>;
  glance: SharedValue<number>;
  lookX?: SharedValue<number>;
  lookY?: SharedValue<number>;
}) {
  const shut = r * 1.95;
  const ir = r * 0.58;
  const [gx, gy] = spec.gaze;
  const tilt = spec.tilt * (side === "left" ? 1 : -1);

  // Lid edge position: resting closure, pushed fully shut while blinking.
  const lidRect = useAnimatedProps(() => {
    const d = (lid + (1 - lid) * blink.value) * shut;
    return { y: cy - r * 3.2 + d };
  });
  const lidEdge = useAnimatedProps(() => {
    const d = (lid + (1 - lid) * blink.value) * shut;
    return { cy: cy - r + d };
  });
  const restX = cx + (gx * r) / 10;
  const restY = cy + (gy * r) / 10;
  const iris = useAnimatedProps(() => ({ cx: restX + ((glance.value + (lookX?.value ?? 0)) * r) / 10, cy: restY + ((lookY?.value ?? 0) * r) / 10 }));
  const glintBig = useAnimatedProps(() => ({ cx: restX - ir * 0.36 + ((glance.value + (lookX?.value ?? 0)) * r) / 10, cy: restY - ir * 0.4 + ((lookY?.value ?? 0) * r) / 10 }));
  const glintSmall = useAnimatedProps(() => ({ cx: restX + ir * 0.3 + ((glance.value + (lookX?.value ?? 0)) * r) / 10, cy: restY + ir * 0.3 + ((lookY?.value ?? 0) * r) / 10 }));

  return (
    <G>
      <Defs>
        <RadialGradient id={`${id}s`} cx="38%" cy="32%" r="75%">
          <Stop offset="0" stopColor="#ffffff" />
          <Stop offset="0.55" stopColor="#eef2f6" />
          <Stop offset="1" stopColor="#b9c3ce" />
        </RadialGradient>
        <RadialGradient id={`${id}i`} cx="42%" cy="38%" r="70%">
          <Stop offset="0" stopColor="#0b0b0c" />
          <Stop offset="0.62" stopColor="#050506" />
          <Stop offset="0.86" stopColor="#3b424c" />
          <Stop offset="1" stopColor="#000000" />
        </RadialGradient>
        <ClipPath id={`${id}c`}>
          <Circle cx={cx} cy={cy} r={r} />
        </ClipPath>
      </Defs>
      <Circle cx={cx} cy={cy + r * 0.12} r={r * 1.04} fill="#000" opacity={0.35} />
      <G clipPath={`url(#${id}c)`}>
        <Circle cx={cx} cy={cy} r={r} fill={`url(#${id}s)`} />
        <AnimatedCircle animatedProps={iris} r={ir} fill={`url(#${id}i)`} />
        <AnimatedCircle animatedProps={iris} r={ir * 0.5} fill="#000" />
        <AnimatedCircle animatedProps={glintBig} r={ir * 0.3} fill="#fff" />
        <AnimatedCircle animatedProps={glintSmall} r={ir * 0.12} fill="#fff" opacity={0.85} />
        <Circle cx={cx} cy={cy} r={r} fill="none" stroke="#000" strokeOpacity={0.18} strokeWidth={r * 0.18} />
        {spec.smile ? (
          <>
            <Ellipse cx={cx} cy={cy + r * 1.28} rx={r * 1.35} ry={r * 0.82} fill={colors.surfaceRaised} />
            <Path d={`M${cx - r * 1.1} ${cy + r * 0.62} Q${cx} ${cy + r * 0.2} ${cx + r * 1.1} ${cy + r * 0.62}`} stroke={LASH} strokeWidth={r * 0.1} fill="none" />
          </>
        ) : null}
        <G rotation={tilt} origin={`${cx}, ${cy}`}>
          <AnimatedEllipse animatedProps={lidEdge} cx={cx} rx={r * 1.6} ry={r * 0.42} fill={colors.surfaceRaised} />
          <AnimatedEllipse animatedProps={lidEdge} cx={cx} rx={r * 1.25} ry={r * 0.36} fill="none" stroke={LASH} strokeWidth={r * 0.13} />
          <AnimatedRect animatedProps={lidRect} x={cx - r * 1.6} width={r * 3.2} height={r * 2.2} fill={colors.surfaceRaised} />
        </G>
      </G>
      <Circle cx={cx} cy={cy} r={r} fill="none" stroke={LASH} strokeWidth={r * 0.08} />
    </G>
  );
}

function Mouth({ kind }: { kind: PexFaceSpec["mouth"] }) {
  switch (kind) {
    case "grin":
      return (
        <>
          <Path d="M49 74 Q60 90 71 74 Z" fill={LASH} />
          <Path d="M54 80 Q60 84 66 80" stroke={colors.bad} strokeWidth={3} fill="none" strokeLinecap="round" />
        </>
      );
    case "o":
      return <Ellipse cx={60} cy={79} rx={4.2} ry={5} fill={LASH} stroke={colors.ink} strokeWidth={1.6} />;
    case "flat":
      return <Path d="M54 79 L66 79" stroke={colors.ink} strokeWidth={3} strokeLinecap="round" />;
    case "smirk":
      return <Path d="M53 79 Q62 83 68 75" stroke={colors.ink} strokeWidth={3} fill="none" strokeLinecap="round" />;
    case "worried":
      return <Path d="M53 82 Q60 76 67 82" stroke={colors.ink} strokeWidth={3} fill="none" strokeLinecap="round" />;
    default:
      return <Path d="M52 76 Q60 84 68 76" stroke={colors.ink} strokeWidth={3} fill="none" strokeLinecap="round" />;
  }
}

function Extra({ kind }: { kind: PexFaceSpec["extra"] }) {
  if (kind === "zzz") {
    return (
      <G>
        <SvgText x={76} y={38} fontSize={12} fontWeight="800" fill={colors.ink}>z</SvgText>
        <SvgText x={84} y={30} fontSize={9} fontWeight="800" fill={colors.ink}>z</SvgText>
      </G>
    );
  }
  if (kind === "drop") return <Path d="M85 28 q5 8 0 11 q-5 -3 0 -11z" fill="#5aa9ff" />;
  if (kind === "sweat") return <Path d="M86 32 q4 7 0 10 q-4 -3 0 -10z" fill={colors.progress} />;
  return null;
}

/** Body motion per face, as a translate (px of the 120 box) and a rotation. */
function useBodyMotion(motion: PexMotion, enabled: boolean) {
  const ty = useSharedValue(0);
  const rot = useSharedValue(0);
  useEffect(() => {
    ty.value = 0;
    rot.value = 0;
    if (!enabled) return;
    const ease = Easing.inOut(Easing.sin);
    switch (motion) {
      case "bounce":
        ty.value = withRepeat(
          withSequence(withTiming(-7, { duration: 360, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 260, easing: Easing.in(Easing.quad) }), withTiming(-2, { duration: 120 }), withTiming(0, { duration: 120 }), withTiming(0, { duration: 500 })),
          -1,
        );
        break;
      case "shake":
        rot.value = withRepeat(
          withSequence(withDelay(1800, withTiming(-5, { duration: 120 })), withTiming(5, { duration: 140 }), withTiming(-3, { duration: 120 }), withTiming(2, { duration: 110 }), withTiming(0, { duration: 110 })),
          -1,
        );
        break;
      case "droop":
        ty.value = withRepeat(withSequence(withTiming(3, { duration: 2000, easing: ease }), withTiming(1, { duration: 2000, easing: ease })), -1);
        break;
      case "lean":
        rot.value = withRepeat(withSequence(withTiming(6, { duration: 1200, easing: ease }), withTiming(0, { duration: 1200, easing: ease })), -1);
        break;
      default:
        ty.value = withRepeat(withSequence(withTiming(-2.5, { duration: 1700, easing: ease }), withTiming(0, { duration: 1700, easing: ease })), -1);
    }
  }, [motion, enabled, ty, rot]);
  return { ty, rot };
}

/**
 * Pex: today's ring with a face inside. The ring shows real progress, the
 * eyes are shaded 3D eyeballs whose lids blink and set the mood, and the body
 * moves with the expression. Faces come from lib/pex/faces.ts; which face to
 * show comes from lib/pex/brain.ts.
 */
export function PexMascot({ face, pose, state = "waiting", tone = "ready", size = MASCOT_SIZE, reducedMotion = false, progress, spark = false, wave = false, lookX, lookY }: PexMascotProps) {
  const resolvedFace: PexFace = face ?? FACE_FOR_LEGACY_POSE[pose ?? DEFAULT_POSE_FOR_STATE[state]] ?? "ready";
  const spec = PEX_FACES[resolvedFace];
  const id = `pex${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const ringColor = RING_COLOR[tone];
  const p = progress == null ? 1 : Math.max(0, Math.min(1, progress));
  const r = 48;
  const len = 2 * Math.PI * r;
  const tipAngle = ((-90 + p * 360) * Math.PI) / 180;
  const tipX = 60 + r * Math.cos(tipAngle);
  const tipY = 60 + r * Math.sin(tipAngle);

  // Blink: 0 open, 1 shut, on a random gap so Pex never looks mechanical.
  const blink = useSharedValue(0);
  useEffect(() => {
    if (reducedMotion) {
      blink.value = 0;
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const gap = BLINK_MIN_GAP_MS + Math.random() * (BLINK_MAX_GAP_MS - BLINK_MIN_GAP_MS);
      timer = setTimeout(() => {
        if (cancelled) return;
        blink.value = withSequence(withTiming(1, { duration: BLINK_CLOSE_MS }), withTiming(0, { duration: BLINK_OPEN_MS }));
        schedule();
      }, gap);
    };
    schedule();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [reducedMotion, blink]);

  // Glance: relaxed faces look left and right now and then.
  const glance = useSharedValue(0);
  useEffect(() => {
    glance.value = 0;
    if (reducedMotion || !spec.roam) return;
    glance.value = withRepeat(
      withSequence(withDelay(2600, withTiming(1.8, { duration: 260 })), withDelay(1200, withTiming(-1.8, { duration: 320 })), withDelay(1200, withTiming(0, { duration: 260 }))),
      -1,
    );
  }, [reducedMotion, spec.roam, glance]);

  const { ty, rot } = useBodyMotion(spec.motion, !reducedMotion);
  const speak = useSharedValue(1);
  useEffect(() => {
    speak.value = 1;
    if (reducedMotion || state !== "speaking") return;
    speak.value = withRepeat(withSequence(withTiming(1.05, { duration: 220 }), withTiming(1, { duration: 220 })), -1, true);
  }, [reducedMotion, state, speak]);

  // The ring tweens to new progress, so it visibly closes when Pex lands or a log lands.
  const ringP = useSharedValue(p);
  useEffect(() => {
    ringP.value = reducedMotion ? p : withTiming(p, { duration: 750, easing: Easing.out(Easing.cubic) });
  }, [p, reducedMotion, ringP]);
  const ringProps = useAnimatedProps(() => ({ strokeDashoffset: len * (1 - ringP.value) }));

  const waveRot = useSharedValue(0);
  const waveScale = useSharedValue(0);
  useEffect(() => {
    if (!wave) {
      waveScale.value = withTiming(0, { duration: 160 });
      waveRot.value = 0;
      return;
    }
    waveScale.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.back(2)) });
    waveRot.value = reducedMotion ? 0 : withDelay(200, withRepeat(withSequence(withTiming(-22, { duration: 210 }), withTiming(20, { duration: 210 })), 4, true));
  }, [wave, reducedMotion, waveRot, waveScale]);
  const handStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${waveRot.value}deg` }, { scale: waveScale.value }] }));

  const unit = size / 128;
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: ty.value * unit }, { rotate: `${rot.value}deg` }, { scale: speak.value }],
  }));

  return (
    <Animated.View style={[{ width: size, height: size }, animatedStyle]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Svg width={size} height={size} viewBox="-4 -4 128 128">
        <Circle cx={60} cy={60} r={r} stroke={colors.surfaceInset} strokeWidth={9} fill="none" />
        <G rotation={-90} origin="60, 60">
          <AnimatedCircle animatedProps={ringProps} cx={60} cy={60} r={r} stroke={ringColor} strokeWidth={9} fill="none" strokeLinecap="round" strokeDasharray={`${len} ${len}`} />
        </G>
        {resolvedFace === "proud"
          ? [0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
              const t = (deg * Math.PI) / 180;
              return <Line key={deg} x1={60 + 55 * Math.cos(t)} y1={60 + 55 * Math.sin(t)} x2={60 + 59 * Math.cos(t)} y2={60 + 59 * Math.sin(t)} stroke={colors.energy} strokeWidth={3} strokeLinecap="round" />;
            })
          : null}
        <Circle cx={60} cy={60} r={38} fill={colors.surfaceRaised} stroke={colors.line} strokeWidth={1.5} />
        <Eye id={`${id}l`} cx={46} cy={54} r={12.5} lid={spec.lidLeft} spec={spec} side="left" blink={blink} glance={glance} lookX={lookX} lookY={lookY} />
        <Eye id={`${id}r`} cx={74} cy={54} r={12.5} lid={spec.lidRight} spec={spec} side="right" blink={blink} glance={glance} lookX={lookX} lookY={lookY} />
        <Mouth kind={spec.mouth} />
        {spark && p > 0.001 ? (
          <>
            <Circle cx={tipX} cy={tipY} r={9} fill={colors.energy} opacity={0.25} />
            <Circle cx={tipX} cy={tipY} r={5.5} fill={colors.energy} />
          </>
        ) : null}
        <Extra kind={spec.extra} />
      </Svg>
      <Animated.View pointerEvents="none" style={[pexHandStyles.hand, { right: -size * 0.04, bottom: size * 0.22, width: size * 0.2, height: size * 0.3 }, handStyle]}>
        <View style={[pexHandStyles.arm, { width: size * 0.05, height: size * 0.14 }]} />
        <View style={[pexHandStyles.mitten, { width: size * 0.16, height: size * 0.16, borderRadius: size * 0.08 }]} />
      </Animated.View>
    </Animated.View>
  );
}

const pexHandStyles = StyleSheet.create({
  // Pivot at the bottom so the wave swings from the shoulder.
  hand: { position: "absolute", alignItems: "center", flexDirection: "column-reverse", transformOrigin: "bottom" },
  arm: { backgroundColor: colors.surfaceRaised, borderRadius: 4 },
  mitten: { backgroundColor: colors.primary, borderWidth: 2, borderColor: colors.surface },
});
