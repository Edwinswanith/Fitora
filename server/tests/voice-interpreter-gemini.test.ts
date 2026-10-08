import { GeminiVoiceIntentInterpreterV2, VoiceInterpreterError, entitiesFromPairs } from "../src/services/voiceIntentInterpreterV2";

const okBody = (intent = "add_water") => ({
  candidates: [{ content: { parts: [{ text: JSON.stringify({ intent, entities: { amountMl: 500 }, confidence: 0.9 }) }] } }],
});

function response(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
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

describe("Gemini voice interpreter: thinking level", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });
  const input = { transcript: "log 500 ml of water", today: "2026-10-08" };

  test("sends the configured thinking level", async () => {
    const fetchMock = jest.fn(async () => response(200, okBody()));
    global.fetch = fetchMock as unknown as typeof fetch;
    await new GeminiVoiceIntentInterpreterV2("k", "gemini-3.1-flash-lite", "minimal").interpret(input);
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body)).generationConfig.thinkingConfig).toEqual({ thinkingLevel: "minimal" });
  });

  test("'default' sends no thinking setting", async () => {
    const fetchMock = jest.fn(async () => response(200, okBody()));
    global.fetch = fetchMock as unknown as typeof fetch;
    await new GeminiVoiceIntentInterpreterV2("k", "m", "default").interpret(input);
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body)).generationConfig.thinkingConfig).toBeUndefined();
  });

  test("a model that rejects the thinking level is retried without it, and stays without it", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(response(400, { error: { message: "Thinking level MINIMAL is not supported for this model." } }))
      .mockResolvedValue(response(200, okBody()));
    global.fetch = fetchMock as unknown as typeof fetch;
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const interpreter = new GeminiVoiceIntentInterpreterV2("k", "gemini-3.8-flash", "minimal");
    expect((await interpreter.interpret(input)).intent).toBe("add_water");
    await interpreter.interpret(input);
    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)));
    expect(bodies[0].generationConfig.thinkingConfig).toBeDefined();
    expect(bodies[1].generationConfig.thinkingConfig).toBeUndefined();
    expect(bodies[2].generationConfig.thinkingConfig).toBeUndefined();
    warn.mockRestore();
  });
});

describe("entities from {field, value} pairs", () => {
  test("types each value by its declared field type", () => {
    expect(
      entitiesFromPairs([
        { field: "mealType", value: "breakfast" },
        { field: "foodName", value: "dosa" },
        { field: "calories", value: "around 400" },
        { field: "amountMl", value: "1,500" },
        { field: "enabled", value: "off" },
        { field: "modalities", value: "Ice bath, stretching" },
      ])
    ).toEqual({ mealType: "breakfast", foodName: "dosa", calories: 400, amountMl: 1500, enabled: false, modalities: ["ice_bath", "stretching"] });
  });

  test("drops unknown fields, empty values and untypable numbers", () => {
    expect(
      entitiesFromPairs([
        { field: "notAField", value: "x" },
        { field: "calories", value: "" },
        { field: "rpe", value: "high" },
        { field: "body", value: "  my knee is sore " },
      ])
    ).toEqual({ body: "my knee is sore" });
  });

  test("an object (mock interpreter) passes through unchanged", () => {
    expect(entitiesFromPairs({ amountMl: 500 })).toEqual({ amountMl: 500 });
  });

  test("the adapter asks for pairs and converts the reply", async () => {
    const realFetch = global.fetch;
    const fetchMock = jest.fn(async () =>
      response(200, {
        candidates: [{ content: { parts: [{ text: JSON.stringify({ intent: "log_meal", entities: [{ field: "foodName", value: "dosa" }, { field: "calories", value: "400" }], confidence: 0.9 }) }] } }],
      })
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const turn = await new GeminiVoiceIntentInterpreterV2("k", "m").interpret({ transcript: "dosa 400 calories", today: "2026-10-08" });
    global.fetch = realFetch;
    expect(turn.entities).toEqual({ foodName: "dosa", calories: 400 });
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.generationConfig.responseSchema.properties.entities.type).toBe("ARRAY");
  });
});
