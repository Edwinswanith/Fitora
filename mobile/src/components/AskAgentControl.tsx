import { useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "./AppText";
import { colors } from "../lib/theme";
import { useTourHighlight } from "../lib/tour/MobileTourProvider";
import { useSpotlightRef } from "../lib/tour/SpotlightTarget";
import { speakAgentReply } from "../lib/agentSpeech";
import { startVoiceConversation, type VoiceConversationHandle } from "../lib/voiceSession";

export function AskAgentControl({
  accent = "#ffad45",
  accentInk = "#1a0c00",
  onCommand,
  tourTargetId,
  onInputOpenChange,
  onListeningChange,
}: {
  accent?: string;
  accentInk?: string;
  onCommand: (text: string) => Promise<string | void> | string | void;
  /** Anchor id for the guided app tour (see lib/tour/steps.ts) — spotlighted when this step is active. */
  tourTargetId?: string;
  onInputOpenChange?: (open: boolean) => void;
  onListeningChange?: (listening: boolean) => void;
}) {
  const { highlightStyle } = useTourHighlight(tourTargetId);
  // The FAB is already absolutely positioned, so its live rect is measured
  // directly off this ref rather than adding a wrapping SpotlightTarget View
  // that would disturb its own positioning. A never-matching sentinel id
  // keeps this a no-op when the control isn't part of the current tour.
  const { ref: spotlightRef, onLayout: spotlightOnLayout } = useSpotlightRef(tourTargetId ?? "__no-tour-target__");
  const [inputOpen, setInputOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [active, setActive] = useState(false);
  const [mode, setMode] = useState<"voice" | "execute" | null>(null);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [busy, setBusy] = useState(false);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressRef = useRef(false);
  const conversationRef = useRef<VoiceConversationHandle | null>(null);
  const submitLockRef = useRef(false);
  // Driven by real mic input level (see lib/voiceSession) — powers the glow
  // that pulses around the FAB while the user is actually speaking.
  const glow = useSharedValue(0);

  function stopConversation() {
    conversationRef.current?.stop();
    conversationRef.current = null;
    setActive(false);
    setMode(null);
    setListening(false);
    setSpeaking(false);
  }

  async function submit(text: string, options: { speak?: boolean } = { speak: true }): Promise<string | void> {
    const command = text.trim();
    if (!command || submitLockRef.current) return;
    submitLockRef.current = true;
    setBusy(true);
    setDraft("");
    setInputOpen(false);
    onInputOpenChange?.(false);
    try {
      const reply = await onCommand(command);
      if (options.speak !== false && reply?.trim()) await speakAgentReply(reply);
      return reply;
    } finally {
      setBusy(false);
      submitLockRef.current = false;
    }
  }

  function startVoice(nextMode: "voice" | "execute") {
    setInputOpen(false);
    onInputOpenChange?.(false);
    setMode(nextMode);
    conversationRef.current = startVoiceConversation({
      onActiveChange: (value) => {
        setActive(value);
        if (!value) {
          conversationRef.current = null;
          setMode(null);
        }
      },
      onListeningChange: (value) => {
        setListening(value);
        onListeningChange?.(value);
      },
      onSpeakingChange: setSpeaking,
      onVolume: (level) => {
        glow.value = withTiming(level, { duration: 80 });
      },
      onResult: async (text) => {
        const reply = await submit(text, { speak: false });
        if (nextMode === "execute") {
          setTimeout(stopConversation, 50);
          return undefined;
        }
        return reply;
      },
      onError: () => {
        setListening(false);
      },
      onTimeout: () => undefined,
      onNeedsFallback: () => {
        setInputOpen(true);
        onInputOpenChange?.(true);
      },
      speakReplies: nextMode === "voice",
    });
  }

  function openInput() {
    longPressRef.current = true;
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
    stopConversation();
    setInputOpen(true);
    onInputOpenChange?.(true);
  }

  function pressIn() {
    longPressRef.current = false;
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    holdTimerRef.current = setTimeout(openInput, 3000);
  }

  function pressOut() {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
  }

  function press() {
    if (active || conversationRef.current?.isActive()) {
      stopConversation();
      return;
    }
    if (busy) return;
    if (longPressRef.current) {
      longPressRef.current = false;
      return;
    }
    startVoice("voice");
  }

  function pressExecute() {
    if (busy) return;
    stopConversation();
    setTimeout(() => startVoice("execute"), 80);
  }

  const glowStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + glow.value * 0.7 }],
    opacity: glow.value * 0.55,
  }));
  const isExecute = mode === "execute";
  const modeColor = accent;
  const showExecute = active;
  const executeStyle = useAnimatedStyle(() => ({
    opacity: withTiming(showExecute ? 1 : 0, { duration: 220 }),
    transform: [
      { translateY: withTiming(showExecute ? 0 : 18, { duration: 220 }) },
      { scale: withTiming(showExecute ? 1 : 0.86, { duration: 220 }) },
    ],
  }));
  const statusText = isExecute
    ? busy ? "Executing" : null
    : speaking ? "Speaking" : busy ? "Working" : listening ? "Listening" : active ? "Tap to stop" : null;

  return (
    <>
      {!inputOpen ? (
        <>
          {active ? <Pressable style={styles.dismissLayer} onPress={stopConversation} /> : null}
          {statusText ? (
            <View pointerEvents="none" style={styles.statusPill}>
              <Text style={styles.statusText}>{statusText}</Text>
            </View>
          ) : null}
          {active || listening || speaking ? (
            <Animated.View pointerEvents="none" style={[styles.glow, { backgroundColor: modeColor }, glowStyle]} />
          ) : null}
          <Animated.View pointerEvents={showExecute ? "auto" : "none"} style={[styles.executeFabWrap, executeStyle]}>
            <Pressable
              onPress={pressExecute}
              disabled={busy}
              style={({ pressed }) => [styles.executeFab, isExecute ? styles.executeFabActive : null, pressed ? { transform: [{ scale: 0.96 }] } : null]}
              accessibilityRole="button"
              accessibilityLabel="Execute command"
            >
              <Ionicons name="flash-outline" size={20} color="#ffffff" />
            </Pressable>
          </Animated.View>
          <Pressable
            ref={spotlightRef}
            onLayout={spotlightOnLayout}
            collapsable={false}
            onPress={press}
            onPressIn={pressIn}
            onPressOut={pressOut}
            onLongPress={openInput}
            delayLongPress={3000}
            disabled={busy && !active}
            style={({ pressed }) => [
              styles.fab,
              { backgroundColor: modeColor },
              active || listening || speaking ? styles.fabActive : null,
              pressed ? { transform: [{ scale: 0.98 }] } : null,
              highlightStyle ? [highlightStyle, { borderRadius: 28 }] : null,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Ask agent"
            accessibilityState={{ selected: active || listening || speaking }}
            {...(Platform.OS === "web" ? ({ onContextMenu: (event: { preventDefault?: () => void }) => event.preventDefault?.() } as any) : {})}
          >
            <Ionicons name={speaking ? "volume-high-outline" : active || listening ? "stop-outline" : "sparkles-outline"} size={22} color={active || listening || speaking ? modeColor : accentInk} />
          </Pressable>
        </>
      ) : null}
      {inputOpen ? (
        <View style={styles.inputOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => {
              setInputOpen(false);
              onInputOpenChange?.(false);
            }}
          />
          <TextInput
            autoFocus
            value={draft}
            onChangeText={setDraft}
            editable={!busy}
            placeholder="Ask agent"
            placeholderTextColor={colors.inkFaint}
            style={styles.input}
            returnKeyType="send"
            blurOnSubmit
            onSubmitEditing={() => submit(draft)}
            onBlur={() => submit(draft)}
            onKeyPress={(event) => {
              if (event.nativeEvent.key === "Enter") void submit(draft);
            }}
          />
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    right: 16,
    bottom: 84,
    zIndex: 2000,
    elevation: 40,
    height: 56,
    width: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 28,
    shadowColor: "#0f172a",
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  fabActive: { borderWidth: 1, borderColor: colors.line },
  dismissLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 820,
    elevation: 18,
    backgroundColor: "transparent",
  },
  executeFabWrap: {
    position: "absolute",
    right: 20,
    bottom: 150,
    zIndex: 2002,
    elevation: 42,
  },
  executeFab: {
    height: 48,
    width: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#16a34a",
    borderWidth: 1,
    borderColor: "#12813c",
    shadowColor: "#0f172a",
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
  executeFabActive: {
    borderColor: "#0f6d34",
    shadowOpacity: 0.24,
  },
  glow: {
    position: "absolute",
    right: 16,
    bottom: 84,
    zIndex: 1999,
    elevation: 39,
    height: 56,
    width: 56,
    borderRadius: 28,
  },
  statusPill: {
    position: "absolute",
    right: 16,
    bottom: 208,
    zIndex: 2001,
    elevation: 41,
    minHeight: 28,
    borderRadius: 14,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.line,
    shadowColor: "#0f172a",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  statusText: { color: colors.inkMuted, fontSize: 11, fontWeight: "900" },
  inputOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 950,
    elevation: 30,
    justifyContent: "flex-end",
    paddingHorizontal: 18,
    paddingBottom: 92,
  },
  input: {
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 20,
    color: colors.ink,
    fontSize: 15,
    shadowColor: "#0f172a",
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
});
