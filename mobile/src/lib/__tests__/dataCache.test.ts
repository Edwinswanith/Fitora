// The on-device data cache decides whose data a screen paints before the
// server answers, so it must never leak across users or show yesterday's
// numbers as today's.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { addDays, clearDataCache, hydrateDataCache, todayKey, updateCachedData } from "../fitoraData";

// jest.mock calls are hoisted above the imports by ts-jest.
jest.mock("@react-native-async-storage/async-storage", () =>
  jest.requireActual("@react-native-async-storage/async-storage/jest/async-storage-mock")
);
jest.mock("../api", () => ({ apiJson: jest.fn() }));

// React Native global that todayKey() reads; absent under plain Node.
(globalThis as { __DEV__?: boolean }).__DEV__ = false;

type Dashboard = { date: string; water: number };

function cached(key: string): unknown {
  let value: unknown;
  updateCachedData<unknown>(key, (prev) => {
    value = prev;
    return undefined; // read-only peek
  });
  return value;
}

async function flushWrites() {
  jest.advanceTimersByTime(500);
  jest.useRealTimers();
  await new Promise((resolve) => setImmediate(resolve));
  jest.useFakeTimers();
}

beforeEach(async () => {
  jest.useFakeTimers();
  await clearDataCache();
  await AsyncStorage.clear();
});

afterEach(() => {
  jest.useRealTimers();
});

test("saved data is restored for the same user on the next start", async () => {
  await hydrateDataCache("user-a");
  updateCachedData<Dashboard>("athlete-dashboard", () => ({ date: todayKey(), water: 750 }));
  await flushWrites();

  // Simulate an app restart: memory gone, storage kept.
  await hydrateDataCache("someone-else");
  expect(cached("athlete-dashboard")).toBeUndefined();
  await hydrateDataCache("user-a");
  expect(cached("athlete-dashboard")).toEqual({ date: todayKey(), water: 750 });
});

test("another user on the same device never sees the previous user's data", async () => {
  await hydrateDataCache("user-a");
  updateCachedData<Dashboard>("athlete-dashboard", () => ({ date: todayKey(), water: 750 }));
  await flushWrites();

  await hydrateDataCache("user-b");
  expect(cached("athlete-dashboard")).toBeUndefined();
});

test("sign-out wipes saved data for everyone", async () => {
  await hydrateDataCache("user-a");
  updateCachedData<Dashboard>("athlete-dashboard", () => ({ date: todayKey(), water: 750 }));
  await flushWrites();

  await clearDataCache();
  expect(cached("athlete-dashboard")).toBeUndefined();
  expect((await AsyncStorage.getAllKeys()).filter((k) => k.startsWith("fitora.cache"))).toEqual([]);
  await hydrateDataCache("user-a");
  expect(cached("athlete-dashboard")).toBeUndefined();
});

test("a screen saved yesterday is not reused as today's", async () => {
  await AsyncStorage.setItem(
    "fitora.cache.v1:user-a:athlete-dashboard",
    JSON.stringify({ savedAt: Date.now(), data: { date: addDays(todayKey(), -1), water: 2000 } })
  );
  await hydrateDataCache("user-a");
  expect(cached("athlete-dashboard")).toBeUndefined();
  expect(await AsyncStorage.getItem("fitora.cache.v1:user-a:athlete-dashboard")).toBeNull();
});

test("undated screens are reused, but not after a week", async () => {
  const week = 7 * 24 * 60 * 60 * 1000;
  await AsyncStorage.multiSet([
    ["fitora.cache.v1:user-a:coach-profile", JSON.stringify({ savedAt: Date.now() - 1000, data: { name: "Fresh" } })],
    ["fitora.cache.v1:user-a:coach-content", JSON.stringify({ savedAt: Date.now() - week - 1000, data: { name: "Old" } })],
  ]);
  await hydrateDataCache("user-a");
  expect(cached("coach-profile")).toEqual({ name: "Fresh" });
  expect(cached("coach-content")).toBeUndefined();
});

test("corrupt saved entries are ignored and removed", async () => {
  await AsyncStorage.setItem("fitora.cache.v1:user-a:coach-plan", "{not json");
  await hydrateDataCache("user-a");
  expect(cached("coach-plan")).toBeUndefined();
  expect(await AsyncStorage.getItem("fitora.cache.v1:user-a:coach-plan")).toBeNull();
});
