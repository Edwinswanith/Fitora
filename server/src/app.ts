import express from "express";
import "express-async-errors";
import cors from "cors";
import { env } from "./config/env";
import coachRouter from "./routes/coach";
import authRouter from "./routes/auth";
import athleteRouter from "./routes/athlete";
import athleteVoiceV2Router from "./routes/athleteVoiceV2";
import guardianRouter from "./routes/guardian";
import notificationsRouter from "./routes/notifications";
import avatarRouter from "./routes/avatar";
import tourRouter from "./routes/tour";
import voiceRouter from "./routes/voice";
import deviceTokensRouter from "./routes/deviceTokens";
import notificationPreferencesRouter from "./routes/notificationPreferences";
import presenceRouter from "./routes/presence";
import internalNotificationsRouter from "./routes/internalNotifications";
import { errorHandler } from "./middleware/errorHandler";

function isSameHostOrigin(origin: string, host: string | undefined): boolean {
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function isAllowedCorsOrigin(origin: string, host: string | undefined, allowedCorsOrigins: Set<string>): boolean {
  if (allowedCorsOrigins.has(origin)) return true;
  if (isSameHostOrigin(origin, host)) return true;
  if (env.nodeEnv !== "production" && /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/i.test(origin)) return true;

  return false;
}

export function createApp(): express.Express {
  const app = express();
  const allowedCorsOrigins = new Set(env.corsOrigins);

  app.use(
    cors((req, callback) => {
      callback(null, {
        credentials: true,
        origin(origin, originCallback) {
          if (!origin) {
            originCallback(null, true);
            return;
          }
          if (isAllowedCorsOrigin(origin, req.headers.host, allowedCorsOrigins)) {
            originCallback(null, true);
            return;
          }
          originCallback(new Error(`CORS origin not allowed: ${origin}`));
        },
      });
    })
  );
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    next();
  });
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", env: env.nodeEnv });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/coach", coachRouter);
  app.use("/api/athlete", athleteRouter);
  // V2 voice assistant pipeline — additive, mounted separately so V1's
  // /api/athlete/voice/interpret (inside athleteRouter) stays untouched
  // while the mobile client's feature flag decides which it calls (plan §13).
  app.use("/api/athlete/voice", athleteVoiceV2Router);
  app.use("/api/guardian", guardianRouter);
  app.use("/api/notifications", notificationsRouter);
  app.use("/api/device-tokens", deviceTokensRouter);
  app.use("/api/notification-preferences", notificationPreferencesRouter);
  app.use("/api/presence", presenceRouter);
  app.use("/api/me", avatarRouter);
  app.use("/api/tour", tourRouter);
  app.use("/api/voice", voiceRouter);

  // Same router mounted under /api for Vercel's catch-all API proxy and outside
  // /api for standalone Express deployments.
  app.use("/api/internal/notifications", internalNotificationsRouter);
  app.use("/internal/notifications", internalNotificationsRouter);

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  app.use(errorHandler);
  return app;
}
