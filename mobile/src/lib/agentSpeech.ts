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

async function speakWithDeepgram(message: string): Promise<void> {
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
    const timer = setInterval(() => {
      if (currentPlayer !== player) {
        clearInterval(timer);
        resolve();
        return;
      }
      const status = player.currentStatus;
      if (status.didJustFinish || (!status.playing && status.currentTime > 0.05)) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
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

async function speakWithExpo(message: string): Promise<void> {
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
      onDone: done,
      onStopped: done,
      onError: done,
    });
  });
}

export async function speakAgentReply(text: string): Promise<void> {
  const message = await localizeAgentSpeech(text.trim()).catch(() => text.trim());
  if (!message) return;
  await stopAgentSpeech();
  if (Platform.OS === "web" || !isEnglishVoiceLanguage()) {
    await speakWithExpo(message);
    return;
  }
  await speakWithDeepgram(message).catch(() => speakWithExpo(message));
}
