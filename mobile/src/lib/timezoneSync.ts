import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiFetch } from "./api";
import { deviceTimeZone } from "./dateTimeValues";

// Reminder times and quiet hours run in the athlete's saved timezone, so it
// has to follow the phone: set once for accounts made before sign-up sent it,
// and again whenever the athlete travels or changes the phone's zone.

const SYNCED_KEY = "fitora.timezone.v1:";

/** Last zone we saved for each user this process, so a session check never repeats the write. */
const syncedThisProcess = new Map<string, string>();

/** True when the saved zone must be updated to the phone's zone. */
export function needsTimezoneSync(deviceZone: string, lastSynced: string | null): boolean {
  return Boolean(deviceZone) && deviceZone !== "UTC" && deviceZone !== lastSynced;
}

/** Saves the phone's zone to the athlete profile when it changed. Best effort: failures retry next launch. */
export async function syncAthleteTimezone(userId: string): Promise<void> {
  const zone = deviceTimeZone();
  if (syncedThisProcess.get(userId) === zone) return;
  let lastSynced: string | null = null;
  try {
    lastSynced = await AsyncStorage.getItem(SYNCED_KEY + userId);
  } catch {
    // no saved value: sync anyway
  }
  if (!needsTimezoneSync(zone, lastSynced)) {
    syncedThisProcess.set(userId, zone);
    return;
  }
  try {
    const res = await apiFetch("/api/athlete/me", { method: "PATCH", body: JSON.stringify({ timezone: zone }) });
    if (!res.ok) return;
    syncedThisProcess.set(userId, zone);
    await AsyncStorage.setItem(SYNCED_KEY + userId, zone).catch(() => undefined);
  } catch {
    // offline: try again on the next launch
  }
}
