import mongoose from "mongoose";
import { env } from "../config/env";

let retryTimer: NodeJS.Timeout | null = null;

/**
 * Mongoose builds each model's indexes in the background as soon as it's
 * compiled — `mongoose.connect()` resolving does NOT mean every unique/
 * partial index (e.g. the one-primary-coach-at-a-time constraint on
 * CoachAthleteAssignment) actually exists yet. Awaiting `Model.init()` for
 * every currently-registered model closes that startup race: the server
 * never accepts a request before its indexes are real. Safe to call
 * repeatedly — index creation is idempotent (a no-op once already built).
 */
async function ensureIndexesReady(): Promise<void> {
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
}

export type ConnectMongoOptions = {
  /**
   * Default true: block until ensureIndexesReady() resolves (see its doc
   * comment above) — the right choice for the standalone Cloud Run server
   * and one-off scripts, where this cost is paid once per container/process
   * lifetime, not per request.
   *
   * Pass false for the Vercel serverless entry point specifically: measured
   * in production, this step was 6.6s of a 9.1s cold start (50 models, each
   * needing an index-confirmation round trip to Atlas) — a cost repeated on
   * every fresh serverless container, almost always just re-confirming
   * indexes that already exist. Indexes still build automatically the
   * moment the connection opens either way (Mongoose's autoIndex, unrelated
   * to this explicit wait) — this only controls whether the response
   * blocks on *confirming* that. The narrow trade-off: for a brief window
   * right after a deploy that adds/changes an index, a request could
   * theoretically race ahead of it — mitigated by running
   * scripts/verify-indexes.ts once after such a deploy.
   */
  waitForIndexes?: boolean;
};

async function attemptConnect(waitForIndexes: boolean): Promise<boolean> {
  try {
    const connectStartedAt = Date.now();
    await mongoose.connect(env.mongoUri, { dbName: env.mongoDb, serverSelectionTimeoutMS: 3000 });
    console.log(`[coldstart] mongoose.connect (TLS + auth handshake): ${Date.now() - connectStartedAt}ms`);

    const indexStartedAt = Date.now();
    const indexesReady = ensureIndexesReady().then(() => {
      console.log(`[coldstart] ensureIndexesReady (${Object.keys(mongoose.models).length} models): ${Date.now() - indexStartedAt}ms`);
    });
    if (waitForIndexes) {
      await indexesReady;
    } else {
      indexesReady.catch((err) => console.warn(`[mongo] background index verification failed: ${(err as Error).message}`));
    }

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
export async function connectMongo(options: ConnectMongoOptions = {}): Promise<void> {
  const waitForIndexes = options.waitForIndexes ?? true;
  mongoose.set("strictQuery", true);

  const ok = await attemptConnect(waitForIndexes);
  if (ok) return;

  if (env.nodeEnv === "production") {
    throw new Error("Failed to connect to MongoDB in production");
  }

  console.warn(
    "[mongo] running without database. Routes that read/write Mongo will fail until connection is restored."
  );
  scheduleRetry(waitForIndexes);
}

function scheduleRetry(waitForIndexes: boolean): void {
  if (retryTimer) return;
  retryTimer = setInterval(async () => {
    if (mongoose.connection.readyState === 1) {
      if (retryTimer) clearInterval(retryTimer);
      retryTimer = null;
      return;
    }
    const ok = await attemptConnect(waitForIndexes);
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
