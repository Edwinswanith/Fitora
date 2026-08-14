import { useEffect } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "../AppText";
import { colors, radius, type RoleTheme } from "../../lib/theme";
import { TourControls } from "./TourControls";
import { TourProgress } from "./TourProgress";
import { BUBBLE_ENTER_DURATION_MS } from "../../lib/tour/tourConfig";

type SpeechBubbleProps = {
  x: number;
  y: number;
  width: number;
  side: "above" | "below";
  pointerX: number;
  /** False when there's no real spotlighted target to point at (see `computeFallbackPlacement`) — hides the tail. */
  showPointer?: boolean;
  title: string;
  note: string;
  theme: RoleTheme;
  index: number;
  total: number;
  isLast: boolean;
  backDisabled: boolean;
  onSkip: () => void;
  onBack: () => void;
  onNext: () => void;
  audioEnabled: boolean;
  audioSpeaking: boolean;
  onPlayAudio: () => void;
  onPauseAudio: () => void;
  onReplayAudio: () => void;
  reducedMotion: boolean;
};

const TAIL_SIZE = 10;

/**
 * The tour's anchored card: positioned by `TourOverlay` from the same
 * placement box the mascot walks to, with a small triangular tail pointing
 * back at the spotlighted target. Content (title/note/progress/controls) is
 * unchanged from the old fixed dialog — only the container moved.
 */
export function SpeechBubble(props: SpeechBubbleProps) {
  const { x, y, width, side, pointerX, showPointer = true, title, note, theme, index, total, isLast, backDisabled, onSkip, onBack, onNext } = props;
  const { audioEnabled, audioSpeaking, onPlayAudio, onPauseAudio, onReplayAudio, reducedMotion } = props;

  const opacity = useSharedValue(reducedMotion ? 1 : 0);
  const translateY = useSharedValue(reducedMotion ? 0 : side === "below" ? -10 : 10);

  useEffect(() => {
    opacity.value = reducedMotion ? 1 : withTiming(1, { duration: BUBBLE_ENTER_DURATION_MS });
    translateY.value = reducedMotion ? 0 : withTiming(0, { duration: BUBBLE_ENTER_DURATION_MS });
    // Re-run the entrance whenever the step changes (title changes 1:1 with step).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View
      style={[styles.wrap, { left: x, top: y, width }, animatedStyle]}
      accessibilityViewIsModal
      accessibilityLiveRegion="polite"
    >
      {showPointer && side === "below" ? (
        <View style={[styles.tailUp, { left: pointerX - TAIL_SIZE, borderBottomColor: colors.surfaceRaised }]} />
      ) : null}
      <View style={styles.card}>
        <View style={styles.topRow}>
          <View style={[styles.agentMark, { backgroundColor: theme.accentSoft }]}>
            <Ionicons name="sparkles-outline" size={14} color={theme.accentStrong} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
          </View>
          <Pressable onPress={onSkip} hitSlop={10} style={styles.close} accessibilityRole="button" accessibilityLabel="Skip tour">
            <Ionicons name="close" size={16} color={colors.inkMuted} />
          </Pressable>
        </View>

        <View style={styles.noteBox}>
          <Text style={styles.note} numberOfLines={5}>
            {note}
          </Text>
        </View>

        <TourProgress index={index} total={total} accent={theme.accent} />

        <TourControls
          onSkip={onSkip}
          onBack={onBack}
          onNext={onNext}
          backDisabled={backDisabled}
          isLast={isLast}
          accent={theme.accent}
          accentSoft={theme.accentSoft}
          accentInk={theme.accentInk}
          audioEnabled={audioEnabled}
          audioSpeaking={audioSpeaking}
          onPlayAudio={onPlayAudio}
          onPauseAudio={onPauseAudio}
          onReplayAudio={onReplayAudio}
        />
      </View>
      {showPointer && side === "above" ? (
        <View style={[styles.tailDown, { left: pointerX - TAIL_SIZE, borderTopColor: colors.surfaceRaised }]} />
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute" },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
    padding: 12,
    shadowColor: "#0f172a",
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 26,
  },
  tailUp: {
    position: "absolute",
    top: -TAIL_SIZE + 1,
    width: 0,
    height: 0,
    borderLeftWidth: TAIL_SIZE,
    borderRightWidth: TAIL_SIZE,
    borderBottomWidth: TAIL_SIZE,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
  },
  tailDown: {
    position: "absolute",
    bottom: -TAIL_SIZE + 1,
    width: 0,
    height: 0,
    borderLeftWidth: TAIL_SIZE,
    borderRightWidth: TAIL_SIZE,
    borderTopWidth: TAIL_SIZE,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
  },
  topRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  agentMark: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  close: { width: 26, height: 26, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceInset },
  title: { fontSize: 14, fontWeight: "800", color: colors.ink },
  noteBox: { marginTop: 8, marginBottom: 8, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceInset, padding: 10 },
  note: { color: colors.inkMuted, fontSize: 12, lineHeight: 17, fontWeight: "500" },
});
