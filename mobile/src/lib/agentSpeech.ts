import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import * as Speech from "expo-speech";
import { Platform } from "react-native";
import { API_BASE, getAccessToken } from "./api";
import { localizeAgentSpeech } from "./voiceTranslation";
import { getVoiceSpeechLanguage, isEnglishVoiceLanguage } from "./voiceLanguage";

let currentPlayer: AudioPlayer | null = null;

export async function stopAgentSpeech(): Promise<void> {
  if (currentPlayer) {
    try {
      currentPlayer.pause();
      currentPlayer.remove();
    } catch {
      // already released
    }
    currentPlayer = null;
  }
  await Speech.stop().catch(() => undefined);
}

export type SpeakOptions = {
  /** Called once when audio actually starts playing (for latency timing). */
  onStart?: () => void;
};

async function speakWithDeepgram(message: string, onStart?: () => void): Promise<void> {
  const token = getAccessToken();
  const player = createAudioPlayer(
    {
      uri: `${API_BASE}/api/voice/speak?text=${encodeURIComponent(message)}`,
      headers: token ? { Authorization: `Bearer ${token}`, "X-Client-Type": "native" } : { "X-Client-Type": "native" },
    },
    { updateInterval: 100, downloadFirst: false }
  );
  currentPlayer = player;
  await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
  player.play();
  await new Promise<void>((resolve, reject) => {
    const startedAt = Date.now();
    const timeoutMs = Math.max(5000, Math.min(30000, message.length * 85));
    // A server failure (e.g. Deepgram not configured/down) never produces a
    // valid audio stream — without this, the player just sits at
    // currentTime 0 and the fallback to expo-speech only kicks in once the
    // timeout below fires, which can take up to 30s. The player's own load
    // error lets us fall back immediately instead.
    const subscription = player.addListener("playbackStatusUpdate", (status) => {
      if (status.error) {
        subscription.remove();
        clearInterval(timer);
        reject(new Error(status.error));
      }
    });
    const timer = setInterval(() => {
      if (currentPlayer !== player) {
        subscription.remove();
        clearInterval(timer);
        resolve();
        return;
      }
      const status = player.currentStatus;
      if (status.playing) onStart?.();
      if (status.didJustFinish || (!status.playing && status.currentTime > 0.05)) {
        subscription.remove();
        clearInterval(timer);
        resolve();
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        subscription.remove();
        clearInterval(timer);
        reject(new Error("deepgram_tts_timeout"));
      }
    }, 100);
  }).finally(() => {
    if (currentPlayer === player) currentPlayer = null;
    try {
      player.remove();
    } catch {
      // already released
    }
  });
}

async function speakWithExpo(message: string, onStart?: () => void): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    Speech.speak(message, {
      language: getVoiceSpeechLanguage(),
      rate: 0.92,
      pitch: 1,
      onStart: () => onStart?.(),
      onDone: done,
      onStopped: done,
      onError: done,
    });
  });
}

export async function speakAgentReply(text: string, options: SpeakOptions = {}): Promise<void> {
  let started = false;
  const onStart = () => {
    if (started) return;
    started = true;
    options.onStart?.();
  };
  const message = await localizeAgentSpeech(text.trim()).catch(() => text.trim());
  if (!message) return;
  await stopAgentSpeech();
  if (Platform.OS === "web" || !isEnglishVoiceLanguage()) {
    await speakWithExpo(message, onStart);
    return;
  }
  await speakWithDeepgram(message, onStart).catch(() => speakWithExpo(message, onStart));
}
