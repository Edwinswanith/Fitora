import * as Notifications from "expo-notifications";
import * as Application from "expo-application";
import * as Device from "expo-device";
import { Platform } from "react-native";
import { apiFetch } from "./api";

let cachedToken: string | null = null;
const PUSH_CHANNEL_ID = "apex_push_popups_v2";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function supportsRemotePush(): boolean {
  return Platform.OS === "android" || Platform.OS === "ios";
}

async function ensureChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(PUSH_CHANNEL_ID, {
    name: "Apex popup alerts",
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 300, 200, 300],
    enableVibrate: true,
    enableLights: true,
    lightColor: "#c47a11",
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    showBadge: true,
  }).catch(() => undefined);
}

function pushDeviceMetadata() {
  const version = Application.nativeApplicationVersion ?? "unknown";
  const build = Application.nativeBuildVersion ?? "unknown";
  return {
    appVersion: `${version} (${build})`,
    deviceName: Device.modelName ?? Device.deviceName ?? null,
    osName: Device.osName ?? Platform.OS,
    osVersion: Device.osVersion ?? null,
  };
}

async function submitPushToken(token: string): Promise<boolean> {
  const res = await apiFetch("/api/device-tokens", {
    method: "POST",
    body: JSON.stringify({ token, platform: Platform.OS, ...pushDeviceMetadata() }),
  });
  if (res.ok) cachedToken = token;
  return res.ok;
}

export async function registerPushToken(): Promise<void> {
  if (!supportsRemotePush()) return;
  try {
    await ensureChannel();
    const current = await Notifications.getPermissionsAsync();
    let granted = current.granted;
    if (!granted && current.canAskAgain) {
      granted = (await Notifications.requestPermissionsAsync()).granted;
    }
    if (!granted) return;

    const result = await Notifications.getDevicePushTokenAsync();
    if (!result?.data) return;

    await submitPushToken(result.data);
  } catch {
    // Push setup is best-effort and must not block sign-in.
  }
}

export function subscribeToPushTokenUpdates(): () => void {
  if (!supportsRemotePush()) return () => undefined;
  const subscription = Notifications.addPushTokenListener((token) => {
    if (typeof token.data === "string" && token.data) {
      void submitPushToken(token.data);
    }
  });
  return () => subscription.remove();
}

export async function deregisterPushToken(): Promise<void> {
  if (!supportsRemotePush() || !cachedToken) return;
  try {
    await apiFetch("/api/device-tokens", {
      method: "DELETE",
      body: JSON.stringify({ token: cachedToken }),
    });
    cachedToken = null;
  } catch {
    // Best-effort on sign-out.
  }
}

type PushData = { title?: string; body?: string; link?: string };

export function subscribeToPushMessages(onOpenLink: (link: string) => void): () => void {
  if (!supportsRemotePush()) return () => undefined;

  const openFromData = (data: PushData | undefined) => {
    if (typeof data?.link === "string" && data.link) onOpenLink(data.link);
  };

  const lastResponse = Notifications.getLastNotificationResponse();
  openFromData(lastResponse?.notification.request.content.data as PushData | undefined);

  const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
    openFromData(response.notification.request.content.data as PushData | undefined);
  });

  return () => {
    responseSub.remove();
  };
}
