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
  const { createApp } = await import("../../../server/src/app");
  app = createApp();
  return app;
}

async function ensureMongo(): Promise<void> {
  const { connectMongo } = await import("../../../server/src/db/mongoose");
  mongoConnection ??= connectMongo();
  return mongoConnection;
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
