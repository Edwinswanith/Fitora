import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { apiFetch } from "./api";
import { CALL_PAGE_URL } from "./links";

// Live session video. The server issues a LiveKit join token
// (POST /api/{coach,athlete}/sessions/:id/join-token); the call itself runs in
// mobile/public/call.html, opened in the in-app browser. The token travels in
// the URL fragment, which is never sent to a server.

const JOIN_ERRORS: Record<string, string> = {
  outside_join_window: "You can join from 10 minutes before the session until 15 minutes after it ends.",
  session_not_joinable: "This session isn't confirmed yet, so it can't be joined.",
  relationship_ended: "This coaching relationship has ended, so the session can't be joined.",
  video_unavailable: "Video calls aren't set up on the server yet. Ask the Fitora team to connect LiveKit.",
  session_not_found: "This session no longer exists.",
};

export type JoinResult = { ok: true } | { ok: false; message: string };

export async function joinSessionCall(
  role: "coach" | "athlete",
  sessionId: string,
  labels: { withName: string; title: string }
): Promise<JoinResult> {
  let body: { error?: string; video?: { token?: string; serverUrl?: string } } = {};
  try {
    const res = await apiFetch(`/api/${role}/sessions/${sessionId}/join-token`, { method: "POST" });
    body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: JOIN_ERRORS[body.error ?? ""] ?? "Could not open the video session." };
  } catch {
    return { ok: false, message: "Could not reach the session service. Check your connection." };
  }
  const token = body.video?.token;
  const serverUrl = body.video?.serverUrl;
  if (!token || !serverUrl) return { ok: false, message: "Could not open the video session." };

  const fragment = new URLSearchParams({ token, url: serverUrl, with: labels.withName, title: labels.title }).toString();
  const callUrl = `${CALL_PAGE_URL}#${fragment}`;
  try {
    if (Platform.OS === "web") {
      // The await above means this is no longer a direct click, so a popup
      // blocker may refuse a new tab; fall back to opening in this tab.
      // (No "noopener" feature string: with it, window.open always returns
      // null, which would wrongly trigger the fallback.)
      const opened = globalThis.window?.open(callUrl, "_blank");
      if (opened) opened.opener = null;
      else if (globalThis.window) globalThis.window.location.href = callUrl;
    } else {
      await WebBrowser.openBrowserAsync(callUrl);
    }
    return { ok: true };
  } catch {
    return { ok: false, message: "Could not open the video call." };
  }
}
