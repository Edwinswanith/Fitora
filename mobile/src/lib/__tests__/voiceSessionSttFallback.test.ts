import { isSystemicTranscribeFailure } from "../voiceTranscribeFailure";
import { shouldRetryWithDeepgram } from "../voiceNativeFallback";

describe("isSystemicTranscribeFailure", () => {
  it("treats an unconfigured Deepgram key as systemic", () => {
    expect(isSystemicTranscribeFailure(503, "deepgram_not_configured")).toBe(true);
  });

  it("treats an upstream 502 as systemic", () => {
    expect(isSystemicTranscribeFailure(502, "transcription_unavailable")).toBe(true);
  });

  it("does not treat a 422 (garbled/short recording) as systemic", () => {
    expect(isSystemicTranscribeFailure(422, "empty_transcript")).toBe(false);
    expect(isSystemicTranscribeFailure(422, "transcription_unavailable")).toBe(false);
  });

  it("does not treat empty_audio as systemic", () => {
    expect(isSystemicTranscribeFailure(422, "empty_audio")).toBe(false);
  });

  it("is not fooled by an unrelated error code on a non-502 status", () => {
    expect(isSystemicTranscribeFailure(400, "deepgram_not_configured")).toBe(true); // error code alone is authoritative
    expect(isSystemicTranscribeFailure(400, undefined)).toBe(false);
  });
});

describe("shouldRetryWithDeepgram", () => {
  it("keeps explicit microphone permission failures on the text fallback", () => {
    expect(shouldRetryWithDeepgram("not-allowed")).toBe(false);
    expect(shouldRetryWithDeepgram("permission-denied")).toBe(false);
  });

  it("retries native service failures through Deepgram", () => {
    expect(shouldRetryWithDeepgram("network")).toBe(true);
    expect(shouldRetryWithDeepgram("no-speech")).toBe(true);
    expect(shouldRetryWithDeepgram("start-failed")).toBe(true);
  });
});
