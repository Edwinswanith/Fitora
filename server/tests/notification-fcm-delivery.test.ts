import {
  FcmHttpV1Adapter,
  getPushDeliveryAdapter,
  setPushDeliveryAdapterForTests,
  NoopPushDeliveryAdapter,
} from "../src/services/fcmDelivery";
import jwt from "jsonwebtoken";

afterEach(() => setPushDeliveryAdapterForTests(null));

describe("getPushDeliveryAdapter", () => {
  test("resolves to the no-op adapter when FCM_PROJECT_ID/FCM_SERVICE_ACCOUNT_JSON are unset", () => {
    const adapter = getPushDeliveryAdapter();
    expect(adapter).toBeInstanceOf(NoopPushDeliveryAdapter);
  });

  test("no-op adapter reports a configuration error for every token without any network call", async () => {
    const adapter = new NoopPushDeliveryAdapter();
    const results = await adapter.send({
      tokens: [
        { token: "a", platform: "android" },
        { token: "b", platform: "web" },
      ],
      data: { type: "daily_checkin_reminder", title: "t", body: "b", link: "" },
    });
    expect(results).toEqual([
      { token: "a", ok: false, error: "fcm_not_configured" },
      { token: "b", ok: false, error: "fcm_not_configured" },
    ]);
  });

  test("no-op adapter handles an empty token list", async () => {
    const adapter = new NoopPushDeliveryAdapter();
    expect(await adapter.send({ tokens: [], data: {} })).toEqual([]);
  });
});

describe("FcmHttpV1Adapter", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test("sends visible notification payload with app routing data", async () => {
    jest.spyOn(jwt, "sign").mockReturnValue("signed-assertion" as never);
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "access-token", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ name: "projects/apex/messages/1" }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    const adapter = new FcmHttpV1Adapter("apex", {
      client_email: "service@example.com",
      private_key: "not-used-because-jwt-is-mocked",
    });

    const result = await adapter.send({
      tokens: [{ token: "device-token", platform: "android" }],
      data: {
        type: "daily_checkin_reminder",
        title: "Check-in reminder",
        body: "Don't forget today's check-in.",
        link: "/athlete/dashboard",
      },
    });

    expect(result).toEqual([{ token: "device-token", ok: true, messageId: "projects/apex/messages/1" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const sendInit = fetchMock.mock.calls[1][1] as RequestInit;
    const payload = JSON.parse(sendInit.body as string);
    expect(payload.message).toMatchObject({
      token: "device-token",
      notification: {
        title: "Check-in reminder",
        body: "Don't forget today's check-in.",
      },
      data: {
        type: "daily_checkin_reminder",
        title: "Check-in reminder",
        body: "Don't forget today's check-in.",
        link: "/athlete/dashboard",
      },
      android: {
        priority: "HIGH",
        notification: {
          channel_id: "apex_push_popups_v2",
          sound: "default",
          notification_priority: "PRIORITY_MAX",
          default_sound: true,
          default_vibrate_timings: true,
          default_light_settings: true,
          visibility: "PUBLIC",
        },
      },
    });
  });
});
