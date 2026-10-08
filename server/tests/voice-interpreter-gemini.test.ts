import { GeminiVoiceIntentInterpreterV2, VoiceInterpreterError } from "../src/services/voiceIntentInterpreterV2";

const okBody = (intent = "add_water") => ({
  candidates: [{ content: { parts: [{ text: JSON.stringify({ intent, entities: { amountMl: 500 }, confidence: 0.9 }) }] } }],
});

function response(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

describe("Gemini voice interpreter: bounded, typed failures", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });
  const interpreter = new GeminiVoiceIntentInterpreterV2("test-key", "test-model");
  const input = { transcript: "log 500 ml of water", today: "2026-10-08" };

  test("sends the API key in a header, never in the URL, with an abort signal", async () => {
    const fetchMock = jest.fn(async () => response(200, okBody()));
    global.fetch = fetchMock as unknown as typeof fetch;
    const turn = await interpreter.interpret(input);
    expect(turn.intent).toBe("add_water");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain("key=");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");
    expect(init.signal).toBeDefined();
  });

  test("a timeout surfaces as a typed timeout error", async () => {
    global.fetch = jest.fn(async () => {
      const err = new Error("timed out");
      err.name = "TimeoutError";
      throw err;
    }) as unknown as typeof fetch;
    await expect(interpreter.interpret(input)).rejects.toMatchObject({ reason: "timeout" });
  });

  test("a fast 429 is retried once and can succeed", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce(response(429, {})).mockResolvedValueOnce(response(200, okBody()));
    global.fetch = fetchMock as unknown as typeof fetch;
    const turn = await interpreter.interpret(input);
    expect(turn.intent).toBe("add_water");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("bad JSON is not retried and reports its reason", async () => {
    const fetchMock = jest.fn(async () => response(200, { candidates: [{ content: { parts: [{ text: "not json" }] } }] }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const err = await interpreter.interpret(input).catch((e) => e);
    expect(err).toBeInstanceOf(VoiceInterpreterError);
    expect(err.reason).toBe("bad_json");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("a 500 that fails twice reports upstream_error with its status", async () => {
    global.fetch = jest.fn(async () => response(503, {})) as unknown as typeof fetch;
    await expect(interpreter.interpret(input)).rejects.toMatchObject({ reason: "upstream_error", status: 503 });
  });
});
