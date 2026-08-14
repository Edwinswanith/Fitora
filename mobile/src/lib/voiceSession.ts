import { AudioModule, RecordingPresets, setAudioModeAsync } from "expo-audio";
import type { AudioStreamBuffer } from "expo-audio";
import { ExpoSpeechRecognitionModule, ExpoWebSpeechRecognition } from "expo-speech-recognition";
import { Platform } from "react-native";
import { speakAgentReply, stopAgentSpeech } from "./agentSpeech";
import { API_BASE, apiFetch, getAccessToken } from "./api";
import { normalizeVoiceCommandForAgent } from "./voiceTranslation";
import { getDeepgramLanguageHint, getVoiceRecognitionLanguage } from "./voiceLanguage";

export type VoiceSessionHandlers = {
  onListeningChange: (listening: boolean) => void;
  /** Normalized 0..1 input level, sampled every ~80-100ms while listening; 0 when silent/not listening. */
  onVolume: (level: number) => void;
  onResult: (transcript: string) => void;
  onError: () => void;
  onEnd?: () => void;
  /** Permission denied, unsupported browser, or no window (SSR) — caller should fall back to the text input. */
  onNeedsFallback: () => void;
};

export type VoiceSessionHandle = {
  stop: () => void;
};

export type VoiceConversationHandlers = {
  onActiveChange?: (active: boolean) => void;
  onListeningChange: (listening: boolean) => void;
  onSpeakingChange?: (speaking: boolean) => void;
  onVolume: (level: number) => void;
  onResult: (transcript: string) => Promise<string | void> | string | void;
  onError: () => void;
  onNeedsFallback: () => void;
  onTimeout?: () => void;
  silenceTimeoutMs?: number;
  introPrompt?: string;
  speakReplies?: boolean;
  ttsListenDebounceMs?: number;
};

export type VoiceConversationHandle = {
  stop: () => void;
  isActive: () => boolean;
};

/**
 * Starts one streaming voice-command session and sends live 16 kHz linear16 PCM
 * to the API's Deepgram WebSocket proxy. The batch recorder remains as fallback.
 */
export function startVoiceSession(handlers: VoiceSessionHandlers): VoiceSessionHandle {
  if (Platform.OS === "web") return startWebSpeechVoiceSession(handlers);
  if (isNativeSpeechRecognitionAvailable()) return startNativeSpeechRecognitionVoiceSession(handlers);
  return startDeepgramStreamingVoiceSession(handlers);
}

export function startVoiceConversation(handlers: VoiceConversationHandlers): VoiceConversationHandle {
  const silenceTimeoutMs = handlers.silenceTimeoutMs ?? 300000;
  let active = true;
  let listening = false;
  let current: VoiceSessionHandle | null = null;
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let listenDeadlineAt = 0;
  let turnSeq = 0;
  let speechSeq = 0;
  const activeSpeechLevel = 0.01;

  function clearSilenceTimer() {
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = null;
  }

  function armSilenceTimer() {
    if (!active || !listening) return;
    clearSilenceTimer();
    silenceTimer = setTimeout(() => {
      if (!active || !listening) return;
      handlers.onTimeout?.();
      current?.stop();
      current = null;
      setListening(false);
      setTimeout(() => {
        if (active && !current) listen(true);
      }, 180);
    }, Math.max(0, listenDeadlineAt - Date.now()));
  }

  function extendSilenceDeadline() {
    listenDeadlineAt = Date.now() + silenceTimeoutMs;
    armSilenceTimer();
  }

  function setListening(value: boolean) {
    listening = value;
    handlers.onListeningChange(value);
    if (!value) {
      clearSilenceTimer();
      handlers.onVolume(0);
      return;
    }
    armSilenceTimer();
  }

  function stop() {
    if (!active) return;
    active = false;
    clearSilenceTimer();
    current?.stop();
    current = null;
    void stopAgentSpeech();
    handlers.onSpeakingChange?.(false);
    setListening(false);
    handlers.onActiveChange?.(false);
  }

  function listen(resetDeadline = true) {
    if (!active) return;
    if (resetDeadline) {
      listenDeadlineAt = Date.now() + silenceTimeoutMs;
    }
    const seq = ++turnSeq;
    let processingResult = false;
    function recoverListeningWindow() {
      if (!active || seq !== turnSeq || processingResult) return;
      current = null;
      setListening(false);
      if (Date.now() >= listenDeadlineAt) {
        handlers.onTimeout?.();
        setTimeout(() => {
          if (active && seq === turnSeq && !current) listen(true);
        }, 180);
        return;
      }
      setTimeout(() => {
        if (active && seq === turnSeq && !current) listen(false);
      }, 180);
    }
    current = startVoiceSession({
      onListeningChange: (value) => {
        if (!active || seq !== turnSeq) return;
        setListening(value);
      },
      onVolume: (level) => {
        if (!active || seq !== turnSeq) return;
        if (level >= activeSpeechLevel) extendSilenceDeadline();
        handlers.onVolume(level);
      },
      onResult: (transcript) => {
        if (!active || seq !== turnSeq) return;
        if (!transcript.trim()) {
          recoverListeningWindow();
          return;
        }
        processingResult = true;
        clearSilenceTimer();
        current?.stop();
        current = null;
        setListening(false);
        void normalizeVoiceCommandForAgent(transcript)
          .then((normalized) => handlers.onResult(normalized))
          .then(async (reply) => {
            const spokenReply = reply?.trim();
            if (!active) return;
            if (spokenReply && handlers.speakReplies !== false) {
              const thisSpeech = ++speechSeq;
              handlers.onSpeakingChange?.(true);
              await speakAgentReply(spokenReply)
                .catch(() => undefined)
                .finally(() => {
                  if (active && speechSeq === thisSpeech) handlers.onSpeakingChange?.(false);
                });
            }
            setTimeout(() => {
              if (active) listen(true);
            }, handlers.ttsListenDebounceMs ?? 300);
          })
          .catch(() => {
            if (active) handlers.onError();
          })
          .finally(() => {
            if (!active) handlers.onSpeakingChange?.(false);
          });
      },
      onError: () => {
        if (!active || seq !== turnSeq) return;
        recoverListeningWindow();
      },
      onEnd: () => {
        if (!active || seq !== turnSeq) return;
        recoverListeningWindow();
      },
      onNeedsFallback: () => {
        if (!active || seq !== turnSeq) return;
        handlers.onNeedsFallback();
        stop();
      },
    });
  }

  handlers.onActiveChange?.(true);
  if (handlers.introPrompt?.trim()) {
    handlers.onSpeakingChange?.(true);
    void speakAgentReply(handlers.introPrompt)
      .finally(() => {
        handlers.onSpeakingChange?.(false);
        setTimeout(() => {
          if (active) listen();
        }, 350);
      });
  } else {
    listen();
  }

  return { stop, isActive: () => active };
}

type TranscribeResponse = {
  transcript?: string;
  message?: string;
};

type AudioRecorderLike = {
  isRecording: boolean;
  uri: string | null;
  prepareToRecordAsync: () => Promise<void>;
  record: () => void;
  stop: () => Promise<void>;
};

type AudioStreamLike = {
  start: () => Promise<void>;
  stop: () => void;
  addListener: (event: "audioStreamBuffer", listener: (buffer: AudioStreamBuffer) => void) => { remove: () => void };
};

const AudioRecorderCtor = (AudioModule as unknown as { AudioRecorder: new (options: typeof RecordingPresets.HIGH_QUALITY) => AudioRecorderLike })
  .AudioRecorder;
const AudioStreamCtor = (AudioModule as unknown as {
  AudioStream?: new (options: { sampleRate: number; channels: number; encoding: "int16" }) => AudioStreamLike;
}).AudioStream;

type VoiceStreamServerMessage =
  | { type: "interim"; transcript: string }
  | { type: "final"; transcript: string }
  | { type: "utterance_end"; transcript: string }
  | { type: "error"; code: string; message: string };

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: { results?: ArrayLike<ArrayLike<{ transcript?: string }>> }) => void) | null;
  onerror: ((event?: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
};

function startSpeechRecognitionVoiceSession(handlers: VoiceSessionHandlers, recognition: SpeechRecognitionLike): VoiceSessionHandle {
  recognition.lang = getVoiceRecognitionLanguage();
  recognition.continuous = false;
  recognition.interimResults = false;
  let stopped = false;
  let handled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function cleanup() {
    if (timer) clearTimeout(timer);
    timer = null;
    handlers.onListeningChange(false);
    handlers.onVolume(0);
  }

  function stop() {
    stopped = true;
    cleanup();
    try {
      recognition.abort?.();
    } catch {
      try {
        recognition.stop();
      } catch {
        // already stopped
      }
    }
  }

  recognition.onstart = () => {
    if (stopped) return;
    handlers.onListeningChange(true);
    handlers.onVolume(0.25);
  };
  recognition.onresult = (event) => {
    if (stopped || handled) return;
    handled = true;
    const text = Array.from(event.results ?? [])
      .map((result) => result?.[0]?.transcript ?? "")
      .join(" ")
      .trim();
    cleanup();
    handlers.onResult(text);
  };
  recognition.onerror = (event) => {
    if (stopped) return;
    cleanup();
    const code = event?.error ?? "";
    if (code === "not-allowed" || code === "permission-denied") {
      handlers.onNeedsFallback();
      return;
    }
    handlers.onError();
  };
  recognition.onend = () => {
    if (stopped) return;
    cleanup();
    if (!handled) handlers.onEnd?.();
  };
  try {
    recognition.start();
    timer = setTimeout(() => {
      try {
        recognition.stop();
      } catch {
        // already stopped
      }
    }, 300000);
  } catch {
    handlers.onNeedsFallback();
  }
  return { stop };
}

function startWebSpeechVoiceSession(handlers: VoiceSessionHandlers): VoiceSessionHandle {
  if (typeof window === "undefined") {
    handlers.onNeedsFallback();
    return { stop: () => undefined };
  }
  const Ctor = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
  if (!Ctor) {
    handlers.onNeedsFallback();
    return { stop: () => undefined };
  }
  return startSpeechRecognitionVoiceSession(handlers, new Ctor() as SpeechRecognitionLike);
}

function isNativeSpeechRecognitionAvailable(): boolean {
  try {
    return ExpoSpeechRecognitionModule.isRecognitionAvailable();
  } catch {
    return false;
  }
}

function startNativeSpeechRecognitionVoiceSession(handlers: VoiceSessionHandlers): VoiceSessionHandle {
  try {
    return startSpeechRecognitionVoiceSession(handlers, new ExpoWebSpeechRecognition() as unknown as SpeechRecognitionLike);
  } catch {
    return startDeepgramStreamingVoiceSession(handlers);
  }
}

function voiceStreamUrl(): string | null {
  const token = getAccessToken();
  if (!token) return null;
  const base = API_BASE.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:").replace(/\/$/, "");
  return `${base}/api/voice/stream?token=${encodeURIComponent(token)}&language=${encodeURIComponent(getDeepgramLanguageHint())}`;
}

function audioLevel(buffer: ArrayBuffer): number {
  if (!buffer.byteLength) return 0;
  const view = new DataView(buffer);
  let sumSquares = 0;
  const samples = Math.floor(buffer.byteLength / 2);
  for (let offset = 0; offset < samples * 2; offset += 2) {
    const value = view.getInt16(offset, true) / 32768;
    sumSquares += value * value;
  }
  const rms = Math.sqrt(sumSquares / Math.max(1, samples));
  return Math.max(0, Math.min(1, rms * 5));
}

function audioMimeType(uri: string): string {
  const lower = uri.toLowerCase();
  if (lower.endsWith(".3gp")) return "audio/3gpp";
  if (lower.endsWith(".webm")) return "audio/webm";
  if (lower.endsWith(".wav")) return "audio/wav";
  return "audio/mp4";
}

async function appendAudio(form: FormData, uri: string): Promise<void> {
  const type = audioMimeType(uri);
  if (Platform.OS === "web") {
    const blob = await fetch(uri).then((res) => res.blob());
    form.append("audio", blob, `ask-agent${type === "audio/webm" ? ".webm" : ".m4a"}`);
    return;
  }
  form.append("audio", { uri, name: "ask-agent.m4a", type } as any);
}

async function transcribeWithDeepgram(uri: string): Promise<string> {
  const form = new FormData();
  await appendAudio(form, uri);
  const res = await apiFetch(`/api/voice/transcribe?language=${encodeURIComponent(getDeepgramLanguageHint())}`, { method: "POST", body: form });
  const payload = (await res.json().catch(() => ({}))) as TranscribeResponse;
  if (!res.ok) throw new Error(payload.message || "deepgram_transcription_failed");
  return (payload.transcript ?? "").trim();
}

function startDeepgramStreamingVoiceSession(handlers: VoiceSessionHandlers): VoiceSessionHandle {
  const url = voiceStreamUrl();
  if (!url || !AudioStreamCtor) return startDeepgramVoiceSession(handlers);

  let stopped = false;
  let settled = false;
  let started = false;
  let finalHandled = false;
  let streamFailed = false;
  let fallback: VoiceSessionHandle | null = null;
  let socket: WebSocket | null = null;
  let stream: AudioStreamLike | null = null;
  let bufferSub: { remove: () => void } | null = null;

  function cleanup() {
    bufferSub?.remove();
    bufferSub = null;
    try {
      stream?.stop();
    } catch {
      // already stopped
    }
    stream = null;
    try {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "CloseStream" }));
      socket?.close();
    } catch {
      // already closed
    }
    socket = null;
    handlers.onListeningChange(false);
    handlers.onVolume(0);
  }

  function failToBatch() {
    if (stopped || settled) return;
    cleanup();
    fallback = startDeepgramVoiceSession(handlers);
  }

  function complete(transcript: string) {
    const text = transcript.trim();
    if (!text || stopped || finalHandled) return;
    finalHandled = true;
    settled = true;
    cleanup();
    handlers.onResult(text);
  }

  void (async () => {
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (stopped) return;
      if (!permission.granted) {
        handlers.onNeedsFallback();
        return;
      }

      socket = new WebSocket(url);
      socket.binaryType = "arraybuffer";
      socket.onmessage = (event) => {
        let message: VoiceStreamServerMessage | null = null;
        try {
          message = JSON.parse(String(event.data)) as VoiceStreamServerMessage;
        } catch {
          return;
        }
        if (message.type === "error") {
          failToBatch();
          return;
        }
        if ((message.type === "interim" || message.type === "final" || message.type === "utterance_end") && message.transcript?.trim()) {
          handlers.onVolume(0.2);
        }
        if (message.type === "final" || message.type === "utterance_end") complete(message.transcript);
      };
      socket.onerror = () => {
        if (!started) failToBatch();
        else if (!stopped && !settled) {
          streamFailed = true;
          cleanup();
          handlers.onError();
        }
      };
      socket.onclose = () => {
        if (streamFailed) return;
        if (!stopped && !settled && !fallback) failToBatch();
      };
      socket.onopen = () => {
        void (async () => {
          try {
            if (stopped || !socket || socket.readyState !== WebSocket.OPEN) return;
            await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
            const nextStream = new AudioStreamCtor({ sampleRate: 16000, channels: 1, encoding: "int16" });
            stream = nextStream;
            bufferSub = nextStream.addListener("audioStreamBuffer", (buffer) => {
              if (stopped || settled || socket?.readyState !== WebSocket.OPEN) return;
              handlers.onVolume(audioLevel(buffer.data));
              socket.send(buffer.data);
            });
            await nextStream.start();
            started = true;
            handlers.onListeningChange(true);
          } catch {
            failToBatch();
          }
        })();
      };
    } catch {
      if (!stopped) fallback = startDeepgramVoiceSession(handlers);
    }
  })();

  return {
    stop: () => {
      stopped = true;
      fallback?.stop();
      fallback = null;
      cleanup();
    },
  };
}

function startDeepgramVoiceSession(handlers: VoiceSessionHandlers): VoiceSessionHandle {
  let stopped = false;
  let finished = false;
  let startedRecording = false;
  let recorder: AudioRecorderLike | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pulseTimer: ReturnType<typeof setInterval> | null = null;

  function clearTimers() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (pulseTimer) clearInterval(pulseTimer);
    pulseTimer = null;
  }

  function setDone() {
    clearTimers();
    handlers.onListeningChange(false);
    handlers.onVolume(0);
  }

  async function finish(shouldTranscribe: boolean, allowStoppedTranscribe = false) {
    if (finished) return;
    finished = true;
    const activeRecorder = recorder;
    recorder = null;
    setDone();
    if (!activeRecorder) return;

    try {
      if (activeRecorder.isRecording) await activeRecorder.stop();
    } catch {
      if (shouldTranscribe && !stopped) handlers.onError();
      return;
    }

    if (!shouldTranscribe || (stopped && !allowStoppedTranscribe)) return;
    const uri = activeRecorder.uri;
    if (!uri) {
      handlers.onError();
      return;
    }
    try {
      const transcript = await transcribeWithDeepgram(uri);
      handlers.onResult(transcript);
    } catch {
      handlers.onError();
    }
  }

  void (async () => {
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (stopped) return;
      if (!permission.granted) {
        handlers.onNeedsFallback();
        return;
      }

      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      const nextRecorder = new AudioRecorderCtor(RecordingPresets.HIGH_QUALITY);
      recorder = nextRecorder;
      await nextRecorder.prepareToRecordAsync();
      if (stopped) {
        await finish(false);
        return;
      }

      nextRecorder.record();
      startedRecording = true;
      handlers.onListeningChange(true);
      let pulse = 0.18;
      pulseTimer = setInterval(() => {
        pulse = pulse > 0.34 ? 0.18 : pulse + 0.04;
        handlers.onVolume(pulse);
      }, 120);
      timer = setTimeout(() => {
        void finish(true);
      }, 60000);
    } catch {
      if (!stopped) handlers.onNeedsFallback();
    }
  })();

  return {
    stop: () => {
      stopped = true;
      void finish(startedRecording, true);
    },
  };
}
