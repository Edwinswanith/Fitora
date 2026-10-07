// videoAvailable() stops a real deployment without LiveKit credentials from
// handing out mock tokens for a call server that doesn't exist.

function loadWith(env: { strictSecrets: boolean; livekit: { apiKey: string; apiSecret: string; url: string } }) {
  let mod: typeof import("../src/services/videoProvider") | undefined;
  jest.isolateModules(() => {
    jest.doMock("../src/config/env", () => ({ env }));
    mod = require("../src/services/videoProvider");
  });
  return mod!;
}

const noKeys = { apiKey: "", apiSecret: "", url: "" };
const keys = { apiKey: "APIkey", apiSecret: "secret", url: "wss://example.livekit.cloud" };

describe("videoAvailable", () => {
  afterEach(() => jest.dontMock("../src/config/env"));

  it("allows the mock provider in local dev and tests", () => {
    expect(loadWith({ strictSecrets: false, livekit: noKeys }).videoAvailable()).toBe(true);
  });

  it("blocks the mock provider in a real deployment", () => {
    expect(loadWith({ strictSecrets: true, livekit: noKeys }).videoAvailable()).toBe(false);
  });

  it("allows real LiveKit credentials in a real deployment", () => {
    expect(loadWith({ strictSecrets: true, livekit: keys }).videoAvailable()).toBe(true);
  });
});
