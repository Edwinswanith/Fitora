import { AudioModule, RecordingPresets, setAudioModeAsync } from "expo-audio";
import type { AudioStreamBuffer } from "expo-audio";
import { ExpoSpeechRecognitionModule, ExpoWebSpeechRecognition } from "expo-speech-recognition";
import { Platform } from "react-native";
import { speakAgentReply, stopAgentSpeech } from "./agentSpeech";
import { API_BASE, apiFetch, getAccessToken } from "./api";
import { normalizeVoiceCommandForAgent } from "./voiceTranslation";
import { getDeepgramLanguageHint, getVoiceRecognitionLanguage } from "./voiceLanguage";
import { isSystemicTranscribeFailure } from "./voiceTranscribeFailure";
import { startVoiceTurnTimer, type VoiceTurnTimer } from "./voiceTiming";
import {
  batchEndpoint,
  DEFAULT_FOLLOW_UP_WINDOW_MS,
  DEFAULT_MAX_EMPTY_LISTENS,
  DEFAULT_SILENCE_TIMEOUT_MS,
  shouldListenAfterReply,
  type BatchEndpointState,
} from "./voiceTurnRules";

export { shouldListenAfterReply } from "./voiceTurnRules";

/**
 * Live Deepgram streaming needs a WebSocket-capable API host (the long-running
 * Node server, e.g. Cloud Run). The Vercel API cannot upgrade connections, so
 * streaming is opt-in; otherwise devices without on-device recognition go
 * straight to the batch recorder instead of paying a failed handshake first.
 */
function isVoiceStreamingEnabled(): boolean {
  return process.env.EXPO_PUBLIC_VOICE_STREAMING === "true";
}

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
  /** The conversation ended because nobody spoke (no-speech window elapsed). */
  onTimeout?: () => void;
  /** How long to wait for speech to start before ending the conversation. */
  silenceTimeoutMs?: number;
  /** After a reply that asks a question, how long to wait for the answer. */
  followUpWindowMs?: number;
  /** Consecutive empty/failed listens (no speech, recognizer error) before giving up. */
  maxEmptyListens?: number;
  introPrompt?: string;
  speakReplies?: boolean;
  ttsListenDebounceMs?: number;
};

export type VoiceConversationHandle = {
  stop: () => void;
  isActive: () => boolean;
};

/** Which audio path a new listen would use (for timing reports). */
export function voicePathName(): "web-speech" | "on-device" | "stream" | "batch" {
  if (Platform.OS === "web") return "web-speech";
  if (isNativeSpeechRecognitionAvailable()) return "on-device";
  return isVoiceStreamingEnabled() ? "stream" : "batch";
}

/**
 * Starts one streaming voice-command session and sends live 16 kHz linear16 PCM
 * to the API's Deepgram WebSocket proxy. The batch recorder remains as fallback.
 */
export function startVoiceSession(handlers: VoiceSessionHandlers): VoiceSessionHandle {
  if (Platform.OS === "web") return startWebSpeechVoiceSession(handlers);
  if (isNativeSpeechRecognitionAvailable()) return startNativeSpeechRecognitionVoiceSession(handlers);
  return isVoiceStreamingEnabled() ? startDeepgramStreamingVoiceSession(handlers) : startDeepgramVoiceSession(handlers);
}

/**
 * One voice conversation: listen, hand the transcript to `onResult`, speak
 * the reply, and keep listening only if the reply asked a question. It ends
 * by itself when nobody speaks, after a couple of empty listens, or when any
 * step fails; it never loops forever and never stays "active" without a
 * session.
 */
export function startVoiceConversation(handlers: VoiceConversationHandlers): VoiceConversationHandle {
  const silenceTimeoutMs = handlers.silenceTimeoutMs ?? DEFAULT_SILENCE_TIMEOUT_MS;
  const followUpWindowMs = handlers.followUpWindowMs ?? DEFAULT_FOLLOW_UP_WINDOW_MS;
  const maxEmptyListens = handlers.maxEmptyListens ?? DEFAULT_MAX_EMPTY_LISTENS;
  let active = true;
  let listening = false;
  let current: VoiceSessionHandle | null = null;
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let listenDeadlineAt = 0;
  let turnSeq = 0;
  let speechSeq = 0;
  let emptyListens = 0;
  let turnTimer: VoiceTurnTimer | null = null;
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
      turnTimer?.finish("no_speech");
      handlers.onTimeout?.();
      stop();
    }, Math.max(0, listenDeadlineAt - Date.now()));
  }

  function extendSilenceDeadline(windowMs: number) {
    listenDeadlineAt = Math.max(listenDeadlineAt, Date.now() + windowMs);
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
    turnTimer?.finish("stopped");
    void stopAgentSpeech();
    handlers.onSpeakingChange?.(false);
    setListening(false);
    handlers.onActiveChange?.(false);
  }

  function listen(windowMs: number) {
    if (!active) return;
    listenDeadlineAt = Date.now() + windowMs;
    const seq = ++turnSeq;
    let processingResult = false;
    const timer = startVoiceTurnTimer(voicePathName());
    turnTimer = timer;

    function recoverListeningWindow(outcome: string) {
      if (!active || seq !== turnSeq || processingResult) return;
      // Release the finished recognizer (clears its listeners) before the next one.
      current?.stop();
      current = null;
      setListening(false);
      timer.finish(outcome);
      emptyListens += 1;
      if (emptyListens > maxEmptyListens || Date.now() >= listenDeadlineAt) {
        handlers.onTimeout?.();
        stop();
        return;
      }
      setTimeout(() => {
        if (active && seq === turnSeq && !current) listen(Math.max(1000, listenDeadlineAt - Date.now()));
      }, 180);
    }

    current = startVoiceSession({
      onListeningChange: (value) => {
        if (!active || seq !== turnSeq) return;
        if (value) timer.mark("listening");
        setListening(value);
      },
      onVolume: (level) => {
        if (!active || seq !== turnSeq) return;
        if (level >= activeSpeechLevel) extendSilenceDeadline(silenceTimeoutMs);
        handlers.onVolume(level);
      },
      onResult: (transcript) => {
        if (!active || seq !== turnSeq) return;
        if (!transcript.trim()) {
          recoverListeningWindow("empty");
          return;
        }
        processingResult = true;
        emptyListens = 0;
        timer.mark("final");
        clearSilenceTimer();
        current?.stop();
        current = null;
        setListening(false);
        void normalizeVoiceCommandForAgent(transcript)
          .then((normalized) => handlers.onResult(normalized))
          .then(async (reply) => {
            timer.mark("reply");
            const spokenReply = reply?.trim();
            if (!active) return;
            if (spokenReply && handlers.speakReplies !== false) {
              const thisSpeech = ++speechSeq;
              handlers.onSpeakingChange?.(true);
              await speakAgentReply(spokenReply, { onStart: () => timer.mark("speechStart") })
                .catch(() => undefined)
                .finally(() => {
                  timer.mark("speechEnd");
                  if (active && speechSeq === thisSpeech) handlers.onSpeakingChange?.(false);
                });
            }
            timer.finish("replied");
            if (!active) return;
            if (!shouldListenAfterReply(spokenReply)) {
              stop();
              return;
            }
            setTimeout(() => {
              if (active) listen(followUpWindowMs);
            }, handlers.ttsListenDebounceMs ?? 300);
          })
          .catch(() => {
            // Translation or the command itself failed: report it and end the
            // conversation instead of leaving it "active" with no session.
            timer.finish("error");
            if (!active) return;
            handlers.onError();
            stop();
          })
          .finally(() => {
            if (!active) handlers.onSpeakingChange?.(false);
          });
      },
      onError: () => {
        if (!active || seq !== turnSeq) return;
        recoverListeningWindow("recognizer_error");
      },
      onEnd: () => {
        if (!active || seq !== turnSeq) return;
        recoverListeningWindow("ended");
      },
      onNeedsFallback: () => {
        if (!active || seq !== turnSeq) return;
        timer.finish("fallback");
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
          if (active) listen(silenceTimeoutMs);
        }, 350);
      });
  } else {
    listen(silenceTimeoutMs);
  }

  return { stop, isActive: () => active };
}

type TranscribeResponse = {
  transcript?: string;
  message?: string;
  error?: string;
};

/**
 * `systemic` distinguishes "the provider/service is unavailable right now"
 * (Deepgram unconfigured/down, a network failure) from "you just didn't say
 * anything clear" (empty audio/transcript). Only the former should push the
 * user to the text-input fallback — the latter should just let them try
 * speaking again.
 */
class VoiceTranscriptionError extends Error {
  constructor(message: string, readonly systemic: boolean) {
    super(message);
  }
}

type AudioRecorderLike = {
  isRecording: boolean;
  uri: string | null;
  prepareToRecordAsync: () => Promise<void>;
  record: () => void;
  stop: () => Promise<void>;
  getStatus?: () => { metering?: number };
  release?: () => void;
};

type AudioStreamLike = {
  start: () => Promise<void>;
  stop: () => void;
  addListener: (event: "audioStreamBuffer", listener: (buffer: AudioStreamBuffer) => void) => { remove: () => void };
};

const AudioRecorderCtor = (AudioModule as unknown as { AudioRecorder: new (options: typeof RecordingPresets.HIGH_QUALITY & { isMeteringEnabled?: boolean }) => AudioRecorderLike })
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

  // The native recognizer subscribes these on a global emitter; leaving them
  // set leaks ~4 listeners per turn that keep firing on later sessions.
  function detach() {
    recognition.onstart = null;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    cleanup();
    detach();
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
    return isVoiceStreamingEnabled() ? startDeepgramStreamingVoiceSession(handlers) : startDeepgramVoiceSession(handlers);
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
  let res: Response;
  try {
    res = await apiFetch(`/api/voice/transcribe?language=${encodeURIComponent(getDeepgramLanguageHint())}`, { method: "POST", body: form });
  } catch (err) {
    // Network failure before any response — voice transport itself is down, not just this recording.
    throw new VoiceTranscriptionError(err instanceof Error ? err.message : "network_error", true);
  }
  const payload = (await res.json().catch(() => ({}))) as TranscribeResponse;
  if (!res.ok) {
    const systemic = isSystemicTranscribeFailure(res.status, payload.error);
    throw new VoiceTranscriptionError(payload.message || "deepgram_transcription_failed", systemic);
  }
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
    if (stopped || settled || fallback) return;
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
            // Stopped while the audio session was switching: don't open the mic.
            if (stopped || !socket || socket.readyState !== WebSocket.OPEN) return;
            const nextStream = new AudioStreamCtor({ sampleRate: 16000, channels: 1, encoding: "int16" });
            stream = nextStream;
            bufferSub = nextStream.addListener("audioStreamBuffer", (buffer) => {
              if (stopped || settled || socket?.readyState !== WebSocket.OPEN) return;
              handlers.onVolume(audioLevel(buffer.data));
              socket.send(buffer.data);
            });
            await nextStream.start();
            if (stopped) {
              cleanup();
              return;
            }
            started = true;
            handlers.onListeningChange(true);
          } catch {
            failToBatch();
          }
        })();
      };
    } catch {
      if (!stopped && !fallback) fallback = startDeepgramVoiceSession(handlers);
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

/** Maps a dBFS meter reading to the 0..1 level the UI glow expects. */
function levelFromDb(db: number | undefined): number {
  if (typeof db !== "number") return 0;
  return Math.max(0, Math.min(1, (db + 60) / 50));
}

function startDeepgramVoiceSession(handlers: VoiceSessionHandlers): VoiceSessionHandle {
  let stopped = false;
  let finished = false;
  let recorder: AudioRecorderLike | null = null;
  let meterTimer: ReturnType<typeof setInterval> | null = null;

  function clearTimers() {
    if (meterTimer) clearInterval(meterTimer);
    meterTimer = null;
  }

  function setDone() {
    clearTimers();
    handlers.onListeningChange(false);
    handlers.onVolume(0);
  }

  function release(activeRecorder: AudioRecorderLike) {
    try {
      activeRecorder.release?.();
    } catch {
      // already released
    }
  }

  async function finish(shouldTranscribe: boolean) {
    if (finished) return;
    finished = true;
    const activeRecorder = recorder;
    recorder = null;
    setDone();
    if (!activeRecorder) return;

    try {
      if (activeRecorder.isRecording) await activeRecorder.stop();
    } catch {
      release(activeRecorder);
      if (shouldTranscribe && !stopped) handlers.onError();
      return;
    }

    const uri = activeRecorder.uri;
    release(activeRecorder);
    if (!shouldTranscribe || stopped) return;
    if (!uri) {
      handlers.onError();
      return;
    }
    try {
      const transcript = await transcribeWithDeepgram(uri);
      if (!stopped) handlers.onResult(transcript);
    } catch (err) {
      if (stopped) return;
      if (err instanceof VoiceTranscriptionError && err.systemic) handlers.onNeedsFallback();
      else handlers.onError();
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
      if (stopped) return;
      const nextRecorder = new AudioRecorderCtor({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
      recorder = nextRecorder;
      await nextRecorder.prepareToRecordAsync();
      if (stopped) {
        // Stopped while preparing: release the prepared recorder so the mic is freed.
        recorder = null;
        release(nextRecorder);
        return;
      }

      nextRecorder.record();
      handlers.onListeningChange(true);
      // End of speech from the recorder's real input level, so the user
      // never has to tap (or wait out a fixed timer) to send a command.
      let endpoint: BatchEndpointState = { heardSpeech: false, lastSpeechAt: 0, startedAt: Date.now() };
      meterTimer = setInterval(() => {
        if (stopped || finished) return;
        let db: number | undefined;
        try {
          db = nextRecorder.getStatus?.().metering;
        } catch {
          db = undefined;
        }
        handlers.onVolume(levelFromDb(db));
        const result = batchEndpoint(endpoint, db, Date.now());
        endpoint = result.state;
        if (result.decision === "send") void finish(true);
        else if (result.decision === "no_speech" || result.decision === "max") {
          void finish(false).then(() => {
            if (!stopped) handlers.onEnd?.();
          });
        }
      }, 120);
    } catch {
      if (!stopped) handlers.onNeedsFallback();
    }
  })();

  return {
    stop: () => {
      // A stop is the user cancelling: release the mic, don't upload.
      stopped = true;
      void finish(false);
    },
  };
}
