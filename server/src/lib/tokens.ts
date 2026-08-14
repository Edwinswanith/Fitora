import jwt, { type SignOptions } from "jsonwebtoken";
import { randomBytes, createHash, timingSafeEqual } from "crypto";
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

/**
 * Refresh tokens are stored hashed (never plaintext), but NOT via bcrypt:
 * bcrypt silently truncates its input at 72 bytes, and every refresh JWT for
 * the same user shares an identical header + `sub`-prefixed payload well
 * past that cutoff — the only bytes that differ between successive tokens
 * (jti/iat/exp) land AFTER byte 72. That made bcrypt.compare(oldToken,
 * newHash) return true for ANY previously-issued token, silently defeating
 * rotation-based invalidation entirely. A refresh token is already a
 * high-entropy random value (unlike a human password), so it doesn't need
 * bcrypt's slow/salted hashing — a fixed-length SHA-256 digest compared in
 * constant time is the correct, standard approach for opaque tokens like
 * this, and it has no truncation limit.
 */
export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function refreshTokenMatches(token: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashRefreshToken(token), "hex");
  const stored = Buffer.from(storedHash, "hex");
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}
