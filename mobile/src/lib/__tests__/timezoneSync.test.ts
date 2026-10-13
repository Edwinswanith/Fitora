// Reminders and quiet hours run in the athlete's saved timezone, so the app
// saves the phone's zone once, and again only when it changes.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiFetch } from "../api";
import { needsTimezoneSync, syncAthleteTimezone } from "../timezoneSync";

jest.mock("@react-native-async-storage/async-storage", () =>
  jest.requireActual("@react-native-async-storage/async-storage/jest/async-storage-mock")
);
jest.mock("../api", () => ({ apiFetch: jest.fn() }));
jest.mock("../dateTimeValues", () => ({ deviceTimeZone: () => mockZone }));

let mockZone = "Asia/Kolkata";
const fetchMock = apiFetch as jest.Mock;

beforeEach(async () => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true });
  await AsyncStorage.clear();
});

describe("needsTimezoneSync", () => {
  it("syncs a real zone that differs from the last saved one", () => {
    expect(needsTimezoneSync("Asia/Kolkata", null)).toBe(true);
    expect(needsTimezoneSync("Asia/Kolkata", "Europe/London")).toBe(true);
  });
  it("skips when nothing changed or the phone only reports UTC", () => {
    expect(needsTimezoneSync("Asia/Kolkata", "Asia/Kolkata")).toBe(false);
    expect(needsTimezoneSync("UTC", null)).toBe(false);
    expect(needsTimezoneSync("", null)).toBe(false);
  });
});

describe("syncAthleteTimezone", () => {
  it("saves the zone once, then not again until the phone's zone changes", async () => {
    mockZone = "Asia/Kolkata";
    await syncAthleteTimezone("u1");
    expect(fetchMock).toHaveBeenCalledWith("/api/athlete/me", { method: "PATCH", body: JSON.stringify({ timezone: "Asia/Kolkata" }) });
    await syncAthleteTimezone("u1");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    mockZone = "Europe/London";
    await syncAthleteTimezone("u1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await AsyncStorage.getItem("fitora.timezone.v1:u1")).toBe("Europe/London");
  });

  it("retries next time when the save fails", async () => {
    mockZone = "Asia/Dubai";
    fetchMock.mockResolvedValueOnce({ ok: false });
    await syncAthleteTimezone("u2");
    expect(await AsyncStorage.getItem("fitora.timezone.v1:u2")).toBeNull();
    await syncAthleteTimezone("u2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await AsyncStorage.getItem("fitora.timezone.v1:u2")).toBe("Asia/Dubai");
  });
});
