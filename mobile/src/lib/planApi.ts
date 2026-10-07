import { apiFetch } from "./api";

/**
 * apiFetch + JSON parse that never throws: a network failure comes back as
 * status 0 so callers can translate every outcome via planBuilder's
 * describeServerError / assignmentReason.
 */
export async function requestJson<T = Record<string, unknown>>(
  path: string,
  init?: RequestInit
): Promise<{ status: number; ok: boolean; body: (T & { error?: string }) | null }> {
  try {
    const res = await apiFetch(path, init);
    const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    return { status: res.status, ok: res.ok, body };
  } catch {
    return { status: 0, ok: false, body: null };
  }
}
