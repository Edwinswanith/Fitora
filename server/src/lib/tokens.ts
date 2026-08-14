import jwt, { type SignOptions } from "jsonwebtoken";
import { randomBytes } from "crypto";
import { env } from "../config/env";
import type { UserRole } from "../models/User";

export type AccessTokenPayload = {
  sub: string;
  role: UserRole;
};

export type RefreshTokenPayload = {
  sub: string;
  jti?: string;
};

export function signAccessToken(payload: AccessTokenPayload): string {
  const options: SignOptions = { expiresIn: env.jwt.accessTtl as SignOptions["expiresIn"] };
  return jwt.sign(payload, env.jwt.accessSecret, options);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, env.jwt.accessSecret);
  if (typeof decoded === "string") {
    throw new Error("Invalid token payload");
  }
  const { sub, role } = decoded as jwt.JwtPayload & Partial<AccessTokenPayload>;
  if (!sub || !role) {
    throw new Error("Invalid token payload");
  }
  return { sub, role };
}

export function signRefreshToken(payload: RefreshTokenPayload): string {
  const options: SignOptions = { expiresIn: env.jwt.refreshTtl as SignOptions["expiresIn"] };
  return jwt.sign(
    { ...payload, jti: payload.jti ?? randomBytes(16).toString("hex") },
    env.jwt.refreshSecret,
    options
  );
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const decoded = jwt.verify(token, env.jwt.refreshSecret);
  if (typeof decoded === "string") {
    throw new Error("Invalid token payload");
  }
  const { sub } = decoded as jwt.JwtPayload & Partial<RefreshTokenPayload>;
  if (!sub) {
    throw new Error("Invalid token payload");
  }
  return { sub };
}
