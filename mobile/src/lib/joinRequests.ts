// Request to join a coach (server: routes/coachJoinRequests.ts). The in-app
// way for an athlete without a coach to get one while payments are off.

import { apiFetch } from "./api";

export type JoinRequestStatus = "pending" | "accepted" | "declined" | "cancelled";

export type JoinRequest = {
  id: string;
  status: JoinRequestStatus;
  message: string;
  createdAt: string;
  decidedAt: string | null;
  coach: { id: string; name: string };
  athlete: { id: string; name: string; sport: string | null };
};

const ERROR_MESSAGES: Record<string, string> = {
  request_pending: "You already have a request waiting. Cancel it to ask a different coach.",
  already_has_coach: "You already have a coach. Leave them from the Coach tab before asking someone new.",
  already_your_coach: "This is already your coach.",
  coach_not_found: "This coach isn't taking requests right now.",
  athlete_has_active_coach: "This athlete already has a coach, so the request was closed.",
  request_not_found: "This request was already answered or withdrawn.",
  invite_not_found: "This invite has expired or was already answered.",
};

export function joinRequestErrorMessage(code: string | undefined, fallback = "Something went wrong. Please try again."): string {
  return (code && ERROR_MESSAGES[code]) || fallback;
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };

async function call<T>(path: string, init?: RequestInit): Promise<Result<T>> {
  try {
    const res = await apiFetch(path, init);
    const body = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) return { ok: false, error: joinRequestErrorMessage(body.error), code: body.error };
    return { ok: true, data: body };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection." };
  }
}

// ── Athlete ──
export async function loadMyJoinRequest(): Promise<JoinRequest | null> {
  const result = await call<{ request: JoinRequest | null }>("/api/athlete/join-request");
  return result.ok ? result.data.request : null;
}

export function sendJoinRequest(coachId: string, message: string) {
  return call<{ request: JoinRequest }>(`/api/athlete/coaches/${encodeURIComponent(coachId)}/join-request`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

export function cancelJoinRequest(requestId: string) {
  return call<{ request: JoinRequest }>(`/api/athlete/join-request/${encodeURIComponent(requestId)}/cancel`, { method: "POST" });
}

// Coach invites: a coach asked this athlete, by email, to train with them.
// Nothing is shared with the coach until the athlete accepts.
export type CoachInvite = {
  id: string;
  createdAt: string;
  expiresAt: string;
  coach: { id: string; name: string; specializations: string[]; yearsExperience: number | null };
};

export async function loadMyCoachInvites(): Promise<CoachInvite[]> {
  const result = await call<{ invites: CoachInvite[] }>("/api/athlete/coach-invites");
  return result.ok ? result.data.invites : [];
}

export function decideCoachInvite(inviteId: string, decision: "accept" | "decline") {
  return call<{ invite: { id: string; status: string } }>(`/api/athlete/coach-invites/${encodeURIComponent(inviteId)}/${decision}`, { method: "POST" });
}

// ── Coach ──
export async function loadCoachJoinRequests(): Promise<JoinRequest[]> {
  const result = await call<{ requests: JoinRequest[] }>("/api/coach/join-requests");
  return result.ok ? result.data.requests : [];
}

export function decideJoinRequest(requestId: string, decision: "accept" | "decline") {
  return call<{ request: JoinRequest }>(`/api/coach/join-requests/${encodeURIComponent(requestId)}/${decision}`, { method: "POST" });
}
