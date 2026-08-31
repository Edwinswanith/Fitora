import type { NextApiRequest, NextApiResponse } from "next";

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
    responseLimit: false,
  },
};

type ExpressApp = import("express").Express;

let app: ExpressApp | null = null;
let mongoConnection: Promise<void> | null = null;

function startupErrorDetails(err: unknown): { name: string; message: string } {
  const error = err instanceof Error ? err : new Error(String(err));
  return {
    name: error.name,
    message: error.message
      .replace(/mongodb(\+srv)?:\/\/[^@]+@/gi, "mongodb$1://***@")
      .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer ***"),
  };
}

async function ensureApp(): Promise<ExpressApp> {
  if (app) return app;
  const startedAt = Date.now();
  const { createApp } = await import("../../../server/src/app");
  app = createApp();
  console.log(`[coldstart] app import + createApp: ${Date.now() - startedAt}ms`);
  return app;
}

async function ensureMongo(): Promise<void> {
  // Only the FIRST cold-start invocation on a fresh container logs this —
  // every warm invocation after it hits the `mongoConnection ??=` short
  // circuit below and skips straight to expressApp(req, res), so this timing
  // never runs on the hot path.
  const isColdStart = mongoConnection === null;
  const startedAt = Date.now();
  const { connectMongo } = await import("../../../server/src/db/mongoose");
  // waitForIndexes: false — measured at 6.6s of a 9.1s cold start (50 models,
  // each needing an index-confirmation round trip to Atlas), almost always
  // just re-confirming indexes that already exist. See connectMongo's doc
  // comment for the full trade-off; scripts/verify-indexes.ts is the
  // deliberate, manual check to run once after a deploy that changes a schema.
  mongoConnection ??= connectMongo({ waitForIndexes: false });
  await mongoConnection;
  if (isColdStart) console.log(`[coldstart] mongo connect (not waiting on index verification): ${Date.now() - startedAt}ms`);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  let expressApp: ExpressApp;
  try {
    expressApp = await ensureApp();
  } catch (err) {
    console.error("[api] app startup failed", err);
    res.status(500).json({ error: "api_startup_failed", stage: "app", details: startupErrorDetails(err) });
    return;
  }
  try {
    await ensureMongo();
  } catch (err) {
    console.error("[api] mongo startup failed", err);
    res.status(500).json({ error: "api_startup_failed", stage: "mongo", details: startupErrorDetails(err) });
    return;
  }
  expressApp(req, res);
}
