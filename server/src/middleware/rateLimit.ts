import type { Request, Response, NextFunction } from "express";

/**
 * Fixed-window, in-memory rate limiter for athlete daily-submission writes.
 *
 * Scope: prevents a single authenticated athlete (or, pre-auth, a single IP)
 * from hammering the write endpoints — accidental double-submits or abuse.
 * Only POST/PUT/PATCH are counted; reads pass through untouched.
 *
 * Note: in-memory state is per-process. For a horizontally-scaled deployment,
 * back this with a shared store (e.g. Redis). For a single API instance this is
 * sufficient and dependency-free.
 */
export function writeRateLimit(opts: { windowMs: number; max: number }) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return function writeLimiter(req: Request, res: Response, next: NextFunction): void {
    const method = req.method.toUpperCase();
    if (method !== "POST" && method !== "PUT" && method !== "PATCH") {
      next();
      return;
    }

    const key =
      req.actor?.userId?.toString() ?? req.ip ?? req.socket.remoteAddress ?? "unknown";
    const now = Date.now();
    const current = hits.get(key);

    if (!current || current.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + opts.windowMs });
      next();
      return;
    }
    if (current.count >= opts.max) {
      const retryAfterSec = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSec));
      res.status(429).json({ error: "too_many_requests" });
      return;
    }
    current.count += 1;
    next();
  };
}
