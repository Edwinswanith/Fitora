import type { Request, Response, NextFunction } from "express";
import { Types } from "mongoose";
import { verifyAccessToken } from "../lib/tokens";
import { User } from "../models/User";

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;

  for (const part of header.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName === name) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}

function readBearerToken(req: Request): string | null {
  const header = req.header("authorization");
  if (header && header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  return readCookie(req, "accessToken");
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = readBearerToken(req);
    if (!token) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const { sub, role } = verifyAccessToken(token);
    if (!Types.ObjectId.isValid(sub)) {
      res.status(401).json({ error: "invalid_token" });
      return;
    }
    // Also pull the two scope fields here so loadScope doesn't need a second
    // User read on every coach/athlete/guardian request (one round-trip, not two).
    const user = await User.findById(sub)
      .select("_id role isActive academyId isAcademyOwner")
      .lean();
    if (!user || !user.isActive) {
      res.status(401).json({ error: "user_inactive" });
      return;
    }
    if (user.role !== role) {
      res.status(401).json({ error: "role_mismatch" });
      return;
    }
    req.actor = {
      userId: user._id,
      role: user.role,
      academyId: (user.academyId as Types.ObjectId | undefined) ?? null,
      isAcademyOwner: Boolean(user.isAcademyOwner),
    };
    next();
  } catch {
    res.status(401).json({ error: "invalid_token" });
  }
}
