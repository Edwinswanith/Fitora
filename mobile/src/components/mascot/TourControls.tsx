import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "../AppText";
import { colors, radius } from "../../lib/theme";

type TourControlsProps = {
  onSkip: () => void;
  onBack: () => void;
  onNext: () => void;
  backDisabled: boolean;
  isLast: boolean;
  accent: string;
  accentSoft: string;
  accentInk: string;
  audioEnabled: boolean;
  audioSpeaking: boolean;
  onPlayAudio: () => void;
  onPauseAudio: () => void;
  onReplayAudio: () => void;
};

/** Ported verbatim (behavior + accessibility labels) from the old tour dialog's
 * audio row + Skip/Back/Next/Done row — only the visual container changed. */
export function TourControls({
  onSkip,
  onBack,
  onNext,
  backDisabled,
  isLast,
  accent,
  accentSoft,
  accentInk,
  audioEnabled,
  audioSpeaking,
  onPlayAudio,
  onPauseAudio,
  onReplayAudio,
}: TourControlsProps) {
  return (
    <View>
      <View style={styles.audioRow}>
        <Pressable
          onPress={audioSpeaking ? onPauseAudio : onPlayAudio}
          style={[styles.audioPrimary, { borderColor: accent, backgroundColor: accentSoft }]}
          accessibilityRole="button"
          accessibilityLabel={audioSpeaking ? "Pause tour audio" : "Play tour audio"}
        >
          <Ionicons name={audioSpeaking ? "pause" : "volume-high-outline"} size={15} color={accent} />
          <Text style={[styles.audioPrimaryText, { color: accent }]}>
            {audioSpeaking ? "Pause" : audioEnabled ? "Audio on" : "Play audio"}
          </Text>
        </Pressable>
        <Pressable onPress={onReplayAudio} style={styles.audioIcon} accessibilityRole="button" accessibilityLabel="Replay tour audio">
          <Ionicons name="refresh" size={15} color={colors.inkMuted} />
        </Pressable>
      </View>

      <View style={styles.actions}>
        <Pressable onPress={onSkip} hitSlop={10} accessibilityRole="button" accessibilityLabel="Skip tour">
          <Text style={styles.skipText}>Skip</Text>
        </Pressable>
        <View style={styles.actionsRight}>
          <Pressable onPress={onBack} disabled={backDisabled} style={[styles.secondary, backDisabled ? styles.disabled : null]}>
            <Text style={styles.secondaryText}>Back</Text>
          </Pressable>
          <Pressable onPress={onNext} style={[styles.primary, { backgroundColor: accent }]}>
            <Text style={[styles.primaryText, { color: accentInk }]}>{isLast ? "Done" : "Next"}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  audioRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  audioPrimary: { height: 32, paddingHorizontal: 10, borderRadius: radius.sm, borderWidth: 1, flexDirection: "row", alignItems: "center", gap: 6 },
  audioPrimaryText: { fontSize: 12, fontWeight: "800" },
  audioIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceRaised,
  },
  actions: { marginTop: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  skipText: { color: colors.inkFaint, fontSize: 12, fontWeight: "700" },
  actionsRight: { flexDirection: "row", gap: 8 },
  secondary: {
    height: 36,
    paddingHorizontal: 16,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceRaised,
  },
  secondaryText: { color: colors.inkMuted, fontSize: 13, fontWeight: "800" },
  primary: { height: 36, paddingHorizontal: 18, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  primaryText: { fontSize: 13, fontWeight: "800" },
  disabled: { opacity: 0.45 },
});
