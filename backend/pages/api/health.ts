import type { NextApiRequest, NextApiResponse } from "next";

export default function handler(_req: NextApiRequest, res: NextApiResponse): void {
  res.status(200).json({
    status: "ok",
    env: process.env.NODE_ENV ?? "development",
    checks: {
      mongodbUri: Boolean(process.env.MONGODB_URI),
      mongodbDb: Boolean(process.env.MONGODB_DB),
      authSecret: Boolean(process.env.AUTH_SECRET || process.env.JWT_ACCESS_SECRET),
      googleClientId: Boolean(process.env.GOOGLE_CLIENT_ID),
      appleClientId: Boolean(process.env.APPLE_CLIENT_ID),
    },
  });
}
