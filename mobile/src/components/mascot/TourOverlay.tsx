import { useEffect, useRef, useState } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Mask, Rect } from "react-native-svg";
import { useMobileTour } from "../../lib/tour/MobileTourProvider";
import { ROLE_THEMES } from "../../lib/theme";
import { computeFallbackPlacement, computeTourGroupPlacement } from "../../lib/tour/placement";
import { DEFAULT_SPOTLIGHT_PADDING, MASCOT_SIZE, MOVE_DURATION_MS, SPOTLIGHT_RADIUS } from "../../lib/tour/tourConfig";
import { useOsReducedMotion } from "../../lib/tour/useReducedMotion";
import { MascotAnimation } from "./MascotAnimation";
import { SpeechBubble } from "./SpeechBubble";

const BUBBLE_GAP = 10;

/**
 * Replaces the old fixed top/bottom `<Modal>` dialog. Renders as a plain
 * absolutely-positioned View (never RN `Modal`) so the dim+cutout can sit
 * behind Pex and the bubble while the real, highlighted content stays drawn
 * beneath it — this is what avoids the Android Modal-layering problem the
 * original dialog's own comment described (a Modal always composites in its
 * own layer above real content, so a Modal-based dim would wash out the very
 * target it's supposed to highlight).
 *
 * Renders exactly one `<MascotAnimation>` across the whole component,
 * including the post-completion "landing" phase (see `finish` in the
 * provider) — keeping it a single instance is what makes the flight from the
 * last tour step to the header badge read as one continuous mascot moving,
 * instead of one disappearing and a different one popping in.
 */
export function TourOverlay() {
  const { state, next, back, skip, playAudio, pauseAudio, replayAudio, prefs } = useMobileTour();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const osReducedMotion = useOsReducedMotion();
  const reducedMotion = osReducedMotion || !prefs.mascotAnimationsEnabled;

  const currentStep = state.steps[state.index] ?? null;
  const isLast = state.index >= state.steps.length - 1;
  const theme = state.role ? ROLE_THEMES[state.role] : ROLE_THEMES.athlete;
  const rect = state.activeRect;

  const [walking, setWalking] = useState(false);
  const prevStepIdRef = useRef<string | null>(null);
  useEffect(() => {
    const stepId = currentStep?.id ?? null;
    if (state.landing || !stepId || stepId === prevStepIdRef.current) return;
    prevStepIdRef.current = stepId;
    if (reducedMotion) {
      setWalking(false);
      return;
    }
    setWalking(true);
    const t = setTimeout(() => setWalking(false), MOVE_DURATION_MS);
    return () => clearTimeout(t);
  }, [currentStep?.id, reducedMotion, state.landing]);

  if (!state.active) return null;

  const padding = { ...DEFAULT_SPOTLIGHT_PADDING, ...currentStep?.spotlightPadding };
  const radius = currentStep?.spotlightRadius ?? SPOTLIGHT_RADIUS;
  // The visual highlight is the target rect expanded by padding — placement
  // clears *this* box, not the raw target, so the mascot/bubble never overlap
  // the padded glow either (only the true unhighlighted screen area).
  const paddedRect = rect
    ? { x: rect.x - padding.left, y: rect.y - padding.top, width: rect.width + padding.left + padding.right, height: rect.height + padding.top + padding.bottom }
    : null;

  // A step's target can legitimately never mount (e.g. the guardian athlete
  // switcher only renders with 2+ linked athletes) while the step itself
  // still reports ready — without this fallback the overlay would render
  // nothing at all: a silent stall with no dim, no mascot, and no bubble.
  const placement =
    !state.landing && paddedRect
      ? computeTourGroupPlacement(paddedRect, { width, height }, insets)
      : !state.landing && state.ready
        ? computeFallbackPlacement({ width, height }, insets, currentStep?.cardPosition)
        : null;
  const hasRealTarget = Boolean(rect) && !state.landing;

  const landingSize = state.landing && rect ? Math.max(28, Math.min(rect.width, rect.height)) : MASCOT_SIZE;
  const mascotX = state.landing && rect ? rect.x + rect.width / 2 - landingSize / 2 : (placement?.x ?? null);
  const mascotY = state.landing && rect ? rect.y + rect.height / 2 - landingSize / 2 : (placement?.y ?? null);
  const mascotPose = state.landing ? "celebrating" : currentStep?.mascotPose;
  const mascotState = state.landing ? "walking" : walking ? "walking" : state.audioSpeaking ? "speaking" : "pointing";
  const mascotTone = state.landing ? "ready" : (currentStep?.mascotTone ?? "ready");

  const bubbleX = placement ? placement.x + MASCOT_SIZE + BUBBLE_GAP : 0;
  const bubbleWidth = placement ? Math.max(160, placement.width - MASCOT_SIZE - BUBBLE_GAP) : 0;
  const bubblePointerX = placement ? Math.min(Math.max(placement.pointerX - (MASCOT_SIZE + BUBBLE_GAP), 24), bubbleWidth - 24) : 0;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {paddedRect && !state.landing ? (
        <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
          <Mask id="pex-spotlight-mask">
            <Rect x={0} y={0} width={width} height={height} fill="#ffffff" />
            <Rect x={paddedRect.x} y={paddedRect.y} width={paddedRect.width} height={paddedRect.height} rx={radius} fill="#000000" />
          </Mask>
          <Rect x={0} y={0} width={width} height={height} fill="#000000" opacity={0.55} mask="url(#pex-spotlight-mask)" />
          <Rect
            x={paddedRect.x}
            y={paddedRect.y}
            width={paddedRect.width}
            height={paddedRect.height}
            rx={radius}
            fill="none"
            stroke={theme.accent}
            strokeWidth={3}
          />
        </Svg>
      ) : null}

      {mascotX !== null && mascotY !== null ? (
        <MascotAnimation
          x={mascotX}
          y={mascotY}
          pose={mascotPose}
          state={mascotState}
          tone={mascotTone}
          size={landingSize}
          reducedMotion={reducedMotion}
        />
      ) : null}

      {placement && !state.landing && state.ready ? (
        <SpeechBubble
          x={bubbleX}
          y={placement.y}
          width={bubbleWidth}
          side={placement.side}
          pointerX={bubblePointerX}
          showPointer={hasRealTarget}
          title={currentStep?.title ?? "Tour"}
          note={state.note ?? currentStep?.fallbackNote ?? ""}
          theme={theme}
          index={state.index}
          total={state.steps.length}
          isLast={isLast}
          backDisabled={state.index === 0}
          onSkip={skip}
          onBack={back}
          onNext={next}
          audioEnabled={state.audioEnabled}
          audioSpeaking={state.audioSpeaking}
          onPlayAudio={playAudio}
          onPauseAudio={pauseAudio}
          onReplayAudio={replayAudio}
          reducedMotion={reducedMotion}
        />
      ) : null}
    </View>
  );
}
