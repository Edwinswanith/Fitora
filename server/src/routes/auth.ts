import { Router, type Request, type Response } from "express";
import { Types } from "mongoose";
import { createPublicKey, randomBytes, type JsonWebKey as NodeJsonWebKey } from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User, type UserDoc } from "../models/User";
import { AthleteProfile } from "../models/AthleteProfile";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../lib/tokens";
import { env } from "../config/env";
import { requireAuth } from "../middleware/auth";
import { avatarSummary } from "../services/avatar";
import { permanentlyDeleteAccount } from "../services/accountDeletion";

const router = Router();

/**
 * The iOS app's real, permanent bundle identifier (mobile/app.json's
 * ios.bundleIdentifier). A native Sign in with Apple identity token's `aud`
 * claim is ALWAYS this bundle ID, never a web "Services ID" — so this must
 * be an unconditionally accepted audience regardless of how APPLE_CLIENT_ID
 * happens to be configured in any given environment. A misconfigured or
 * web-Services-ID-only APPLE_CLIENT_ID must never be able to lock out the
 * native app.
 *
 * No web "Sign in with Apple" flow exists anywhere in this codebase (no
 * appleid.apple.com/auth/authorize usage, no redirect_uri handling, no
 * AppleID JS SDK) — confirmed by search, not assumed. There is therefore no
 * separate Services ID to add here; inventing one would be exactly the kind
 * of loose acceptance this allowlist exists to prevent.
 */
const APPLE_NATIVE_BUNDLE_ID = "app.apex.coaching";

/**
 * Explicit allowlist of audiences an Apple identity token's `aud` claim may
 * equal. Built once per process: the real native bundle ID, plus whatever
 * (if anything) is configured via APPLE_CLIENT_ID for additional Apple
 * client audiences (e.g. a future web Services ID) — never anything else,
 * never a pattern/prefix/suffix match. Exported for direct unit testing.
 */
export function appleAllowedAudiences(): [string, ...string[]] {
  const additional = env.appleClientIds.filter((id) => id !== APPLE_NATIVE_BUNDLE_ID);
  return [APPLE_NATIVE_BUNDLE_ID, ...additional];
}

/** True only for an exact string match against the allowlist — no substring, prefix, or suffix matching. */
function isAllowedAppleAudience(aud: unknown, allowed: readonly string[]): boolean {
  if (typeof aud === "string") return allowed.includes(aud);
  if (Array.isArray(aud)) return aud.some((a) => typeof a === "string" && allowed.includes(a));
  return false;
}

/**
 * `fetch` has no built-in timeout. This is a real reliability defect
 * regardless of any specific incident: an unbounded call to an external
 * service (Apple's/Google's key-verification endpoints) can run arbitrarily
 * long on a cold serverless invocation. Whether this was THE cause of any
 * particular App Review failure is unproven (no request logs from that
 * session exist to confirm it) — but a bounded, fail-fast timeout that
 * always leaves time to return a real, specific JSON error is correct
 * regardless, so it stays.
 */
async function fetchWithTimeout(url: string, timeoutMs = 6000): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Never log full tokens/secrets — only enough shape to diagnose where a flow failed. */
function logAuthEvent(event: string, fields: Record<string, unknown> = {}): void {
  console.log(`[auth] ${event}`, fields);
}

const ACCESS_COOKIE = "accessToken";
const REFRESH_COOKIE = "refreshToken";
const LOGIN_WINDOW_MS = 60_000;
const LOGIN_MAX_ATTEMPTS = 5;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

/** Test helper: clear the in-memory login rate-limit state between tests. */
export function __resetLoginRateLimit(): void {
  loginAttempts.clear();
}

function readCookie(req: Request, cookieName: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === cookieName) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}

// In production the web app and API can live on different domains (e.g. separate
// Cloud Run URLs), so auth cookies must be sent on cross-site requests — that
// requires SameSite=None, which browsers only honour together with Secure. In
// dev we stay on Lax: SameSite=None without Secure is rejected over http://localhost.
const COOKIE_SAME_SITE = env.nodeEnv === "production" ? "None" : "Lax";

function cookieParts(cookieName: string, value: string, path: string): string[] {
  const parts: string[] = [
    `${cookieName}=${encodeURIComponent(value)}`,
    `Path=${path}`,
    "HttpOnly",
    `SameSite=${COOKIE_SAME_SITE}`,
  ];
  if (env.nodeEnv === "production") parts.push("Secure");
  return parts;
}

function setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
  res.setHeader("Set-Cookie", [
    cookieParts(ACCESS_COOKIE, accessToken, "/").join("; "),
    cookieParts(REFRESH_COOKIE, refreshToken, "/api/auth").join("; "),
  ]);
}

function clearAuthCookies(res: Response): void {
  const accessParts: string[] = [
    `${ACCESS_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    `SameSite=${COOKIE_SAME_SITE}`,
    "Max-Age=0",
  ];
  const refreshParts: string[] = [
    `${REFRESH_COOKIE}=`,
    "Path=/api/auth",
    "HttpOnly",
    `SameSite=${COOKIE_SAME_SITE}`,
    "Max-Age=0",
  ];
  if (env.nodeEnv === "production") {
    accessParts.push("Secure");
    refreshParts.push("Secure");
  }
  res.setHeader("Set-Cookie", [accessParts.join("; "), refreshParts.join("; ")]);
}

function safeUser(user: UserDoc) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    academyId: user.academyId
      ? (user.academyId as Types.ObjectId).toString()
      : null,
    isAcademyOwner: Boolean(user.isAcademyOwner),
    mustChangePassword: Boolean(user.mustChangePassword),
    avatar: avatarSummary(user),
  };
}

function wantsNativeTokens(req: Request): boolean {
  return (
    req.header("x-client-type")?.toLowerCase() === "native" ||
    req.body?.client === "native"
  );
}

async function issueTokensForUser(
  user: UserDoc,
  res: Response
): Promise<{ accessToken: string; refreshToken: string }> {
  const accessToken = signAccessToken({
    sub: user._id.toString(),
    role: user.role,
  });
  const refreshToken = signRefreshToken({ sub: user._id.toString() });
  const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
  await User.updateOne({ _id: user._id }, { $set: { refreshTokenHash } });
  setAuthCookies(res, accessToken, refreshToken);
  return { accessToken, refreshToken };
}

function authResponsePayload(
  req: Request,
  tokens: { accessToken: string; refreshToken: string },
  user: UserDoc
) {
  return {
    accessToken: tokens.accessToken,
    ...(wantsNativeTokens(req) ? { refreshToken: tokens.refreshToken } : {}),
    user: safeUser(user),
  };
}

function readRefreshToken(req: Request): string | null {
  return (
    readCookie(req, REFRESH_COOKIE) ||
    (typeof req.body?.refreshToken === "string" ? req.body.refreshToken : null)
  );
}

function checkLoginRateLimit(req: Request): boolean {
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const current = loginAttempts.get(key);

  if (!current || current.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return true;
  }
  if (current.count >= LOGIN_MAX_ATTEMPTS) {
    return false;
  }

  current.count += 1;
  return true;
}

type SocialSignupRole = "athlete" | "coach";

function requestedSelfSignupRole(requestedRole: unknown): SocialSignupRole | null {
  const normalized =
    typeof requestedRole === "string" ? requestedRole.trim().toLowerCase() : undefined;
  if (normalized === undefined || normalized === "athlete") return "athlete";
  if (normalized === "coach") return "coach";
  return null;
}

async function findOrCreateSocialUser(input: {
  email: string;
  name?: string;
  requestedRole: unknown;
  appleSubject?: string;
}): Promise<{ user: UserDoc | null; error?: { status: number; code: string } }> {
  const email = input.email.trim().toLowerCase();
  let user = input.appleSubject
    ? await User.findOne({ appleSubject: input.appleSubject })
    : null;
  if (!user) user = await User.findOne({ email });

  if (user && !user.isActive) {
    return { user: null, error: { status: 403, code: "account_disabled" } };
  }

  if (!user) {
    const signupRole = requestedSelfSignupRole(input.requestedRole);
    if (!signupRole) {
      return { user: null, error: { status: 400, code: "self_signup_role_not_supported" } };
    }

    const displayName =
      typeof input.name === "string" && input.name.trim()
        ? input.name.trim()
        : email.split("@")[0];
    const randomHash = await bcrypt.hash(randomBytes(24).toString("hex"), 10);
    try {
      user = await User.create({
        email,
        passwordHash: randomHash,
        role: signupRole,
        name: displayName,
        isActive: true,
        mustChangePassword: false,
        ...(input.appleSubject ? { appleSubject: input.appleSubject } : {}),
      });
      if (signupRole === "athlete") {
        await AthleteProfile.create({ userId: user._id, sport: "Not set" });
      }
    } catch (err) {
      if (user) await User.deleteOne({ _id: user._id }).catch(() => undefined);
      if ((err as { code?: number }).code === 11000) {
        user = await User.findOne({ email });
      } else {
        throw err;
      }
      if (!user) {
        return { user: null, error: { status: 500, code: "signup_failed" } };
      }
    }
  }

  if (input.appleSubject && !user.appleSubject) {
    user.appleSubject = input.appleSubject;
    await user.save();
  }

  return { user };
}

router.post("/login", async (req: Request, res: Response) => {
  if (!checkLoginRateLimit(req)) {
    logAuthEvent("login.rate_limited");
    res.status(429).json({ error: "too_many_login_attempts" });
    return;
  }

  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  if (!email || !password) {
    logAuthEvent("login.missing_fields", { hasEmail: Boolean(email), hasPassword: Boolean(password) });
    res.status(400).json({ error: "invalid_credentials" });
    return;
  }

  // Never log the email itself (PII) or the password — only whether lookup/compare succeeded.
  const user = await User.findOne({ email });
  if (!user || !user.isActive) {
    logAuthEvent("login.user_not_found_or_inactive");
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    logAuthEvent("login.password_mismatch", { userId: user._id.toString() });
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }
  logAuthEvent("login.success", { userId: user._id.toString() });

  const tokens = await issueTokensForUser(user, res);
  res.json(authResponsePayload(req, tokens, user));
});

/**
 * POST /api/auth/google
 * body: { credential }  — the Google ID token from Google Identity Services.
 *
 * We verify the token with Google, sign in existing users, and provision
 * first-time Google identities as independent athlete or coach accounts based
 * on the selected login role.
 */
type GoogleTokenInfo = {
  aud?: string;
  iss?: string;
  email?: string;
  email_verified?: string | boolean;
  name?: string;
};

router.post("/google", async (req: Request, res: Response) => {
  if (!env.googleClientId) {
    res.status(503).json({ error: "google_signin_unconfigured" });
    return;
  }
  if (!checkLoginRateLimit(req)) {
    res.status(429).json({ error: "too_many_login_attempts" });
    return;
  }

  const credential =
    typeof req.body?.credential === "string" ? req.body.credential : "";
  if (!credential) {
    res.status(400).json({ error: "missing_credential" });
    return;
  }

  // Verify the ID token with Google (checks signature + expiry server-side),
  // then assert the audience/issuer/verification ourselves.
  let info: GoogleTokenInfo;
  try {
    const r = await fetchWithTimeout(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`
    );
    if (!r.ok) {
      logAuthEvent("google.verify_failed", { httpStatus: r.status });
      res.status(401).json({ error: "invalid_google_token" });
      return;
    }
    info = (await r.json()) as GoogleTokenInfo;
  } catch (err) {
    logAuthEvent("google.verify_error", { name: (err as Error).name, message: (err as Error).message });
    res.status(502).json({ error: "google_verification_failed" });
    return;
  }

  const issuerOk =
    info.iss === "accounts.google.com" || info.iss === "https://accounts.google.com";
  const emailVerified = info.email_verified === true || info.email_verified === "true";
  // Accept any configured client as the audience (web/PWA + native Android).
  const audOk = typeof info.aud === "string" && env.googleClientIds.includes(info.aud);
  if (!audOk || !issuerOk || !emailVerified || !info.email) {
    logAuthEvent("google.rejected", { audOk, issuerOk, emailVerified, hasEmail: Boolean(info.email) });
    res.status(401).json({ error: "invalid_google_token" });
    return;
  }

  const { user, error } = await findOrCreateSocialUser({
    email: info.email,
    name: info.name,
    requestedRole: req.body?.requestedRole,
  });
  if (error || !user) {
    logAuthEvent("google.user_resolution_failed", { code: error?.code });
    res.status(error?.status ?? 500).json({ error: error?.code ?? "signup_failed" });
    return;
  }

  logAuthEvent("google.success", { userId: user._id.toString(), newAccount: !error });
  const tokens = await issueTokensForUser(user, res);
  res.json(authResponsePayload(req, tokens, user));
});

type AppleJwk = NodeJsonWebKey & { kid?: string; alg?: string };
type AppleJwks = { keys?: AppleJwk[] };
type AppleTokenPayload = jwt.JwtPayload & {
  sub?: string;
  email?: string;
  email_verified?: string | boolean;
};

let appleJwksCache: { keys: AppleJwk[]; expiresAt: number } | null = null;

async function applePublicKeys(): Promise<AppleJwk[]> {
  const now = Date.now();
  if (appleJwksCache && appleJwksCache.expiresAt > now) return appleJwksCache.keys;

  const response = await fetchWithTimeout("https://appleid.apple.com/auth/keys");
  if (!response.ok) throw new Error("apple_jwks_fetch_failed");
  const body = (await response.json()) as AppleJwks;
  const keys = Array.isArray(body.keys) ? body.keys : [];
  appleJwksCache = { keys, expiresAt: now + 60 * 60 * 1000 };
  return keys;
}

async function verifyAppleIdentityToken(identityToken: string): Promise<AppleTokenPayload> {
  const decoded = jwt.decode(identityToken, { complete: true });
  const kid = decoded && typeof decoded === "object" ? decoded.header.kid : undefined;
  if (!kid) throw new Error("missing_apple_key_id");

  const key = (await applePublicKeys()).find((candidate) => candidate.kid === kid);
  if (!key) throw new Error("unknown_apple_key_id");

  const publicKey = createPublicKey({ key, format: "jwk" });
  const allowedAudiences = appleAllowedAudiences();
  // jsonwebtoken's own `audience` option already enforces exact string
  // equality (no substring/prefix/suffix matching, since these are plain
  // strings rather than RegExp) — this second, explicit check is deliberate
  // defense-in-depth so the allowlist enforcement is visible and testable in
  // this file's own code, not solely trusted to a third-party library's
  // internal behavior.
  const payload = jwt.verify(identityToken, publicKey, {
    algorithms: ["RS256"],
    issuer: "https://appleid.apple.com",
    audience: allowedAudiences,
  }) as AppleTokenPayload;
  if (!isAllowedAppleAudience(payload.aud, allowedAudiences)) {
    throw new Error("audience_not_allowlisted");
  }
  return payload;
}

/**
 * POST /api/auth/apple
 * body: { identityToken, requestedRole, fullName? }
 *
 * Native Sign in with Apple returns a signed identity token. We verify it
 * against Apple's JWKS, then sign in existing users or self-provision first-time
 * athlete/coach accounts based on the selected role.
 */
router.post("/apple", async (req: Request, res: Response) => {
  logAuthEvent("apple.request_received");

  if (!checkLoginRateLimit(req)) {
    logAuthEvent("apple.rate_limited");
    res.status(429).json({ error: "too_many_login_attempts" });
    return;
  }

  const identityToken =
    typeof req.body?.identityToken === "string" ? req.body.identityToken : "";
  if (!identityToken) {
    logAuthEvent("apple.missing_identity_token");
    res.status(400).json({ error: "missing_credential" });
    return;
  }

  let info: AppleTokenPayload;
  try {
    info = await verifyAppleIdentityToken(identityToken);
    logAuthEvent("apple.token_verified", { hasSub: Boolean(info.sub), hasEmail: Boolean(info.email) });
  } catch (err) {
    // NEVER log the identity token itself — only the failure shape.
    logAuthEvent("apple.token_verification_failed", {
      name: (err as Error).name,
      message: (err as Error).message,
    });
    res.status(401).json({ error: "invalid_apple_token" });
    return;
  }

  if (!info.sub) {
    logAuthEvent("apple.missing_subject_claim");
    res.status(401).json({ error: "invalid_apple_token" });
    return;
  }

  // Apple may omit profile claims after the first authorization. Existing
  // accounts therefore authenticate by Apple's stable subject, not by email.
  const existingAppleUser = await User.findOne({ appleSubject: info.sub });
  logAuthEvent("apple.existing_user_lookup", { found: Boolean(existingAppleUser) });
  if (existingAppleUser) {
    if (!existingAppleUser.isActive) {
      logAuthEvent("apple.account_disabled", { userId: existingAppleUser._id.toString() });
      res.status(403).json({ error: "account_disabled" });
      return;
    }
    const tokens = await issueTokensForUser(existingAppleUser, res);
    logAuthEvent("apple.success", { userId: existingAppleUser._id.toString(), newAccount: false });
    res.json(authResponsePayload(req, tokens, existingAppleUser));
    return;
  }

  const emailVerified = info.email_verified === true || info.email_verified === "true";
  if (!emailVerified || !info.email) {
    logAuthEvent("apple.no_usable_email_for_new_account", { emailVerified, hasEmail: Boolean(info.email) });
    res.status(401).json({ error: "invalid_apple_token" });
    return;
  }

  const { user, error } = await findOrCreateSocialUser({
    email: info.email,
    name: typeof req.body?.fullName === "string" ? req.body.fullName : undefined,
    requestedRole: req.body?.requestedRole,
    appleSubject: info.sub,
  });
  if (error || !user) {
    logAuthEvent("apple.user_resolution_failed", { code: error?.code });
    res.status(error?.status ?? 500).json({ error: error?.code ?? "signup_failed" });
    return;
  }

  const tokens = await issueTokensForUser(user, res);
  logAuthEvent("apple.success", { userId: user._id.toString(), newAccount: true });
  res.json(authResponsePayload(req, tokens, user));
});

/**
 * POST /api/auth/register-athlete
 * body: { name, email, password, sport, position?, timezone? }
 *
 * Self-service athlete sign-up: creates a User(role: athlete) + AthleteProfile
 * with NO coach assignment and NO academy, then signs the new athlete straight
 * in. This is the ONE self-signup path on the platform (by explicit request) so
 * athletes can log their own training/wellness without a coach — coaches and
 * guardians are still provisioned only. A self-registered athlete is simply
 * unassigned, so they remain invisible to every coach until/unless a coach later
 * adds them, which keeps the coach-scope invariant intact.
 */
const REG_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post("/register-athlete", async (req: Request, res: Response) => {
  if (!checkLoginRateLimit(req)) {
    res.status(429).json({ error: "too_many_login_attempts" });
    return;
  }

  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const email =
    typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const sport = typeof req.body?.sport === "string" ? req.body.sport.trim() : "";
  const position =
    typeof req.body?.position === "string" && req.body.position.trim()
      ? req.body.position.trim()
      : undefined;
  const timezone =
    typeof req.body?.timezone === "string" && req.body.timezone.trim()
      ? req.body.timezone.trim()
      : "UTC";

  if (!name) {
    res.status(400).json({ error: "invalid_name" });
    return;
  }
  if (!REG_EMAIL_RE.test(email)) {
    res.status(400).json({ error: "invalid_email" });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: "weak_password" });
    return;
  }
  if (!sport) {
    res.status(400).json({ error: "invalid_sport" });
    return;
  }

  if (await User.exists({ email })) {
    res.status(409).json({ error: "email_already_exists" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  // No DB transactions in this stack — roll back the user if the profile fails.
  let user: UserDoc | null = null;
  try {
    user = await User.create({
      email,
      passwordHash,
      role: "athlete",
      name,
      isActive: true,
      mustChangePassword: false,
    });
    await AthleteProfile.create({
      userId: user._id,
      sport,
      position,
      timezone,
    });
  } catch (err) {
    if (user) await User.deleteOne({ _id: user._id }).catch(() => undefined);
    if ((err as { code?: number }).code === 11000) {
      res.status(409).json({ error: "email_already_exists" });
      return;
    }
    throw err;
  }

  const tokens = await issueTokensForUser(user, res);
  res.status(201).json(authResponsePayload(req, tokens, user));
});

router.post("/refresh", async (req: Request, res: Response) => {
  const token = readRefreshToken(req);
  if (!token) {
    res.status(401).json({ error: "no_refresh_token" });
    return;
  }

  let sub: string;
  try {
    ({ sub } = verifyRefreshToken(token));
  } catch {
    clearAuthCookies(res);
    res.status(401).json({ error: "invalid_refresh_token" });
    return;
  }

  if (!Types.ObjectId.isValid(sub)) {
    clearAuthCookies(res);
    res.status(401).json({ error: "invalid_refresh_token" });
    return;
  }

  const user = await User.findById(sub);
  if (!user || !user.isActive || !user.refreshTokenHash) {
    clearAuthCookies(res);
    res.status(401).json({ error: "invalid_refresh_token" });
    return;
  }

  const match = await bcrypt.compare(token, user.refreshTokenHash);
  if (!match) {
    clearAuthCookies(res);
    res.status(401).json({ error: "invalid_refresh_token" });
    return;
  }

  const tokens = await issueTokensForUser(user, res);
  res.json(authResponsePayload(req, tokens, user));
});

router.get("/me", requireAuth, async (req: Request, res: Response) => {
  const user = await User.findById(req.actor?.userId);
  if (!user || !user.isActive) {
    res.status(401).json({ error: "user_inactive" });
    return;
  }

  res.json({ user: safeUser(user) });
});

router.post("/change-password", requireAuth, async (req: Request, res: Response) => {
  const user = await User.findById(req.actor?.userId);
  if (!user || !user.isActive) {
    res.status(401).json({ error: "user_inactive" });
    return;
  }

  const currentPassword =
    typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
  const newPassword =
    typeof req.body?.newPassword === "string" ? req.body.newPassword : "";

  if (newPassword.length < 8) {
    res.status(400).json({ error: "weak_password" });
    return;
  }

  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) {
    res.status(401).json({ error: "invalid_current_password" });
    return;
  }
  if (await bcrypt.compare(newPassword, user.passwordHash)) {
    res.status(400).json({ error: "same_password" });
    return;
  }

  user.passwordHash = await bcrypt.hash(newPassword, 10);
  user.mustChangePassword = false;
  await user.save();

  // Rotate tokens so any other session using the old refresh token is invalidated.
  const tokens = await issueTokensForUser(user, res);
  res.json({ ok: true, ...authResponsePayload(req, tokens, user) });
});

router.delete("/account", requireAuth, async (req: Request, res: Response) => {
  if (req.body?.confirmation !== "DELETE") {
    res.status(400).json({ error: "confirmation_required" });
    return;
  }

  const user = await User.findById(req.actor?.userId);
  if (!user || !user.isActive) {
    res.status(401).json({ error: "user_inactive" });
    return;
  }

  await permanentlyDeleteAccount(user);
  clearAuthCookies(res);
  res.json({ ok: true });
});

router.post("/logout", async (req: Request, res: Response) => {
  const token = readRefreshToken(req);
  if (token) {
    try {
      const { sub } = verifyRefreshToken(token);
      if (Types.ObjectId.isValid(sub)) {
        await User.updateOne({ _id: sub }, { $unset: { refreshTokenHash: "" } });
      }
    } catch {
      // ignore — we still clear the cookie below
    }
  }
  clearAuthCookies(res);
  res.json({ ok: true });
});

export default router;
