import { isSystemicTranscribeFailure } from "../voiceTranscribeFailure";

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
