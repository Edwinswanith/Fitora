// Native API client. Unlike the web app, which relies on httpOnly cookies, the
// mobile app stores tokens in SecureStore and sends the access token as a
// Bearer header. The refresh token is sent only to auth endpoints that rotate or
// clear sessions.

import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const LOCAL_API_BASE = "http://localhost:4000";
const PRODUCTION_API_BASE = "https://sports-coaching-server.vercel.app";

function resolveApiBase(): string {
  const configuredBase = process.env.EXPO_PUBLIC_API_URL || process.env.EXPO_PUBLIC_API_BASE_URL;

  if (Platform.OS === "web") {
    if (!__DEV__ && typeof window !== "undefined" && window.location?.origin) {
      return window.location.origin;
    }
    return configuredBase || LOCAL_API_BASE;
  }

  if (configuredBase) {
    return configuredBase;
  }
  if (__DEV__) {
    return LOCAL_API_BASE;
  }

  return PRODUCTION_API_BASE;
}

export const API_BASE = resolveApiBase();

const TOKEN_KEY = "scp.accessToken";
const REFRESH_KEY = "scp.refreshToken";
const USER_KEY = "scp.user";

export type StoredUser = {
  id?: string;
  name: string;
  email: string;
  role: string;
  mustChangePassword?: boolean;
  isAcademyOwner?: boolean;
  avatar?: { kind: "photo" | "default" | null; defaultId: string | null };
  voiceLanguage?: string;
};

type AuthPayload = {
  accessToken?: string;
  refreshToken?: string;
  user?: StoredUser;
  error?: string;
};
type MePayload = {
  user?: StoredUser;
  error?: string;
};

export type LoginResult =
  | { ok: true; user: StoredUser }
  | { ok: false; status: number; error: string };

let accessToken: string | null = null;
let refreshToken: string | null = null;

async function getStoredItem(key: string): Promise<string | null> {
  if (Platform.OS === "web") return globalThis.localStorage?.getItem(key) ?? null;
  return SecureStore.getItemAsync(key);
}

async function setStoredItem(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    globalThis.localStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function deleteStoredItem(key: string): Promise<void> {
  if (Platform.OS === "web") {
    globalThis.localStorage?.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

async function clearStorage(): Promise<void> {
  accessToken = null;
  refreshToken = null;
  await deleteStoredItem(TOKEN_KEY).catch(() => undefined);
  await deleteStoredItem(REFRESH_KEY).catch(() => undefined);
  await deleteStoredItem(USER_KEY).catch(() => undefined);
}

export async function loadSession(): Promise<StoredUser | null> {
  [accessToken, refreshToken] = await Promise.all([
    getStoredItem(TOKEN_KEY),
    getStoredItem(REFRESH_KEY),
  ]);
  const raw = await getStoredItem(USER_KEY);
  if (!raw || !accessToken) {
    if (raw || accessToken || refreshToken) await clearStorage();
    return null;
  }
  try {
    const cached = JSON.parse(raw) as StoredUser;
    const current = await loadCurrentUser();
    return current ?? cached;
  } catch {
    await clearStorage();
    return null;
  }
}

async function loadCurrentUser(): Promise<StoredUser | null> {
  if (!accessToken) return null;

  const requestMe = () =>
    fetchWithTimeout(`${API_BASE}/api/auth/me`, {
      method: "GET",
      headers: {
        "X-Client-Type": "native",
        Authorization: `Bearer ${accessToken}`,
      },
    });

  try {
    let res = await requestMe();
    if (res.status === 401) {
      const refreshed = await tryRefresh();
      if (!refreshed) return null;
      res = await requestMe();
    }
    if (!res.ok) return null;

    const payload = (await res.json().catch(() => ({}))) as MePayload;
    if (!payload.user) return null;
    await persistUser(payload.user);
    return payload.user;
  } catch {
    return null;
  }
}

async function persist(tokens: { accessToken: string; refreshToken?: string }, user: StoredUser): Promise<void> {
  accessToken = tokens.accessToken;
  if (tokens.refreshToken) refreshToken = tokens.refreshToken;
  await setStoredItem(TOKEN_KEY, tokens.accessToken);
  if (tokens.refreshToken) await setStoredItem(REFRESH_KEY, tokens.refreshToken);
  await setStoredItem(USER_KEY, JSON.stringify(user));
}

function nativeHeaders(extra?: HeadersInit): HeadersInit {
  return {
    "Content-Type": "application/json",
    "X-Client-Type": "native",
    ...(extra ?? {}),
  };
}

/**
 * `fetch` has no built-in timeout — on a dead/blackholed connection (bad wifi,
 * captive portal, corporate firewall) it can hang far longer than a user will
 * wait, with no error ever surfacing. Bound every request so a bad network
 * fails fast with a clear error instead of spinning forever.
 */
async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function login(email: string, password: string): Promise<LoginResult> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: nativeHeaders(),
      body: JSON.stringify({ email: email.trim(), password, client: "native" }),
    });
    const payload = (await res.json().catch(() => ({}))) as AuthPayload;
    if (!res.ok || !payload.user || !payload.accessToken) {
      return { ok: false, status: res.status, error: payload.error ?? "login_failed" };
    }
    await persist({ accessToken: payload.accessToken, refreshToken: payload.refreshToken }, payload.user);
    return { ok: true, user: payload.user };
  } catch {
    return { ok: false, status: 0, error: "network_error" };
  }
}

/** Exchange a Google ID token for a session. First-time users use requestedRole. */
export async function googleLogin(idToken: string, requestedRole: string): Promise<LoginResult> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/auth/google`, {
      method: "POST",
      headers: nativeHeaders(),
      body: JSON.stringify({ credential: idToken, requestedRole, client: "native" }),
    });
    const payload = (await res.json().catch(() => ({}))) as AuthPayload;
    if (!res.ok || !payload.user || !payload.accessToken) {
      return { ok: false, status: res.status, error: payload.error ?? "google_failed" };
    }
    await persist({ accessToken: payload.accessToken, refreshToken: payload.refreshToken }, payload.user);
    return { ok: true, user: payload.user };
  } catch {
    return { ok: false, status: 0, error: "network_error" };
  }
}

/** Exchange an Apple identity token for a session. First-time users use requestedRole. */
export async function appleLogin(
  identityToken: string,
  requestedRole: string,
  fullName?: string
): Promise<LoginResult> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/auth/apple`, {
      method: "POST",
      headers: nativeHeaders(),
      body: JSON.stringify({ identityToken, requestedRole, fullName, client: "native" }),
    });
    const payload = (await res.json().catch(() => ({}))) as AuthPayload;
    if (!res.ok || !payload.user || !payload.accessToken) {
      return { ok: false, status: res.status, error: payload.error ?? "apple_failed" };
    }
    await persist({ accessToken: payload.accessToken, refreshToken: payload.refreshToken }, payload.user);
    return { ok: true, user: payload.user };
  } catch {
    return { ok: false, status: 0, error: "network_error" };
  }
}

/** Self-service athlete sign-up. Returns a session on success. */
export async function registerAthlete(fields: {
  name: string;
  email: string;
  password: string;
  sport: string;
  position?: string;
}): Promise<LoginResult> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/auth/register-athlete`, {
      method: "POST",
      headers: nativeHeaders(),
      body: JSON.stringify({ ...fields, client: "native" }),
    });
    const payload = (await res.json().catch(() => ({}))) as AuthPayload;
    if (!res.ok || !payload.user || !payload.accessToken) {
      return { ok: false, status: res.status, error: payload.error ?? "register_failed" };
    }
    await persist({ accessToken: payload.accessToken, refreshToken: payload.refreshToken }, payload.user);
    return { ok: true, user: payload.user };
  } catch {
    return { ok: false, status: 0, error: "network_error" };
  }
}

// Single-flight refresh so parallel 401s trigger one refresh.
let refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (!refreshToken) return false;
  if (!refreshing) {
    refreshing = fetchWithTimeout(`${API_BASE}/api/auth/refresh`, {
      method: "POST",
      headers: nativeHeaders(),
      body: JSON.stringify({ refreshToken, client: "native" }),
    })
      .then(async (r) => {
        if (!r.ok) {
          await clearStorage();
          return false;
        }
        const body = (await r.json().catch(() => ({}))) as AuthPayload;
        if (body.accessToken && body.refreshToken && body.user) {
          await persist({ accessToken: body.accessToken, refreshToken: body.refreshToken }, body.user);
          return true;
        }
        await clearStorage();
        return false;
      })
      .catch(() => false)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

/** Authenticated fetch: attaches the Bearer token and retries once on 401. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  // FormData bodies (file uploads) must NOT get a manual Content-Type — the
  // runtime sets one with the correct multipart boundary itself.
  const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
  const build = (): RequestInit => ({
    ...init,
    headers: {
      ...(init.body && !isFormData ? { "Content-Type": "application/json" } : {}),
      "X-Client-Type": "native",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  // Longer budget than auth calls — this also carries multipart file uploads.
  let res = await fetchWithTimeout(`${API_BASE}${path}`, build(), 30000);
  if (res.status === 401) {
    const refreshed = await tryRefresh();
    if (refreshed) res = await fetchWithTimeout(`${API_BASE}${path}`, build(), 30000);
  }
  return res;
}

/** Current access token — for building authenticated <Image> source headers. */
export function getAccessToken(): string | null {
  return accessToken;
}

/** Persists an updated user profile (e.g. after an avatar change) without touching tokens. */
export async function persistUser(user: StoredUser): Promise<void> {
  await setStoredItem(USER_KEY, JSON.stringify(user));
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init);
  if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => ""));
  return (await res.json()) as T;
}

export class ApiError extends Error {
  constructor(public status: number, public body: string) {
    super(`api_error_${status}`);
  }
}

/** Change password. On success the server rotates tokens, so persist both. */
export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<{ ok: true; user: StoredUser } | { ok: false; status: number; error: string }> {
  const res = await apiFetch("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword, client: "native" }),
  });
  const body = (await res.json().catch(() => ({}))) as AuthPayload;
  if (res.ok && body.accessToken && body.refreshToken && body.user) {
    await persist({ accessToken: body.accessToken, refreshToken: body.refreshToken }, body.user);
    return { ok: true, user: body.user };
  }
  return { ok: false, status: res.status, error: body.error ?? "change_failed" };
}

export async function logout(): Promise<void> {
  await fetch(`${API_BASE}/api/auth/logout`, {
    method: "POST",
    headers: nativeHeaders(),
    body: JSON.stringify({ refreshToken, client: "native" }),
  }).catch(() => undefined);
  await clearStorage();
}

export async function deleteAccount(): Promise<
  { ok: true } | { ok: false; status: number; error: string }
> {
  try {
    const res = await apiFetch("/api/auth/account", {
      method: "DELETE",
      body: JSON.stringify({ confirmation: "DELETE" }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      return { ok: false, status: res.status, error: body.error ?? "delete_failed" };
    }
    await clearStorage();
    return { ok: true };
  } catch {
    return { ok: false, status: 0, error: "network_error" };
  }
}

export function isAuthFailure(status: number): boolean {
  return status === 401 || status === 403;
}
