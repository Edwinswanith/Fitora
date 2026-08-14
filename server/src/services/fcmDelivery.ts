/**
 * Adapter for sending push notifications via Firebase Cloud Messaging (HTTP v1).
 * `getPushDeliveryAdapter()` returns the real FCM adapter when both
 * FCM_PROJECT_ID and FCM_SERVICE_ACCOUNT_JSON are configured (and the JSON
 * actually parses), otherwise a no-op adapter — mirrors the
 * getWorkoutImageConverter() pattern in services/workoutImageConverter.ts.
 * Callers only depend on the PushDeliveryAdapter interface, so swapping
 * providers later (APNs directly, web-push) touches nothing else.
 */

import jwt from "jsonwebtoken";
import { env } from "../config/env";

export type PushPlatform = "android" | "ios" | "web";

export type PushSendInput = {
  tokens: { token: string; platform: PushPlatform }[];
  /** Data-only payload — every client's SW/native handler builds its own local
   *  notification from this, so display + deep-link logic lives in one place
   *  per client instead of diverging between platform-native alert payloads. */
  data: Record<string, string>;
};

export type PushSendResult = {
  token: string;
  ok: boolean;
  messageId?: string;
  error?: string;
  /** True when FCM reports the token as gone (UNREGISTERED/NOT_FOUND) — caller soft-disables it. */
  invalidToken?: boolean;
};

export interface PushDeliveryAdapter {
  send(input: PushSendInput): Promise<PushSendResult[]>;
}

type ServiceAccount = { client_email: string; private_key: string; project_id?: string };
const PUSH_CHANNEL_ID = "apex_push_popups_v2";

function parseServiceAccount(raw: string): ServiceAccount | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
    if (typeof parsed.client_email === "string" && typeof parsed.private_key === "string") {
      return {
        client_email: parsed.client_email,
        private_key: parsed.private_key,
        project_id: typeof parsed.project_id === "string" ? parsed.project_id : undefined,
      };
    }
    console.warn("[fcm] FCM_SERVICE_ACCOUNT_JSON is missing client_email/private_key");
    return null;
  } catch {
    console.warn("[fcm] FCM_SERVICE_ACCOUNT_JSON is not valid JSON — running push in no-op mode");
    return null;
  }
}

export function getFcmConfigurationStatus(): {
  ready: boolean;
  hasProjectIdEnv: boolean;
  hasServiceAccountJson: boolean;
  parsedServiceAccount: boolean;
  effectiveProjectIdSource: "env" | "service_account_json" | null;
  projectIdMatchesServiceAccount: boolean | null;
} {
  const serviceAccount = parseServiceAccount(env.fcm.serviceAccountJson);
  const envProjectId = env.fcm.projectId.trim();
  const serviceAccountProjectId = serviceAccount?.project_id?.trim() ?? "";
  const effectiveProjectId = envProjectId || serviceAccountProjectId;
  return {
    ready: Boolean(effectiveProjectId && serviceAccount),
    hasProjectIdEnv: Boolean(envProjectId),
    hasServiceAccountJson: Boolean(env.fcm.serviceAccountJson),
    parsedServiceAccount: Boolean(serviceAccount),
    effectiveProjectIdSource: envProjectId ? "env" : serviceAccountProjectId ? "service_account_json" : null,
    projectIdMatchesServiceAccount:
      envProjectId && serviceAccountProjectId ? envProjectId === serviceAccountProjectId : null,
  };
}

export class FcmHttpV1Adapter implements PushDeliveryAdapter {
  private cachedToken: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly projectId: string,
    private readonly serviceAccount: ServiceAccount
  ) {}

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAt - 5 * 60_000 > now) {
      return this.cachedToken.value;
    }
    const iat = Math.floor(now / 1000);
    const assertion = jwt.sign(
      {
        iss: this.serviceAccount.client_email,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: "https://oauth2.googleapis.com/token",
        iat,
        exp: iat + 3600,
      },
      this.serviceAccount.private_key,
      { algorithm: "RS256" }
    );

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
    if (!res.ok) throw new Error(`fcm_oauth_http_${res.status}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.cachedToken = { value: json.access_token, expiresAt: now + json.expires_in * 1000 };
    return json.access_token;
  }

  private async sendOne(accessToken: string, token: string, data: Record<string, string>): Promise<PushSendResult> {
    try {
      const title = data.title || "Apex";
      const body = data.body || "";
      const res = await fetch(
        `https://fcm.googleapis.com/v1/projects/${this.projectId}/messages:send`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            message: {
              token,
              notification: { title, body },
              data,
              android: {
                priority: "HIGH",
                notification: {
                  channel_id: PUSH_CHANNEL_ID,
                  sound: "default",
                  notification_priority: "PRIORITY_MAX",
                  default_sound: true,
                  default_vibrate_timings: true,
                  default_light_settings: true,
                  visibility: "PUBLIC",
                },
              },
              apns: {
                payload: {
                  aps: {
                    sound: "default",
                  },
                },
              },
            },
          }),
        }
      );
      if (res.ok) {
        const json = (await res.json()) as { name: string };
        return { token, ok: true, messageId: json.name };
      }
      const errJson = (await res.json().catch(() => ({}))) as {
        error?: { status?: string; message?: string };
      };
      const status = errJson.error?.status;
      const invalidToken = status === "UNREGISTERED" || status === "NOT_FOUND";
      return {
        token,
        ok: false,
        error: errJson.error?.message ?? `fcm_http_${res.status}`,
        invalidToken,
      };
    } catch (err) {
      return { token, ok: false, error: (err as Error).message };
    }
  }

  async send(input: PushSendInput): Promise<PushSendResult[]> {
    if (input.tokens.length === 0) return [];
    let accessToken: string;
    try {
      accessToken = await this.getAccessToken();
    } catch (err) {
      const error = (err as Error).message;
      console.warn("[fcm] access_token_failed", { error, tokenCount: input.tokens.length });
      return input.tokens.map((t) => ({ token: t.token, ok: false, error }));
    }
    // FCM v1 has no native multicast endpoint — one request per token, in parallel.
    return Promise.all(input.tokens.map((t) => this.sendOne(accessToken, t.token, input.data)));
  }
}

export class NoopPushDeliveryAdapter implements PushDeliveryAdapter {
  async send(input: PushSendInput): Promise<PushSendResult[]> {
    if (input.tokens.length > 0) {
      console.log(`[fcm:noop] would send "${input.data.type}" to ${input.tokens.length} token(s)`);
    }
    return input.tokens.map((t) => ({ token: t.token, ok: false, error: "fcm_not_configured" }));
  }
}

let adapter: PushDeliveryAdapter | null = null;

/** Single choke point for resolving the active push delivery adapter. */
export function getPushDeliveryAdapter(): PushDeliveryAdapter {
  if (!adapter) {
    const serviceAccount = parseServiceAccount(env.fcm.serviceAccountJson);
    const projectId = env.fcm.projectId.trim() || serviceAccount?.project_id?.trim() || "";
    if (projectId && serviceAccount) {
      console.log("[fcm] adapter=real", { projectId });
      adapter = new FcmHttpV1Adapter(projectId, serviceAccount);
    } else {
      console.warn("[fcm] adapter=noop", {
        hasProjectId: Boolean(env.fcm.projectId),
        hasServiceAccountJson: Boolean(env.fcm.serviceAccountJson),
        parsedServiceAccount: Boolean(serviceAccount),
      });
      adapter = new NoopPushDeliveryAdapter();
    }
  }
  return adapter;
}

/** Test-only seam for injecting a fake adapter. */
export function setPushDeliveryAdapterForTests(impl: PushDeliveryAdapter | null): void {
  adapter = impl;
}
