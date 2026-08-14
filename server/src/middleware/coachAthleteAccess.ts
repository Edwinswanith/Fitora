import type { Request, Response, NextFunction } from "express";
import { Types } from "mongoose";
import { CoachAthleteAssignment } from "../models/CoachAthleteAssignment";
import { AthleteProfile, type AthleteProfileDoc } from "../models/AthleteProfile";
import { GuardianAthleteLink } from "../models/GuardianAthleteLink";
import { AuditLog } from "../models/AuditLog";

async function loadAssignedAthleteIds(coachUserId: Types.ObjectId): Promise<Types.ObjectId[]> {
  const rows = await CoachAthleteAssignment.find({
    coachId: coachUserId,
    endedAt: null,
  })
    .select("athleteId")
    .lean();
  return rows.map((r) => r.athleteId as Types.ObjectId);
}

async function loadLinkedAthleteIds(guardianUserId: Types.ObjectId): Promise<Types.ObjectId[]> {
  const rows = await GuardianAthleteLink.find({
    guardianId: guardianUserId,
    endedAt: null,
  })
    .select("athleteId")
    .lean();
  return rows.map((r) => r.athleteId as Types.ObjectId);
}

export async function loadScope(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.actor) return next();

  // academyId + isAcademyOwner are already populated by requireAuth (single User
  // read). Here we only load the role-specific athlete-scope sets.
  if (req.actor.role === "coach") {
    req.actor.assignedAthleteIds = await loadAssignedAthleteIds(req.actor.userId);
  } else if (req.actor.role === "guardian") {
    req.actor.linkedAthleteIds = await loadLinkedAthleteIds(req.actor.userId);
  } else if (req.actor.role === "athlete") {
    const profile = await AthleteProfile.findOne({ userId: req.actor.userId })
      .select("_id")
      .lean();
    if (profile) req.actor.athleteProfileId = profile._id;
  }

  next();
}

function forbid(reason: string): never {
  const err = new Error(reason) as Error & { status?: number };
  err.status = 403;
  throw err;
}

function toObjectId(id: Types.ObjectId | string): Types.ObjectId {
  return id instanceof Types.ObjectId ? id : new Types.ObjectId(String(id));
}

async function auditAthleteDeny(
  req: Request,
  targetId: Types.ObjectId,
  reason: string
): Promise<void> {
  if (!req.actor) return;

  try {
    await AuditLog.create({
      actorId: req.actor.userId,
      actorRole: req.actor.role,
      academyId: req.actor.academyId ?? null,
      action: `${req.method.toLowerCase()} ${req.baseUrl}${req.path}`,
      targetType: "athlete",
      targetId,
      outcome: "deny",
      reason,
      ip: req.ip,
    });
  } catch {
    // Authorization must not fail open or change response shape if audit persistence fails.
  }
}

/**
 * Sync check that an actor may access a given athlete. Enforces the
 * coach (assigned-only) / guardian (linked-only) / athlete (self-only) scopes.
 */
export function assertCanAccessAthlete(
  actor: NonNullable<Request["actor"]>,
  athleteId: Types.ObjectId | string
): void {
  const targetId = toObjectId(athleteId);

  if (actor.role === "coach") {
    const assigned = actor.assignedAthleteIds ?? [];
    if (!assigned.some((id) => id.equals(targetId))) forbid("not_in_assignments");
    return;
  }

  if (actor.role === "guardian") {
    const linked = actor.linkedAthleteIds ?? [];
    if (!linked.some((id) => id.equals(targetId))) forbid("not_linked_guardian");
    return;
  }

  if (actor.role === "athlete") {
    if (!actor.athleteProfileId || !actor.athleteProfileId.equals(targetId)) {
      forbid("not_self");
    }
    return;
  }

  forbid("forbidden");
}

/**
 * Profile-aware check. Kept as the entry point used by `requireAthleteAccess`
 * (it loads the AthleteProfile first); delegates to the role-scope check.
 */
export function assertCanAccessAthleteProfile(
  actor: NonNullable<Request["actor"]>,
  profile: Pick<AthleteProfileDoc, "_id" | "academyId">
): void {
  assertCanAccessAthlete(actor, profile._id);
}

/**
 * Express middleware factory. Expects athlete id at `req.params[paramName]`
 * (default: "athleteId"). Must run after requireAuth + loadScope.
 *
 * Loads the AthleteProfile, then runs the role-scope check on it.
 */
export function requireAthleteAccess(paramName: string = "athleteId") {
  return async function guard(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    if (!req.actor) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const raw = req.params[paramName];
    if (!raw || !Types.ObjectId.isValid(raw)) {
      res.status(400).json({ error: "invalid_athlete_id" });
      return;
    }
    try {
      const profile = await AthleteProfile.findById(raw)
        .select("_id academyId")
        .lean();
      if (!profile) {
        res.status(404).json({ error: "athlete_not_found" });
        return;
      }
      assertCanAccessAthleteProfile(req.actor, profile);
      next();
    } catch (err) {
      const status = (err as { status?: number }).status ?? 403;
      if (status === 403 && Types.ObjectId.isValid(raw)) {
        await auditAthleteDeny(req, new Types.ObjectId(raw), (err as Error).message);
      }
      res.status(status).json({ error: (err as Error).message });
    }
  };
}
