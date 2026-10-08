import {
  BATCH_END_SILENCE_MS,
  BATCH_MAX_RECORDING_MS,
  BATCH_NO_SPEECH_MS,
  batchEndpoint,
  shouldListenAfterReply,
  type BatchEndpointState,
} from "../voiceTurnRules";
import { actionKey, turnFailureMessage } from "../voiceAssistant/turnRules";
import { COACH_PENDING_TTL_MS, classifyPendingReply, coachAgentMemoryKey } from "../coachAgentPending";
import { recentVoiceTurns, startVoiceTurnTimer } from "../voiceTiming";

describe("conversation end rule", () => {
  it("keeps listening only after a reply that asks something", () => {
    expect(shouldListenAfterReply("How many calories should I log?")).toBe(true);
    expect(shouldListenAfterReply("Water logged.")).toBe(false);
    expect(shouldListenAfterReply("")).toBe(false);
    expect(shouldListenAfterReply(undefined)).toBe(false);
  });
});

describe("batch recorder end of speech", () => {
  const start: BatchEndpointState = { heardSpeech: false, lastSpeechAt: 0, startedAt: 0 };

  function run(readings: [number, number | undefined][]) {
    let state = start;
    let decision = "continue";
    for (const [at, db] of readings) {
      const result = batchEndpoint(state, db, at);
      state = result.state;
      decision = result.decision;
      if (decision !== "continue") return { decision, at };
    }
    return { decision, at: -1 };
  }

  it("sends after speech followed by a short silence, without a tap", () => {
    const readings: [number, number][] = [
      [100, -60],
      [400, -20],
      [800, -25],
      [1000, -60],
      [800 + BATCH_END_SILENCE_MS - 100, -60],
      [800 + BATCH_END_SILENCE_MS, -60],
    ];
    expect(run(readings)).toEqual({ decision: "send", at: 800 + BATCH_END_SILENCE_MS });
  });

  it("gives up when nobody speaks", () => {
    expect(run([[BATCH_NO_SPEECH_MS, -70]]).decision).toBe("no_speech");
  });

  it("never records past the hard cap, and sends what it heard", () => {
    expect(run([[500, -10], [BATCH_MAX_RECORDING_MS, -10]]).decision).toBe("send");
  });

  it("treats a missing meter (metering unsupported) as silence, not speech", () => {
    expect(run([[BATCH_NO_SPEECH_MS, undefined]]).decision).toBe("no_speech");
  });
});

describe("turn failure messages", () => {
  it("does not blame the network for rate limits or server errors", () => {
    expect(turnFailureMessage({ status: 429 })).toMatch(/a bit fast/);
    expect(turnFailureMessage({ status: 503 })).toMatch(/our side/);
    expect(turnFailureMessage({ status: 401 })).toMatch(/sign in/);
    expect(turnFailureMessage(new TypeError("Network request failed"))).toMatch(/reach the server/);
    expect(turnFailureMessage(new Error("boom"))).toBe("Something went wrong. Please try again.");
  });
});

describe("idempotency key", () => {
  it("is stable for the same command regardless of key order, and differs otherwise", () => {
    expect(actionKey("add_water", { amountMl: 500, date: "x" })).toBe(actionKey("add_water", { date: "x", amountMl: 500 }));
    expect(actionKey("add_water", { amountMl: 500 })).not.toBe(actionKey("add_water", { amountMl: 250 }));
    expect(actionKey("add_water", { amountMl: 500 })).not.toBe(actionKey("log_meal", { amountMl: 500 }));
  });
});

describe("coach pending confirmation", () => {
  it("only an explicit yes or no answers it", () => {
    expect(classifyPendingReply("yes", 0, 1000)).toBe("confirm");
    expect(classifyPendingReply("send it", 0, 1000)).toBe("confirm");
    expect(classifyPendingReply("no", 0, 1000)).toBe("cancel");
    // A new command that happens to start with "send" must not fire the old announcement.
    expect(classifyPendingReply("send an announcement about tomorrow", 0, 1000)).toBe("other");
    expect(classifyPendingReply("show me the squad report", 0, 1000)).toBe("other");
  });

  it("expires after the time limit, even for a yes", () => {
    expect(classifyPendingReply("yes", 0, COACH_PENDING_TTL_MS + 1)).toBe("expired");
  });

  it("memory is stored per user", () => {
    expect(coachAgentMemoryKey("a")).not.toBe(coachAgentMemoryKey("b"));
  });
});

describe("voice turn timing", () => {
  it("records each stage once, relative to the start", () => {
    let t = 1000;
    const info = jest.spyOn(console, "info").mockImplementation(() => undefined);
    const timer = startVoiceTurnTimer("on-device", () => t);
    t = 1300;
    timer.mark("listening");
    t = 2500;
    timer.mark("final");
    timer.mark("final");
    t = 5000;
    timer.finish("replied");
    timer.finish("again");
    const last = recentVoiceTurns()[recentVoiceTurns().length - 1];
    expect(last).toMatchObject({ path: "on-device", outcome: "replied", stages: { listening: 300, final: 1500 } });
    expect(info).toHaveBeenCalledTimes(1);
    info.mockRestore();
  });
});
