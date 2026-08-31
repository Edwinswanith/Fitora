import { speakAgentReply } from "../agentSpeech";

const playListeners: Record<string, (status: { error?: string | null; didJustFinish?: boolean; playing?: boolean; currentTime?: number }) => void> = {};
const mockRemove = jest.fn();
const mockPlay = jest.fn();
let mockCurrentStatus: { didJustFinish?: boolean; playing?: boolean; currentTime?: number } = {};

jest.mock("expo-audio", () => ({
  createAudioPlayer: jest.fn(() => ({
    play: mockPlay,
    remove: mockRemove,
    get currentStatus() {
      return mockCurrentStatus;
    },
    addListener: (event: string, cb: (status: unknown) => void) => {
      playListeners[event] = cb as never;
      return { remove: jest.fn() };
    },
  })),
  setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
}));

const speechSpeak = jest.fn((_text: string, options: { onDone?: () => void }) => {
  options.onDone?.();
});
jest.mock("expo-speech", () => ({
  speak: (text: string, options: { onDone?: () => void }) => speechSpeak(text, options),
  stop: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("react-native", () => ({ Platform: { OS: "ios" } }));
jest.mock("../api", () => ({ getAccessToken: () => "token" }));
jest.mock("../voiceTranslation", () => ({ localizeAgentSpeech: (text: string) => Promise.resolve(text) }));
jest.mock("../voiceLanguage", () => ({
  getVoiceSpeechLanguage: () => "en-US",
  isEnglishVoiceLanguage: () => true,
}));

async function waitFor(predicate: () => boolean, maxTicks = 50): Promise<void> {
  for (let i = 0; i < maxTicks; i++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("timed out waiting for condition");
}

describe("speakAgentReply Deepgram -> Expo fallback", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(playListeners)) delete playListeners[key];
    mockCurrentStatus = {};
  });

  it("falls back to Expo speech immediately on a player load error, without waiting for the timeout", async () => {
    const promise = speakAgentReply("Hello there");
    // Wait for the player's listener to register, then simulate the native
    // player reporting a load error (e.g. the server returned a 503 JSON
    // body instead of audio) — this is exactly what a Deepgram outage
    // produces, and previously this only surfaced via a 5-30s timeout.
    await waitFor(() => Boolean(playListeners.playbackStatusUpdate));
    playListeners.playbackStatusUpdate({ error: "AVPlayerItem failed to load" });

    await promise;

    expect(speechSpeak).toHaveBeenCalledTimes(1);
    expect(speechSpeak.mock.calls[0][0]).toBe("Hello there");
  });

  it("does not fall back to Expo speech when Deepgram audio actually plays", async () => {
    const promise = speakAgentReply("All good");
    await Promise.resolve();
    await Promise.resolve();
    mockCurrentStatus = { didJustFinish: true, playing: false, currentTime: 1.2 };

    await promise;

    expect(speechSpeak).not.toHaveBeenCalled();
    expect(mockPlay).toHaveBeenCalledTimes(1);
  });
});
