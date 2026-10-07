import { useEffect, useRef } from "react";
import { Modal, Pressable, StatusBar, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useVideoPlayer, VideoView } from "expo-video";
import { Text } from "./AppText";
import { API_BASE, apiFetch, getAccessToken } from "../lib/api";

/**
 * Full-screen, tap-to-dismiss video player — same modal/lightbox convention
 * as ChatMediaBubble's image viewer, playing back through expo-video instead
 * of Image. Every stream endpoint (coach preview + athlete playback) is
 * Bearer-authenticated, never a bare/public URL, so the player source always
 * carries the access token as a request header (expo-video's VideoSource
 * supports this directly — no separate download step needed).
 */
export function VideoPlayerModal({
  visible,
  title,
  streamPath,
  progressPath,
  onClose,
}: {
  visible: boolean;
  title: string;
  /** e.g. "/api/coach/videos/:id/stream" or "/api/athlete/coach-videos/:id/stream" — API-relative. */
  streamPath: string;
  /** Optional checkpoint endpoint (athlete-only today) — posted on close and every ~15s while playing, never per-tick. */
  progressPath?: string;
  onClose: () => void;
}) {
  const token = getAccessToken();
  const player = useVideoPlayer(
    visible ? { uri: `${API_BASE}${streamPath}`, headers: token ? { Authorization: `Bearer ${token}` } : undefined } : null,
    (instance) => {
      instance.play();
    }
  );

  function reportProgress() {
    if (!progressPath) return;
    const positionSec = Math.max(0, Math.floor(player.currentTime));
    const durationSec = player.duration;
    const completed = durationSec > 0 && positionSec / durationSec >= 0.95;
    apiFetch(progressPath, { method: "POST", body: JSON.stringify({ positionSec, completed }) }).catch(() => undefined);
  }

  // Always-latest-callback ref, kept fresh in an effect (not during render)
  // so the interval below can call it without stale positionSec/duration.
  const reportProgressRef = useRef(reportProgress);
  useEffect(() => {
    reportProgressRef.current = reportProgress;
  });

  useEffect(() => {
    if (!visible || !progressPath) return;
    const interval = setInterval(() => reportProgressRef.current(), 15000);
    return () => clearInterval(interval);
  }, [visible, progressPath]);

  function handleClose() {
    reportProgressRef.current();
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <StatusBar hidden />
      <View style={styles.backdrop}>
        {visible ? (
          <VideoView player={player} style={styles.video} contentFit="contain" nativeControls />
        ) : null}
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          <Pressable onPress={handleClose} style={styles.close} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close video">
            <Ionicons name="close" size={24} color="#fff" />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "#000" },
  video: { flex: 1 },
  header: {
    position: "absolute",
    top: 48,
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  title: { flex: 1, color: "#fff", fontSize: 15, fontWeight: "800" },
  close: {
    height: 40,
    width: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
  },
});
