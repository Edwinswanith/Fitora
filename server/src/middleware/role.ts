import type { Request, Response, NextFunction } from "express";
import type { UserRole } from "../models/User";

export function requireRole(...allowed: UserRole[]) {
  return function roleGuard(req: Request, res: Response, next: NextFunction): void {
    if (!req.actor) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    if (!allowed.includes(req.actor.role)) {
      res.status(403).json({ error: "forbidden_role" });
      return;
    }
    next();
  };
}
