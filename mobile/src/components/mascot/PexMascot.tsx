import Svg, { Circle, Ellipse, Line, Path, Rect } from "react-native-svg";
import Animated, {
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useEffect } from "react";
import { colors, ROLE_THEMES } from "../../lib/theme";
import { MASCOT_ANATOMY, MASCOT_SIZE } from "../../lib/tour/tourConfig";
import {
  DEFAULT_POSE_FOR_STATE,
  PEX_POSES,
  type ColorToken,
  type PexEyeSpec,
  type PexMascotState,
  type PexPose,
  type PexShape,
  type PexTone,
} from "../../lib/tour/mascotPoses";

const AnimatedEllipse = Animated.createAnimatedComponent(Ellipse);

/** How nearly-shut a blinking eye gets — a sliver, not zero, so it still reads as an eyelid line rather than a vanishing dot. */
const BLINK_CLOSED_RY = 0.8;
const BLINK_CLOSE_MS = 90;
const BLINK_OPEN_MS = 130;
const BLINK_MIN_GAP_MS = 2200;
const BLINK_MAX_GAP_MS = 4800;

/** A single open eye that periodically animates shut and back open (see the blink scheduler in `PexMascot`). */
function BlinkingEye({ eye, fill, blink }: { eye: PexEyeSpec; fill: string; blink: SharedValue<number> }) {
  const animatedProps = useAnimatedProps(() => ({
    ry: eye.ry - (eye.ry - BLINK_CLOSED_RY) * blink.value,
  }));
  return <AnimatedEllipse cx={eye.cx} cy={eye.cy} rx={eye.rx} animatedProps={animatedProps} fill={fill} />;
}

export type PexMascotProps = {
  pose?: PexPose;
  state?: PexMascotState;
  tone?: PexTone;
  size?: number;
  reducedMotion?: boolean;
};

const TONE_COLOR: Record<PexTone, string> = {
  ready: colors.ok,
  caution: colors.warn,
  alert: colors.bad,
};

function resolveColor(token: ColorToken, tone: PexTone): string {
  switch (token) {
    case "tone":
      return TONE_COLOR[tone];
    case "line":
      return colors.ink;
    case "ready":
      return colors.ok;
    case "caution":
      return colors.warn;
    case "alert":
      return colors.bad;
    case "coach":
      return ROLE_THEMES.coach.accent;
    case "athlete":
      return ROLE_THEMES.athlete.accent;
    case "guardian":
      return ROLE_THEMES.guardian.accent;
    default:
      return colors.ink;
  }
}

function renderShape(shape: PexShape, tone: PexTone, key: number) {
  switch (shape.kind) {
    case "path":
      return (
        <Path
          key={key}
          d={shape.d}
          stroke={resolveColor(shape.stroke, tone)}
          strokeWidth={shape.strokeWidth}
          fill={"fill" in shape && shape.fill ? shape.fill : "none"}
          opacity={"opacity" in shape ? shape.opacity : undefined}
          strokeLinecap={"linecap" in shape ? shape.linecap : undefined}
          strokeLinejoin={"linejoin" in shape ? shape.linejoin : undefined}
        />
      );
    case "ellipse":
      return (
        <Ellipse
          key={key}
          cx={shape.cx}
          cy={shape.cy}
          rx={shape.rx}
          ry={shape.ry}
          fill={shape.fill ? resolveColor(shape.fill, tone) : "none"}
          stroke={shape.stroke ? resolveColor(shape.stroke, tone) : undefined}
          strokeWidth={shape.strokeWidth}
        />
      );
    case "circle":
      return <Circle key={key} cx={shape.cx} cy={shape.cy} r={shape.r} fill={resolveColor(shape.fill, tone)} />;
    case "rect":
      return (
        <Rect
          key={key}
          x={shape.x}
          y={shape.y}
          width={shape.width}
          height={shape.height}
          rx={shape.rx}
          fill={resolveColor(shape.fill, tone)}
        />
      );
    case "line":
      return (
        <Line
          key={key}
          x1={shape.x1}
          y1={shape.y1}
          x2={shape.x2}
          y2={shape.y2}
          stroke={resolveColor(shape.stroke, tone)}
          strokeWidth={shape.strokeWidth}
          strokeLinecap="round"
          opacity={shape.opacity}
        />
      );
    default:
      return null;
  }
}

/**
 * Pure SVG visual for Pex. `pose` drives the face + accessory mark; `state`
 * only adds a motion trail (walking) or a gentle breathing pulse (speaking) on
 * top — see `mascotPoses.ts` for the data tables this renders generically.
 */
export function PexMascot({ pose, state = "waiting", tone = "ready", size = MASCOT_SIZE, reducedMotion = false }: PexMascotProps) {
  const resolvedPose = pose ?? DEFAULT_POSE_FOR_STATE[state];
  const spec = PEX_POSES[resolvedPose] ?? PEX_POSES.neutral;
  const toneColor = TONE_COLOR[tone];
  const { viewBox, ring, body } = MASCOT_ANATOMY;

  const pulse = useSharedValue(1);
  useEffect(() => {
    if (reducedMotion || state !== "speaking") {
      pulse.value = 1;
      return;
    }
    pulse.value = withRepeat(withSequence(withTiming(1.06, { duration: 220 }), withTiming(1, { duration: 220 })), -1, true);
  }, [reducedMotion, state, pulse]);

  const bounce = useSharedValue(0);
  useEffect(() => {
    if (reducedMotion || (state !== "waiting" && state !== "listening")) {
      bounce.value = 0;
      return;
    }
    bounce.value = withRepeat(withSequence(withTiming(-4, { duration: 620 }), withTiming(0, { duration: 620 })), -1, true);
  }, [reducedMotion, state, bounce]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: bounce.value }, { scale: pulse.value }],
  }));

  // Idle blink: 0 = open, 1 = shut. Runs on a randomized loop so Pex reads as
  // alive rather than a static sticker; skipped entirely under reduced motion.
  const blink = useSharedValue(0);
  useEffect(() => {
    if (reducedMotion) {
      blink.value = 0;
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const scheduleNextBlink = () => {
      const gap = BLINK_MIN_GAP_MS + Math.random() * (BLINK_MAX_GAP_MS - BLINK_MIN_GAP_MS);
      timer = setTimeout(() => {
        if (cancelled) return;
        blink.value = withSequence(withTiming(1, { duration: BLINK_CLOSE_MS }), withTiming(0, { duration: BLINK_OPEN_MS }));
        scheduleNextBlink();
      }, gap);
    };
    scheduleNextBlink();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [reducedMotion, blink]);

  return (
    <Animated.View style={[{ width: size, height: size }, animatedStyle]} importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size} viewBox={viewBox}>
        <Circle
          cx={ring.cx}
          cy={ring.cy}
          r={ring.r}
          fill="none"
          stroke={toneColor}
          strokeWidth={ring.strokeWidth}
          strokeLinecap="round"
          strokeDasharray={spec.ringDasharray ?? undefined}
          transform={spec.ringDasharray ? `rotate(-90 ${ring.cx} ${ring.cy})` : undefined}
        />
        {state === "walking" ? (
          <>
            <Line x1={46} y1={142} x2={30} y2={160} stroke={toneColor} strokeWidth={4} strokeLinecap="round" opacity={0.55} />
            <Line x1={58} y1={152} x2={46} y2={172} stroke={toneColor} strokeWidth={4} strokeLinecap="round" opacity={0.35} />
          </>
        ) : null}
        <Circle cx={body.cx} cy={body.cy} r={body.r} fill={colors.surfaceRaised} stroke={colors.ink} strokeWidth={body.strokeWidth} />
        {spec.face.map((shape, i) => renderShape(shape, tone, i))}
        {spec.eyes.map((eye, i) => (
          <BlinkingEye key={i} eye={eye} fill={resolveColor(eye.fill ?? "line", tone)} blink={blink} />
        ))}
        {spec.accessory.map((shape, i) => renderShape(shape, tone, 100 + i))}
      </Svg>
    </Animated.View>
  );
}
