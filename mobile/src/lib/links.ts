import { Linking, Platform } from "react-native";

// Public pages (legal/*.html) are published next to the web build by
// scripts/vercel-build.mjs. The web build serves them from its own origin;
// native builds link to the deployed site.
const DEFAULT_SITE_URL = "https://fitora-psi.vercel.app";

function siteUrl(): string {
  if (Platform.OS === "web" && typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return process.env.EXPO_PUBLIC_SITE_URL || DEFAULT_SITE_URL;
}

export const PRIVACY_POLICY_URL = `${siteUrl()}/privacy.html`;
export const SUPPORT_URL = `${siteUrl()}/support.html`;

export function openExternal(url: string): void {
  Linking.openURL(url).catch(() => undefined);
}
