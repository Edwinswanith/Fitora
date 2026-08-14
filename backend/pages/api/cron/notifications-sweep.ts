import { timingSafeEqual } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { Types } from "mongoose";
import { env } from "../../../../server/src/config/env";
import { connectMongo } from "../../../../server/src/db/mongoose";
import { runSweep } from "../../../../server/src/services/notificationSweep";

let mongoConnection: Promise<void> | null = null;

function ensureMongo(): Promise<void> {
  mongoConnection ??= connectMongo();
  return mongoConnection;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function clampInt(value: string | string[] | undefined, fallback: number, min: number, max: number): number {
  const n = Number(first(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function authorized(header: string | undefined): boolean {
  const secret = process.env.CRON_SECRET ?? env.internalNotifications.sweepSecret;
  const actual = Buffer.from(header ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  if (!authorized(req.headers.authorization)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const cursorValue = first(req.query.cursor);
  const cursor = cursorValue && Types.ObjectId.isValid(cursorValue) ? new Types.ObjectId(cursorValue) : null;
  const limit = clampInt(req.query.limit, env.notification.sweepDefaultLimit, 1, 1000);
  const pages = clampInt(req.query.pages, env.notification.sweepDefaultPages, 1, 50);

  try {
    await ensureMongo();
    const result = await runSweep({ limit, pages, cursor });
    res.status(200).json(result);
  } catch (err) {
    console.error("[cron] notification sweep failed", err);
    res.status(500).json({ error: "notification_sweep_failed" });
  }
}
