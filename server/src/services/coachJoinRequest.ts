/**
 * Request to join a coach: the in-app way for an unassigned athlete to get a
 * coach while payments are off. See models/CoachJoinRequest.ts for the rules.
 *
 *   athlete: create -> (pending) -> cancel
 *   coach:   pending -> accept (creates the CoachAthleteAssignment) | decline
 */

import { Types, type HydratedDocument } from "mongoose";
import { CoachJoinRequest, type CoachJoinRequestDoc } from "../models/CoachJoinRequest";
import { CoachAthleteAssignment } from "../models/CoachAthleteAssignment";
import { CoachProfile } from "../models/CoachProfile";
import { AthleteProfile } from "../models/AthleteProfile";
import { User } from "../models/User";
import { evaluateAndDispatch } from "./notificationEligibility";
import { resolveTimezoneForUser } from "./timezone";
import { categoryForType, type NotificationType } from "../lib/notificationTypes";
import * as templates from "./notificationTemplates";
import type { TemplateResult } from "./notificationTemplates";

export class JoinRequestError extends Error {
  constructor(
    readonly status: number,
    code: string
  ) {
    super(code);
  }
}

export type JoinRequestView = {
  id: string;
  status: string;
  message: string;
  createdAt: string;
  decidedAt: string | null;
  coach: { id: string; name: string };
  athlete: { id: string; name: string; sport: string | null };
};

function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: number })?.code === 11000;
}

async function notify(params: {
  recipientUserId: Types.ObjectId;
  recipientRole: "coach" | "athlete";
  type: NotificationType;
  request: Pick<CoachJoinRequestDoc, "_id">;
  template: TemplateResult;
}): Promise<void> {
  try {
    const timezone = await resolveTimezoneForUser({ userId: params.recipientUserId, role: params.recipientRole });
    await evaluateAndDispatch({
      userId: params.recipientUserId,
      type: params.type,
      category: categoryForType(params.type),
      priorityTier: 2,
      dedupKey: `${params.type}:${params.request._id.toString()}`,
      timezone,
      entityRef: { collection: "CoachJoinRequest", id: params.request._id },
      ...params.template,
    });
  } catch (err) {
    console.error("[coachJoinRequest] notification dispatch failed (non-fatal)", (err as Error).message);
  }
}

/** Builds views for a batch of requests with two lookups total (no per-row queries). */
export async function serializeJoinRequests(rows: CoachJoinRequestDoc[]): Promise<JoinRequestView[]> {
  if (!rows.length) return [];
  const userIds = [...new Set(rows.flatMap((r) => [r.coachId.toString(), r.athleteUserId.toString()]))].map((id) => new Types.ObjectId(id));
  const profileIds = [...new Set(rows.map((r) => r.athleteId.toString()))].map((id) => new Types.ObjectId(id));
  const [users, profiles] = await Promise.all([
    User.find({ _id: { $in: userIds } }).select("name").lean(),
    AthleteProfile.find({ _id: { $in: profileIds } }).select("sport").lean(),
  ]);
  const nameById = new Map(users.map((u) => [u._id.toString(), u.name as string]));
  const sportById = new Map(profiles.map((p) => [p._id.toString(), (p.sport as string | undefined) ?? null]));
  return rows.map((r) => ({
    id: r._id.toString(),
    status: r.status,
    message: r.message ?? "",
    createdAt: r.createdAt.toISOString(),
    decidedAt: r.decidedAt ? new Date(r.decidedAt).toISOString() : null,
    coach: { id: r.coachId.toString(), name: nameById.get(r.coachId.toString()) ?? "Coach" },
    athlete: {
      id: r.athleteId.toString(),
      name: nameById.get(r.athleteUserId.toString()) ?? "Athlete",
      sport: sportById.get(r.athleteId.toString()) ?? null,
    },
  }));
}

export async function createJoinRequest(input: {
  athleteId: Types.ObjectId;
  athleteUserId: Types.ObjectId;
  coachId: string;
  message?: unknown;
}): Promise<HydratedDocument<CoachJoinRequestDoc>> {
  if (!Types.ObjectId.isValid(input.coachId)) throw new JoinRequestError(400, "invalid_coach_id");
  const coachId = new Types.ObjectId(input.coachId);
  const message = typeof input.message === "string" ? input.message.trim().slice(0, 500) : "";

  // Only coaches listed in the marketplace can be asked (same set the athlete can browse).
  const [coach, profile] = await Promise.all([
    User.findById(coachId).select("role isActive name").lean(),
    CoachProfile.findOne({ userId: coachId }).select("active").lean(),
  ]);
  if (!coach || coach.role !== "coach" || coach.isActive === false || !profile?.active) {
    throw new JoinRequestError(404, "coach_not_found");
  }

  const activeRelationship = await CoachAthleteAssignment.findOne({ athleteId: input.athleteId, status: "active" }).select("coachId").lean();
  if (activeRelationship) {
    throw new JoinRequestError(409, activeRelationship.coachId.equals(coachId) ? "already_your_coach" : "already_has_coach");
  }

  let request: HydratedDocument<CoachJoinRequestDoc>;
  try {
    request = await CoachJoinRequest.create({ athleteId: input.athleteId, athleteUserId: input.athleteUserId, coachId, message });
  } catch (err) {
    if (isDuplicateKey(err)) throw new JoinRequestError(409, "request_pending");
    throw err;
  }

  const athlete = await User.findById(input.athleteUserId).select("name").lean();
  await notify({
    recipientUserId: coachId,
    recipientRole: "coach",
    type: "join_requested",
    request,
    template: templates.buildJoinRequested({ athleteName: (athlete?.name as string | undefined) || "An athlete" }),
  });
  return request;
}

/** The athlete's current pending request, else their most recent decided one (so the app can show "declined"). */
export async function latestJoinRequestForAthlete(athleteId: Types.ObjectId): Promise<CoachJoinRequestDoc | null> {
  const pending = await CoachJoinRequest.findOne({ athleteId, status: "pending" }).lean<CoachJoinRequestDoc>();
  if (pending) return pending;
  return CoachJoinRequest.findOne({ athleteId }).sort({ updatedAt: -1 }).lean<CoachJoinRequestDoc>();
}

export async function cancelJoinRequest(athleteId: Types.ObjectId, requestId: string): Promise<CoachJoinRequestDoc> {
  if (!Types.ObjectId.isValid(requestId)) throw new JoinRequestError(400, "invalid_request_id");
  const updated = await CoachJoinRequest.findOneAndUpdate(
    { _id: requestId, athleteId, status: "pending" },
    { $set: { status: "cancelled", decidedAt: new Date() } },
    { new: true }
  ).lean<CoachJoinRequestDoc>();
  if (!updated) throw new JoinRequestError(404, "request_not_found");
  return updated;
}

/**
 * Pending requests for this coach. Requests from athletes who have since got
 * a coach some other way (e.g. linked by email) are closed here rather than
 * shown as actionable.
 */
export async function pendingJoinRequestsForCoach(coachId: Types.ObjectId): Promise<CoachJoinRequestDoc[]> {
  const rows = await CoachJoinRequest.find({ coachId, status: "pending" }).sort({ createdAt: 1 }).limit(100).lean<CoachJoinRequestDoc[]>();
  if (!rows.length) return rows;
  const coached = await CoachAthleteAssignment.find({ athleteId: { $in: rows.map((r) => r.athleteId) }, status: "active" }).select("athleteId").lean();
  if (!coached.length) return rows;
  const coachedIds = new Set(coached.map((a) => a.athleteId.toString()));
  const stale = rows.filter((r) => coachedIds.has(r.athleteId.toString()));
  await CoachJoinRequest.updateMany({ _id: { $in: stale.map((r) => r._id) }, status: "pending" }, { $set: { status: "cancelled", decidedAt: new Date() } });
  return rows.filter((r) => !coachedIds.has(r.athleteId.toString()));
}

/**
 * Coach decision. Claims the request atomically (pending -> decided) so a
 * double tap or two devices can't accept twice; on accept, a relationship
 * the athlete gained elsewhere in the meantime makes this a 409 and the
 * request is closed as cancelled.
 */
export async function decideJoinRequest(input: {
  coachId: Types.ObjectId;
  coachAcademyId?: Types.ObjectId | null;
  requestId: string;
  decision: "accept" | "decline";
}): Promise<CoachJoinRequestDoc> {
  if (!Types.ObjectId.isValid(input.requestId)) throw new JoinRequestError(400, "invalid_request_id");
  const status = input.decision === "accept" ? "accepted" : "declined";
  const claimed = await CoachJoinRequest.findOneAndUpdate(
    { _id: input.requestId, coachId: input.coachId, status: "pending" },
    { $set: { status, decidedAt: new Date() } },
    { new: true }
  ).lean<CoachJoinRequestDoc>();
  if (!claimed) throw new JoinRequestError(404, "request_not_found");

  const coach = await User.findById(input.coachId).select("name").lean();
  const coachName = (coach?.name as string | undefined) || "Your coach";

  if (input.decision === "decline") {
    await notify({ recipientUserId: claimed.athleteUserId as Types.ObjectId, recipientRole: "athlete", type: "join_declined", request: claimed, template: templates.buildJoinDeclined({ coachName }) });
    return claimed;
  }

  try {
    await CoachAthleteAssignment.create({ coachId: input.coachId, athleteId: claimed.athleteId, assignedBy: input.coachId, endedAt: null });
  } catch (err) {
    if (isDuplicateKey(err)) {
      await CoachJoinRequest.updateOne({ _id: claimed._id }, { $set: { status: "cancelled" } });
      throw new JoinRequestError(409, "athlete_has_active_coach");
    }
    throw err;
  }

  // Same academy adoption as the coach's link-by-email flow: an unaffiliated
  // athlete joins the coach's academy; one already in an academy keeps it.
  if (input.coachAcademyId) {
    await Promise.all([
      AthleteProfile.updateOne({ _id: claimed.athleteId, academyId: null }, { $set: { academyId: input.coachAcademyId } }),
      User.updateOne({ _id: claimed.athleteUserId, academyId: null }, { $set: { academyId: input.coachAcademyId } }),
    ]).catch(() => undefined);
  }

  await notify({ recipientUserId: claimed.athleteUserId as Types.ObjectId, recipientRole: "athlete", type: "join_accepted", request: claimed, template: templates.buildJoinAccepted({ coachName }) });
  return claimed;
}
