import mongoose from "mongoose";
import { env } from "../config/env";

let retryTimer: NodeJS.Timeout | null = null;

async function attemptConnect(): Promise<boolean> {
  try {
    await mongoose.connect(env.mongoUri, { dbName: env.mongoDb, serverSelectionTimeoutMS: 3000 });
    console.log(`[mongo] connected: ${env.mongoUri.replace(/\/\/[^@]+@/, "//***@")}`);
    return true;
  } catch (err) {
    const msg = (err as Error).message;
    console.warn(`[mongo] connection failed: ${msg}`);
    return false;
  }
}

/**
 * Connect to MongoDB. In development, failure is non-fatal: the server keeps
 * running so `/api/health` and the test harness work, and we retry in the
 * background. In production we throw.
 */
export async function connectMongo(): Promise<void> {
  mongoose.set("strictQuery", true);

  const ok = await attemptConnect();
  if (ok) return;

  if (env.nodeEnv === "production") {
    throw new Error("Failed to connect to MongoDB in production");
  }

  console.warn(
    "[mongo] running without database. Routes that read/write Mongo will fail until connection is restored."
  );
  scheduleRetry();
}

function scheduleRetry(): void {
  if (retryTimer) return;
  retryTimer = setInterval(async () => {
    if (mongoose.connection.readyState === 1) {
      if (retryTimer) clearInterval(retryTimer);
      retryTimer = null;
      return;
    }
    const ok = await attemptConnect();
    if (ok && retryTimer) {
      clearInterval(retryTimer);
      retryTimer = null;
    }
  }, 10000);
  // Allow process to exit even if the timer is active (e.g. tests).
  retryTimer.unref?.();
}

export async function disconnectMongo(): Promise<void> {
  if (retryTimer) {
    clearInterval(retryTimer);
    retryTimer = null;
  }
  await mongoose.disconnect();
}
