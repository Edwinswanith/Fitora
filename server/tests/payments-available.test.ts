// paymentsAvailable() is the guard that stops a real deployment from running
// checkouts/webhooks on the mock provider, whose webhook secret is public.

function loadWith(env: { strictSecrets: boolean; razorpay: { keyId: string; keySecret: string; webhookSecret: string } }) {
  let mod: typeof import("../src/services/paymentProvider") | undefined;
  jest.isolateModules(() => {
    jest.doMock("../src/config/env", () => ({ env }));
    mod = require("../src/services/paymentProvider");
  });
  return mod!;
}

const noKeys = { keyId: "", keySecret: "", webhookSecret: "" };
const keys = { keyId: "rzp_test", keySecret: "secret", webhookSecret: "whsec" };

describe("paymentsAvailable", () => {
  afterEach(() => jest.dontMock("../src/config/env"));

  it("allows the mock provider in local dev and tests", () => {
    expect(loadWith({ strictSecrets: false, razorpay: noKeys }).paymentsAvailable()).toBe(true);
  });

  it("blocks the mock provider in a real deployment", () => {
    expect(loadWith({ strictSecrets: true, razorpay: noKeys }).paymentsAvailable()).toBe(false);
  });

  it("allows real Razorpay credentials in a real deployment", () => {
    expect(loadWith({ strictSecrets: true, razorpay: keys }).paymentsAvailable()).toBe(true);
  });
});
