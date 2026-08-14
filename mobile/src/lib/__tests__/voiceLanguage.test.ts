jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));

jest.mock("react-native", () => ({
  Platform: { OS: "android" },
}));

import {
  getDeepgramLanguageHint,
  getVoiceLanguageInfo,
  getVoiceRecognitionLanguage,
  getVoiceSpeechLanguage,
  setCachedVoiceLanguage,
  VOICE_LANGUAGES,
} from "../voiceLanguage";

describe("voice language selection", () => {
  test("all visible language options have matching backend speech hints", () => {
    expect(VOICE_LANGUAGES.map((language) => language.code)).toEqual([
      "en-US",
      "hi-IN",
      "ta-IN",
      "ta-Latn-IN",
      "te-IN",
      "kn-IN",
      "ml-IN",
    ]);

    expect(VOICE_LANGUAGES.map((language) => language.deepgramHint)).toEqual(["en", "hi", "ta", "ta", "te", "kn", "ml"]);
  });

  test("Tamil / Tanglish uses Tamil device speech APIs but keeps its own app preference code", () => {
    setCachedVoiceLanguage("ta-Latn-IN");

    expect(getVoiceLanguageInfo().label).toBe("Tamil / Tanglish");
    expect(getDeepgramLanguageHint()).toBe("ta");
    expect(getVoiceRecognitionLanguage()).toBe("ta-IN");
    expect(getVoiceSpeechLanguage()).toBe("ta-IN");
  });

  test("unknown saved language falls back to English", () => {
    setCachedVoiceLanguage("bad-code");

    expect(getVoiceLanguageInfo().code).toBe("en-US");
    expect(getDeepgramLanguageHint()).toBe("en");
    expect(getVoiceRecognitionLanguage()).toBe("en-US");
    expect(getVoiceSpeechLanguage()).toBe("en-US");
  });
});
