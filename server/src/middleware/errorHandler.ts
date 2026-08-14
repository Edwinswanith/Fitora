import type { ErrorRequestHandler } from "express";

/**
 * Global error middleware (must be the LAST `app.use`, with all four args so
 * Express recognizes it as an error handler). Paired with `express-async-errors`
 * so thrown errors in async handlers also reach here.
 *
 * Known failures (validation, authz) are mapped to 4xx by the handlers
 * themselves and may set `err.status`. Anything else is unexpected: we log it
 * server-side and return an opaque `500 { error: "server_error" }` so stack
 * traces never leak to clients.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  // If the response has already started, defer to Express's default handler.
  if (res.headersSent) {
    return next(err);
  }
  const status = (err as { status?: number })?.status ?? 500;
  const code = (err as { code?: string })?.code;
  const message =
    status >= 500 ? "server_error" : (err as Error).message || "error";
  if (status >= 500) {
    console.error(
      `[error] ${req.method} ${req.originalUrl} ->`,
      (err as Error).message,
      code ? `(${code})` : ""
    );
  }
  res.status(status).json({ error: message });
};
