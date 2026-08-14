import type { Server } from "http";
import type { IncomingMessage } from "http";
import { Types } from "mongoose";
import WebSocket, { WebSocketServer, type RawData } from "ws";
import { env } from "../config/env";
import { verifyAccessToken } from "../lib/tokens";
import { User } from "../models/User";

type VoiceStreamMessage =
  | { type: "interim"; transcript: string }
  | { type: "final"; transcript: string }
  | { type: "utterance_end"; transcript: string }
  | { type: "error"; code: string; message: string };

type DeepgramResults = {
  type?: string;
  transcript?: string;
  channel?: { alternatives?: Array<{ transcript?: string }> };
  is_final?: boolean;
  speech_final?: boolean;
};

const activeStreams = new Map<string, WebSocket>();
const streamHits = new Map<string, { count: number; resetAt: number }>();
const SUPPORTED_LANGUAGE_HINTS = new Set(["en", "hi", "ta", "te", "kn", "ml"]);

function sendJson(socket: WebSocket, message: VoiceStreamMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function closeWithError(socket: WebSocket, code: number, error: string, message: string): void {
  sendJson(socket, { type: "error", code: error, message });
  socket.close(code, error);
}

function tokenFromRequest(req: IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const url = new URL(req.url ?? "", "http://localhost");
  return url.searchParams.get("token");
}

async function authenticate(req: IncomingMessage): Promise<{ userId: string } | null> {
  const token = tokenFromRequest(req);
  if (!token) return null;
  const payload = verifyAccessToken(token);
  if (!Types.ObjectId.isValid(payload.sub)) return null;
  const user = await User.findById(payload.sub).select("_id role isActive").lean();
  if (!user || !user.isActive || user.role !== payload.role) return null;
  return { userId: user._id.toString() };
}

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const current = streamHits.get(userId);
  if (!current || current.resetAt <= now) {
    streamHits.set(userId, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  current.count += 1;
  return current.count > 30;
}

function languageFromRequest(req: IncomingMessage): string {
  const url = new URL(req.url ?? "", "http://localhost");
  const language = url.searchParams.get("language") ?? "en";
  return SUPPORTED_LANGUAGE_HINTS.has(language) ? language : "en";
}

function deepgramUrl(language: string): string {
  const isFlux = env.deepgram.sttModel.startsWith("flux-");
  const params = new URLSearchParams({
    model: env.deepgram.sttModel,
    encoding: "linear16",
    sample_rate: "16000",
  });
  if (isFlux) {
    params.set("eot_timeout_ms", String(env.deepgram.streamUtteranceEndMs));
    if (env.deepgram.sttModel === "flux-general-multi") params.append("language_hint", language);
    return `wss://api.deepgram.com/v2/listen?${params.toString()}`;
  }
  params.set("channels", "1");
  params.set("interim_results", "true");
  params.set("endpointing", String(env.deepgram.streamEndpointingMs));
  params.set("utterance_end_ms", String(env.deepgram.streamUtteranceEndMs));
  params.set("vad_events", "true");
  params.set("smart_format", "true");
  params.set("language", language);
  return `wss://api.deepgram.com/v1/listen?${params.toString()}`;
}

function parseDeepgramMessage(data: RawData): DeepgramResults | null {
  try {
    const text = Buffer.isBuffer(data) ? data.toString("utf8") : data.toString();
    return JSON.parse(text) as DeepgramResults;
  } catch {
    return null;
  }
}

function rawDataToBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (Array.isArray(data)) return Buffer.concat(data.map((chunk) => Buffer.from(chunk)));
  return Buffer.from(data);
}

export function attachVoiceStreamProxy(server: Server): void {
  const wss = new WebSocketServer({ server, path: "/api/voice/stream" });

  wss.on("connection", (client, req) => {
    let upstream: WebSocket | null = null;
    let userId: string | null = null;
    let closed = false;
    let lastFinalTranscript = "";
    const pendingAudio: Buffer[] = [];
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let maxTimer: ReturnType<typeof setTimeout> | null = null;
    let transcriptTimer: ReturnType<typeof setTimeout> | null = null;

    function cleanup() {
      if (closed) return;
      closed = true;
      if (idleTimer) clearTimeout(idleTimer);
      if (maxTimer) clearTimeout(maxTimer);
      if (transcriptTimer) clearTimeout(transcriptTimer);
      idleTimer = null;
      maxTimer = null;
      transcriptTimer = null;
      if (userId && activeStreams.get(userId) === client) activeStreams.delete(userId);
      if (upstream?.readyState === WebSocket.OPEN) upstream.send(JSON.stringify({ type: "CloseStream" }));
      upstream?.close();
      upstream = null;
    }

    function resetIdleTimer() {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        closeWithError(client, 4408, "stream_idle_timeout", "Voice stream timed out.");
        cleanup();
      }, 30_000);
    }

    function scheduleTranscriptEndpoint() {
      if (!lastFinalTranscript) return;
      if (transcriptTimer) clearTimeout(transcriptTimer);
      transcriptTimer = setTimeout(() => {
        if (lastFinalTranscript) sendJson(client, { type: "utterance_end", transcript: lastFinalTranscript });
      }, Math.max(250, env.deepgram.streamEndpointingMs));
    }

    void (async () => {
      if (!env.deepgram.apiKey) {
        closeWithError(client, 1011, "deepgram_not_configured", "Voice streaming is not configured.");
        cleanup();
        return;
      }

      const auth = await authenticate(req).catch(() => null);
      if (!auth) {
        closeWithError(client, 4401, "unauthenticated", "Sign in again to use voice commands.");
        cleanup();
        return;
      }
      userId = auth.userId;
      if (isRateLimited(userId)) {
        closeWithError(client, 4429, "too_many_streams", "Too many voice sessions. Try again shortly.");
        cleanup();
        return;
      }
      if (activeStreams.has(userId)) {
        closeWithError(client, 4429, "stream_already_active", "Another voice session is already active.");
        cleanup();
        return;
      }
      activeStreams.set(userId, client);

      upstream = new WebSocket(deepgramUrl(languageFromRequest(req)), {
        headers: { Authorization: `Token ${env.deepgram.apiKey}` },
      });
      resetIdleTimer();
      maxTimer = setTimeout(() => {
        closeWithError(client, 4408, "stream_max_duration", "Voice stream ended.");
        cleanup();
      }, 30_000);

      upstream.on("open", () => {
        while (pendingAudio.length > 0 && upstream?.readyState === WebSocket.OPEN) {
          upstream.send(pendingAudio.shift() as Buffer);
        }
      });
      upstream.on("message", (data) => {
        const event = parseDeepgramMessage(data);
        if (!event) return;
        if (event.type === "Error") {
          closeWithError(client, 1011, "deepgram_error", "Voice transcription failed.");
          cleanup();
          return;
        }
        if (event.type === "UtteranceEnd" || event.type === "EndOfTurn") {
          sendJson(client, { type: "utterance_end", transcript: lastFinalTranscript });
          return;
        }
        if (event.transcript?.trim()) {
          const transcript = event.transcript.trim();
          lastFinalTranscript = transcript;
          sendJson(client, { type: "interim", transcript });
          scheduleTranscriptEndpoint();
          return;
        }
        if (event.type !== "Results") return;
        const transcript = event.channel?.alternatives?.[0]?.transcript?.trim() ?? "";
        if (!transcript) return;
        if (event.is_final) {
          lastFinalTranscript = transcript;
          sendJson(client, { type: "final", transcript });
          if (event.speech_final) sendJson(client, { type: "utterance_end", transcript });
        } else {
          sendJson(client, { type: "interim", transcript });
        }
      });

      upstream.on("error", () => {
        closeWithError(client, 1011, "deepgram_unavailable", "Voice transcription is temporarily unavailable.");
        cleanup();
      });
      upstream.on("close", () => {
        if (client.readyState === WebSocket.OPEN) client.close();
        cleanup();
      });
    })();

    client.on("message", (data, isBinary) => {
      resetIdleTimer();
      if (!isBinary) {
        const text = data.toString();
        if (text.includes("CloseStream")) {
          upstream?.send(JSON.stringify({ type: "CloseStream" }));
          return;
        }
      }
      if (!isBinary) return;
      if (upstream?.readyState === WebSocket.OPEN) {
        upstream.send(data);
        return;
      }
      if (pendingAudio.length < 64) pendingAudio.push(rawDataToBuffer(data));
    });
    client.on("close", cleanup);
    client.on("error", cleanup);
  });
}
