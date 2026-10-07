/**
 * Adapter for the live-video provider (LiveKit). Mirrors the
 * getPaymentProvider()/getPushDeliveryAdapter() pattern: a real adapter when
 * LIVEKIT_API_KEY/LIVEKIT_API_SECRET/LIVEKIT_URL are all set, otherwise a
 * mock adapter — so join-token issuance and the room lifecycle stay
 * exercisable/tested with no live LiveKit project configured.
 *
 * LiveKit facts this adapter relies on (verified against LiveKit's own
 * server-API docs): a participant/admin access token is a JWT — HS256,
 * signed with the project's API secret, `iss` = API key, `sub` = participant
 * identity, `exp`/`nbf` for the validity window, and a `video` claim
 * (VideoGrant) carrying the actual permissions (`roomJoin`+`room` to join a
 * specific room, `roomCreate`/`roomAdmin` for the Room Service admin API).
 * The Room Service admin API itself is Twirp (not REST): POST JSON to
 * `{host}/twirp/livekit.RoomService/<Method>` with the signed token as a
 * Bearer header. No official SDK dependency is used here — same
 * fetch-based, hand-signed-JWT approach as services/paymentProvider.ts's
 * Razorpay adapter.
 */

import jwt from "jsonwebtoken";
import { env } from "../config/env";

export type ParticipantRole = "coach" | "athlete";

export type IssuedToken = {
  token: string;
  serverUrl: string;
  expiresAt: Date;
};

export interface VideoProvider {
  /** Idempotent-in-intent: safe to call once per session, lazily, on first join-token request. */
  createRoom(roomName: string): Promise<{ roomRef: string }>;
  issueParticipantToken(roomRef: string, participantIdentity: string, participantName: string, ttlSeconds: number): Promise<IssuedToken>;
  terminateRoom(roomRef: string): Promise<void>;
}

const ROOM_EMPTY_TIMEOUT_SEC = 30 * 60; // auto-close an unattended room after 30 idle minutes
const MAX_PARTICIPANTS = 2; // 1:1 coaching session

type VideoGrant = {
  room?: string;
  roomJoin?: boolean;
  roomCreate?: boolean;
  roomAdmin?: boolean;
  canPublish?: boolean;
  canSubscribe?: boolean;
};

function signLiveKitToken(apiKey: string, apiSecret: string, identity: string, grant: VideoGrant, ttlSeconds: number, name?: string): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iss: apiKey,
      sub: identity,
      nbf: now,
      exp: now + ttlSeconds,
      name,
      video: grant,
    },
    apiSecret,
    { algorithm: "HS256" }
  );
}

/** wss://project.livekit.cloud -> https://project.livekit.cloud (the Twirp admin API always speaks http(s), never the ws(s) the client SDK connects with). */
function toHttpHost(wsUrl: string): string {
  return wsUrl.replace(/^wss:\/\//i, "https://").replace(/^ws:\/\//i, "http://");
}

export class LiveKitVideoProvider implements VideoProvider {
  private readonly httpHost: string;

  constructor(
    private readonly apiKey: string,
    private readonly apiSecret: string,
    private readonly wsUrl: string
  ) {
    this.httpHost = toHttpHost(wsUrl);
  }

  private adminToken(grant: VideoGrant): string {
    // Admin/service tokens are short-lived — minted fresh per call, never persisted.
    return signLiveKitToken(this.apiKey, this.apiSecret, "fitora-server", grant, 60);
  }

  private async twirp<T>(method: string, body: Record<string, unknown>, grant: VideoGrant): Promise<T> {
    const res = await fetch(`${this.httpHost}/twirp/livekit.RoomService/${method}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.adminToken(grant)}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`livekit_http_${res.status}: ${errBody.slice(0, 500)}`);
    }
    return (await res.json()) as T;
  }

  async createRoom(roomName: string): Promise<{ roomRef: string }> {
    await this.twirp<{ name: string }>(
      "CreateRoom",
      { name: roomName, emptyTimeout: ROOM_EMPTY_TIMEOUT_SEC, maxParticipants: MAX_PARTICIPANTS },
      { roomCreate: true }
    );
    return { roomRef: roomName };
  }

  async issueParticipantToken(roomRef: string, participantIdentity: string, participantName: string, ttlSeconds: number): Promise<IssuedToken> {
    const token = signLiveKitToken(
      this.apiKey,
      this.apiSecret,
      participantIdentity,
      { room: roomRef, roomJoin: true, canPublish: true, canSubscribe: true },
      ttlSeconds,
      participantName
    );
    return { token, serverUrl: this.wsUrl, expiresAt: new Date(Date.now() + ttlSeconds * 1000) };
  }

  async terminateRoom(roomRef: string): Promise<void> {
    try {
      await this.twirp("DeleteRoom", { room: roomRef }, { roomAdmin: true, room: roomRef });
    } catch (err) {
      // Deleting an already-gone/never-created room is a benign no-op for our
      // purposes (e.g. a session cancelled before any join-token was ever
      // issued has no room to delete) — don't let cleanup fail the caller.
      console.warn("[livekit] terminateRoom failed (non-fatal)", { roomRef, error: (err as Error).message });
    }
  }
}

/**
 * Deterministic, fully offline provider for local dev and tests. Still
 * issues a real signed JWT (fixed mock secret) so callers/tests can decode
 * and assert on its claims exactly as they would a real LiveKit token.
 */
export class MockVideoProvider implements VideoProvider {
  static readonly MOCK_API_KEY = "mock_livekit_key";
  static readonly MOCK_API_SECRET = "mock_livekit_secret_do_not_use_in_prod";
  static readonly MOCK_SERVER_URL = "wss://mock.livekit.local";

  private readonly createdRooms = new Set<string>();
  private readonly terminatedRooms = new Set<string>();

  async createRoom(roomName: string): Promise<{ roomRef: string }> {
    this.createdRooms.add(roomName);
    return { roomRef: roomName };
  }

  async issueParticipantToken(roomRef: string, participantIdentity: string, participantName: string, ttlSeconds: number): Promise<IssuedToken> {
    const token = signLiveKitToken(
      MockVideoProvider.MOCK_API_KEY,
      MockVideoProvider.MOCK_API_SECRET,
      participantIdentity,
      { room: roomRef, roomJoin: true, canPublish: true, canSubscribe: true },
      ttlSeconds,
      participantName
    );
    return { token, serverUrl: MockVideoProvider.MOCK_SERVER_URL, expiresAt: new Date(Date.now() + ttlSeconds * 1000) };
  }

  async terminateRoom(roomRef: string): Promise<void> {
    this.terminatedRooms.add(roomRef);
  }

  /** Test-only introspection. */
  wasTerminated(roomRef: string): boolean {
    return this.terminatedRooms.has(roomRef);
  }
  wasCreated(roomRef: string): boolean {
    return this.createdRooms.has(roomRef);
  }
}

let provider: VideoProvider | null = null;

/** Single choke point for resolving the active video provider. */
export function getVideoProvider(): VideoProvider {
  if (!provider) {
    const { apiKey, apiSecret, url } = env.livekit;
    if (apiKey && apiSecret && url) {
      console.log("[video] provider=livekit");
      provider = new LiveKitVideoProvider(apiKey, apiSecret, url);
    } else {
      console.warn("[video] provider=mock", { hasApiKey: Boolean(apiKey), hasApiSecret: Boolean(apiSecret), hasUrl: Boolean(url) });
      provider = new MockVideoProvider();
    }
  }
  return provider;
}

/**
 * False when a real deployment (env.strictSecrets) has no LiveKit credentials:
 * the mock provider's tokens point at a server that doesn't exist, so issuing
 * them would just open a call that can never connect.
 */
export function videoAvailable(): boolean {
  return !(env.strictSecrets && getVideoProvider() instanceof MockVideoProvider);
}

/** Test-only seam for injecting a fake provider. */
export function setVideoProviderForTests(impl: VideoProvider | null): void {
  provider = impl;
}

/** Deterministic room name for a CoachSession — used as LiveKit's room identifier directly (a Mongo ObjectId is already globally unique, no extra suffix needed). */
export function roomNameForSession(sessionId: string): string {
  return `fitora-session-${sessionId}`;
}
