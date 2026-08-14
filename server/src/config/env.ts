import dotenv from "dotenv";
import os from "os";
import path from "path";

// Prefer the server package env file even when the process is launched from the
// monorepo root. dotenv does not override existing vars, so CI/prod env still
// wins when variables are already provided by the host.
dotenv.config({ path: path.resolve(/* turbopackIgnore: true */ __dirname, "../../.env") });
dotenv.config({ path: path.resolve(/* turbopackIgnore: true */ process.cwd(), ".env") });

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

const nodeEnv = process.env.NODE_ENV ?? "development";
const isProduction = nodeEnv === "production";

const mongoUri = required(
  "MONGODB_URI",
  isProduction ? undefined : "mongodb://localhost:27017/sports_coaching"
);
const mongoDb = process.env.MONGODB_DB?.trim() || undefined;

/**
 * A remote DB (Atlas `mongodb+srv://` or any non-localhost host) almost always
 * means real data. Placeholder JWT secrets must never guard real data — a known
 * signing key lets anyone forge tokens — so we treat secrets strictly whenever
 * the DB is remote, not only when NODE_ENV=production.
 */
function isRemoteMongo(uri: string): boolean {
  if (/^mongodb\+srv:\/\//i.test(uri)) return true;
  const host = uri.replace(/^mongodb:\/\//i, "").split("/")[0] ?? "";
  return !/(^|@|,)(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|$)/i.test(host) && host !== "";
}

const strictSecrets = isProduction || isRemoteMongo(mongoUri);
const defaultUploadDir = process.env.VERCEL === "1" ? path.join(os.tmpdir(), "uploads") : "uploads";

function requiredSecretFrom(names: string[], fallback: string): string {
  const value =
    names.map((name) => process.env[name]).find((candidate): candidate is string => Boolean(candidate)) ??
    process.env.AUTH_SECRET ??
    (strictSecrets ? undefined : fallback);
  if (strictSecrets && (!value || value === fallback)) {
    const label = names.join(" or ");
    throw new Error(
      `Refusing to start: ${label} is missing or set to the placeholder value ` +
        `while pointing at a production/remote database. Set a strong unique secret.`
    );
  }
  if (!value) {
    throw new Error(`Missing required env var: ${names.join(" or ")}`);
  }
  return value;
}

function requiredSecret(name: string, fallback: string): string {
  return requiredSecretFrom([name], fallback);
}

function csv(name: string, fallback: string): string[] {
  return (process.env[name] ?? fallback)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function minuteOfDay(name: string, fallback: string): number {
  const raw = process.env[name] ?? fallback;
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!match) {
    throw new Error(`Invalid ${name}: expected HH:mm, got "${raw}"`);
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Invalid ${name}: expected HH:mm, got "${raw}"`);
  }
  return hour * 60 + minute;
}

export const env = {
  nodeEnv,
  port: Number(process.env.PORT ?? 4000),
  mongoUri,
  mongoDb,
  corsOrigins: csv("CORS_ORIGIN", "http://localhost:3000,http://localhost:8081"),
  // Google OAuth client ID(s) for "Sign in with Google". Empty = feature disabled.
  // May be a comma-separated list to accept tokens from multiple native/mobile
  // clients whose ID tokens carry that client as the audience.
  googleClientId: (process.env.GOOGLE_CLIENT_ID ?? "").split(",")[0]?.trim() ?? "",
  googleClientIds: (process.env.GOOGLE_CLIENT_ID ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  // Native Sign in with Apple tokens use the iOS bundle identifier as audience.
  // Override/extend with APPLE_CLIENT_ID when supporting more Apple clients.
  appleClientIds: csv("APPLE_CLIENT_ID", "app.apex.coaching"),
  jwt: {
    accessSecret: requiredSecret("JWT_ACCESS_SECRET", "change_me_access"),
    refreshSecret: requiredSecret("JWT_REFRESH_SECRET", "change_me_refresh"),
    accessTtl: process.env.JWT_ACCESS_TTL ?? "15m",
    refreshTtl: process.env.JWT_REFRESH_TTL ?? "30d",
  },
  // Coach-uploaded media (athlete/workout/training-plan images). Stored on local
  // disk, outside any statically-served directory — every read goes through an
  // authenticated, ownership-checked route (see routes/coach.ts, routes/athlete.ts).
  upload: {
    dir: path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.UPLOAD_DIR ?? defaultUploadDir),
    maxSizeBytes: Number(process.env.MAX_UPLOAD_SIZE_MB ?? 8) * 1024 * 1024,
  },
  // Vision engine for turning a coach's workout image into a structured table.
  // When GEMINI_API_KEY is set, the real Gemini converter reads the actual image
  // and returns only the workout rows; otherwise a placeholder mock is used (see
  // services/workoutImageConverter.ts). GEMINI_MODEL overrides the default model.
  gemini: {
    apiKey: process.env.GEMINI_API_KEY ?? "",
    model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
  },
  // Push delivery (Firebase Cloud Messaging, HTTP v1). Empty values keep push
  // in no-op mode, while in-app notifications and decision rows still work.
  fcm: {
    projectId: process.env.FCM_PROJECT_ID ?? "",
    serviceAccountJson: process.env.FCM_SERVICE_ACCOUNT_JSON ?? "",
  },
  internalNotifications: {
    sweepSecret: requiredSecretFrom(["INTERNAL_SWEEP_SECRET", "CRON_SECRET"], "change_me_sweep_secret"),
  },
  notification: {
    sweepDefaultLimit: Number(process.env.NOTIFICATION_SWEEP_DEFAULT_LIMIT ?? 200),
    sweepDefaultPages: Number(process.env.NOTIFICATION_SWEEP_DEFAULT_PAGES ?? 5),
    dailyCap: Number(process.env.NOTIFICATION_DAILY_CAP ?? 6),
    minIntervalMinutes: Number(process.env.NOTIFICATION_MIN_INTERVAL_MINUTES ?? 60),
    quietHoursDefaultStartMinute: minuteOfDay("NOTIFICATION_QUIET_HOURS_DEFAULT_START", "22:00"),
    quietHoursDefaultEndMinute: minuteOfDay("NOTIFICATION_QUIET_HOURS_DEFAULT_END", "07:00"),
    presenceSuppressWindowMin: Number(process.env.NOTIFICATION_PRESENCE_SUPPRESS_WINDOW_MIN ?? 10),
    dailyCheckinReminderMinute: minuteOfDay("DAILY_CHECKIN_REMINDER_LOCAL_TIME", "20:00"),
    trainingSessionReminderAmMinute: minuteOfDay("TRAINING_SESSION_REMINDER_AM_TIME", "07:00"),
    trainingSessionReminderAftMinute: minuteOfDay("TRAINING_SESSION_REMINDER_AFT_TIME", "12:00"),
    trainingSessionReminderPmMinute: minuteOfDay("TRAINING_SESSION_REMINDER_PM_TIME", "16:00"),
    rpeMonitoringReminderAmMinute: minuteOfDay("RPE_MONITORING_REMINDER_AM_TIME", "07:00"),
    rpeMonitoringReminderAftMinute: minuteOfDay("RPE_MONITORING_REMINDER_AFT_TIME", "12:00"),
    rpeMonitoringReminderPmMinute: minuteOfDay("RPE_MONITORING_REMINDER_PM_TIME", "16:00"),
    hydrationReminderMinute: minuteOfDay("HYDRATION_REMINDER_LOCAL_TIME", "14:00"),
    missedActivityReminderMinute: minuteOfDay("MISSED_ACTIVITY_REMINDER_LOCAL_TIME", "08:00"),
    noteNeedsReplyHours: Number(process.env.NOTE_NEEDS_REPLY_HOURS ?? 24),
    weeklySummaryMinute: minuteOfDay("WEEKLY_SUMMARY_LOCAL_TIME", "09:00"),
    squadDigestMinute: minuteOfDay("SQUAD_DIGEST_LOCAL_TIME", "09:00"),
  },
  deepgram: {
    apiKey: process.env.DEEP_GRAM ?? process.env.DEEPGRAM_API_KEY ?? "",
    sttModel: process.env.DEEPGRAM_STT_MODEL ?? "flux-general-multi",
    ttsModel: process.env.DEEPGRAM_TTS_MODEL ?? "aura-2-thalia-en",
    streamEndpointingMs: Number(process.env.DEEPGRAM_STREAM_ENDPOINTING_MS ?? 400),
    streamUtteranceEndMs: Number(process.env.DEEPGRAM_STREAM_UTTERANCE_END_MS ?? 1000),
  },
  // V2 voice assistant pipeline (voiceIntentPolicy.ts, VoicePendingState,
  // VoiceActionReceipt). Additive/inert unless the V2 routes are called —
  // see EXPO_PUBLIC_VOICE_ASSISTANT_V2 on the mobile client for the flag
  // that gates whether they ever are.
  voiceAssistant: {
    // Server-persisted pending-workflow TTL — upper bound of the requested
    // 10-15 minute window (plan §8.1). A stale in-progress voice command is
    // simply gone, never lingering past its purpose.
    pendingStateTtlSeconds: Number(process.env.VOICE_PENDING_STATE_TTL_SECONDS ?? 900),
    // Idempotency-receipt retention for clientActionId dedup (plan §6) — long
    // enough to dedupe retries/double-taps, short enough not to be a durable
    // audit log substitute.
    actionReceiptTtlSeconds: Number(process.env.VOICE_ACTION_RECEIPT_TTL_SECONDS ?? 86400),
  },
};
