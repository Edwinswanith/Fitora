import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

/** Generic JSON persistence over the same SecureStore(native)/localStorage(web)
 * split the tour's original string-flag storage already used (see
 * MobileTourProvider's getStoredFlag/setStoredFlag) — this is that idea
 * generalized to arbitrary JSON values for the new completed/skipped/resume/
 * prefs keys. */

export async function getStoredJson<T>(key: string): Promise<T | null> {
  try {
    const raw = Platform.OS === "web" ? (globalThis.localStorage?.getItem(key) ?? null) : await SecureStore.getItemAsync(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function setStoredJson(key: string, value: unknown): Promise<void> {
  const raw = JSON.stringify(value);
  try {
    if (Platform.OS === "web") {
      globalThis.localStorage?.setItem(key, raw);
      return;
    }
    await SecureStore.setItemAsync(key, raw);
  } catch {
    // best-effort — persistence failures shouldn't break the tour itself
  }
}

export async function removeStoredJson(key: string): Promise<void> {
  try {
    if (Platform.OS === "web") {
      globalThis.localStorage?.removeItem(key);
      return;
    }
    await SecureStore.deleteItemAsync(key);
  } catch {
    // ignore
  }
}

export function tourCompletedKey(userId: string): string {
  return `scp.mobile.tour.completed.${userId}`;
}
export function tourSkippedKey(userId: string): string {
  return `scp.mobile.tour.skipped.${userId}`;
}
export function tourResumeKey(userId: string, role: string): string {
  return `scp.mobile.tour.resume.${userId}.${role}`;
}
export function tourFeatureSeenKey(userId: string, featureKey: string): string {
  return `scp.mobile.tour.featureSeen.${userId}.${featureKey}`;
}
export function tourPrefsKey(userId: string): string {
  return `scp.mobile.tour.prefs.${userId}`;
}

export type TourPrefs = { mascotAnimationsEnabled: boolean; soundEnabled: boolean };
export const DEFAULT_TOUR_PREFS: TourPrefs = { mascotAnimationsEnabled: true, soundEnabled: false };

export type TourResumeSnapshot = { index: number; stepId: string };
