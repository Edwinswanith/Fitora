/**
 * Coach invites: a coach asks an existing athlete, found by email, to train
 * with them. See models/CoachInvite.ts for the rules.
 *
 *   coach:   invite by email (same response whether or not the email exists)
 *   athlete: pending -> accept (creates the CoachAthleteAssignment) | decline
 */

import { Types } from "mongoose";
import { CoachInvite, COACH_INVITE_TTL_MS, type CoachInviteDoc } from "../models/CoachInvite";
import { CoachAthleteAssignment } from "../models/CoachAthleteAssignment";
import { CoachJoinRequest } from "../models/CoachJoinRequest";
import { CoachProfile } from "../models/CoachProfile";
import { AthleteProfile } from "../models/AthleteProfile";
import { User } from "../models/User";
import { evaluateAndDispatch } from "./notificationEligibility";
import { resolveTimezoneForUser } from "./timezone";
import { categoryForType, type NotificationType } from "../lib/notificationTypes";
import * as templates from "./notificationTemplates";
import type { TemplateResult } from "./notificationTemplates";

export class CoachInviteError extends Error {
  constructor(
    readonly status: number,
    code: string
  ) {
    super(code);
  }
}

export type CoachInviteView = {
  id: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  coach: { id: string; name: string; specializations: string[]; yearsExperience: number | null };
};

export type SentInviteView = { id: string; createdAt: string; expiresAt: string; athlete: { name: string } };

function isDuplicateKey(err: unknown): boolean {
  return (err as { code?: number })?.code === 11000;
}

async function notify(params: {
  recipientUserId: Types.ObjectId;
  recipientRole: "coach" | "athlete";
  type: NotificationType;
  invite: Pick<CoachInviteDoc, "_id">;
  template: TemplateResult;
}): Promise<void> {
  try {
    const timezone = await resolveTimezoneForUser({ userId: params.recipientUserId, role: params.recipientRole });
    await evaluateAndDispatch({
      userId: params.recipientUserId,
      type: params.type,
      category: categoryForType(params.type),
      priorityTier: 2,
      dedupKey: `${params.type}:${params.invite._id.toString()}`,
      timezone,
      entityRef: { collection: "CoachInvite", id: params.invite._id },
      ...params.template,
    });
  } catch (err) {
    console.error("[coachInvite] notification dispatch failed (non-fatal)", (err as Error).message);
  }
}

/**
 * Invites the athlete with this email, if there is one who could accept.
 * Deliberately silent about why nothing happened (unknown email, a coach
 * account, already coached, already invited), so the endpoint can't be used
 * to find out who has an account or a coach.
 */
export async function inviteAthleteByEmail(input: { coachId: Types.ObjectId; email: string }): Promise<void> {
  const user = await User.findOne({ email: input.email }).select("_id role isActive").lean();
  if (!user || user.role !== "athlete" || user.isActive === false) return;
  const profile = await AthleteProfile.findOne({ userId: user._id }).select("_id").lean();
  if (!profile) return;
  if (await CoachAthleteAssignment.exists({ athleteId: profile._id, status: "active" })) return;

  let invite;
  try {
    invite = await CoachInvite.create({
      coachId: input.coachId,
      athleteId: profile._id,
      athleteUserId: user._id,
      expiresAt: new Date(Date.now() + COACH_INVITE_TTL_MS),
    });
  } catch (err) {
    if (isDuplicateKey(err)) return; // already invited and still pending
    throw err;
  }

  const coach = await User.findById(input.coachId).select("name").lean();
  await notify({
    recipientUserId: user._id as Types.ObjectId,
    recipientRole: "athlete",
    type: "coach_invited",
    invite,
    template: templates.buildCoachInvited({ coachName: (coach?.name as string | undefined) || "A coach" }),
  });
}

/** Pending, unexpired invites for this athlete, newest first, with the coach's public summary. */
export async function pendingInvitesForAthlete(athleteUserId: Types.ObjectId, now = new Date()): Promise<CoachInviteView[]> {
  const rows = await CoachInvite.find({ athleteUserId, status: "pending", expiresAt: { $gt: now } })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean<CoachInviteDoc[]>();
  if (!rows.length) return [];
  const coachIds = rows.map((r) => r.coachId);
  const [users, profiles] = await Promise.all([
    User.find({ _id: { $in: coachIds }, isActive: { $ne: false } }).select("name").lean(),
    CoachProfile.find({ userId: { $in: coachIds } }).select("userId specializations yearsExperience").lean(),
  ]);
  const nameById = new Map(users.map((u) => [u._id.toString(), u.name as string]));
  const profileById = new Map(profiles.map((p) => [p.userId.toString(), p]));
  return rows
    .filter((r) => nameById.has(r.coachId.toString()))
    .map((r) => {
      const profile = profileById.get(r.coachId.toString());
      return {
        id: r._id.toString(),
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        expiresAt: new Date(r.expiresAt).toISOString(),
        coach: {
          id: r.coachId.toString(),
          name: nameById.get(r.coachId.toString()) ?? "Coach",
          specializations: (profile?.specializations as string[] | undefined) ?? [],
          yearsExperience: (profile?.yearsExperience as number | null | undefined) ?? null,
        },
      };
    });
}

/** Invites this coach sent that are still waiting. Only the name the athlete registered with is shown. */
export async function pendingInvitesForCoach(coachId: Types.ObjectId, now = new Date()): Promise<SentInviteView[]> {
  const rows = await CoachInvite.find({ coachId, status: "pending", expiresAt: { $gt: now } }).sort({ createdAt: -1 }).limit(50).lean<CoachInviteDoc[]>();
  if (!rows.length) return [];
  const users = await User.find({ _id: { $in: rows.map((r) => r.athleteUserId) } }).select("name").lean();
  const nameById = new Map(users.map((u) => [u._id.toString(), u.name as string]));
  return rows.map((r) => ({
    id: r._id.toString(),
    createdAt: r.createdAt.toISOString(),
    expiresAt: new Date(r.expiresAt).toISOString(),
    athlete: { name: nameById.get(r.athleteUserId.toString()) ?? "Athlete" },
  }));
}

/**
 * The athlete's answer. Claims the invite atomically (pending -> decided) so
 * a double tap can't accept twice; accepting while the athlete already has a
 * coach is a 409 and closes the invite.
 */
export async function decideInvite(input: {
  athleteUserId: Types.ObjectId;
  inviteId: string;
  decision: "accept" | "decline";
  now?: Date;
}): Promise<CoachInviteDoc> {
  if (!Types.ObjectId.isValid(input.inviteId)) throw new CoachInviteError(400, "invalid_invite_id");
  const now = input.now ?? new Date();
  const claimed = await CoachInvite.findOneAndUpdate(
    { _id: input.inviteId, athleteUserId: input.athleteUserId, status: "pending", expiresAt: { $gt: now } },
    { $set: { status: input.decision === "accept" ? "accepted" : "declined", decidedAt: now } },
    { new: true }
  ).lean<CoachInviteDoc>();
  if (!claimed) throw new CoachInviteError(404, "invite_not_found");
  if (input.decision === "decline") return claimed;

  const coach = await User.findById(claimed.coachId).select("name role isActive academyId").lean();
  if (!coach || coach.role !== "coach" || coach.isActive === false) {
    await CoachInvite.updateOne({ _id: claimed._id }, { $set: { status: "cancelled" } });
    throw new CoachInviteError(404, "invite_not_found");
  }

  try {
    await CoachAthleteAssignment.create({ coachId: claimed.coachId, athleteId: claimed.athleteId, assignedBy: claimed.coachId, endedAt: null });
  } catch (err) {
    if (isDuplicateKey(err)) {
      await CoachInvite.updateOne({ _id: claimed._id }, { $set: { status: "cancelled" } });
      throw new CoachInviteError(409, "already_has_coach");
    }
    throw err;
  }

  // An unaffiliated athlete joins the coach's academy; one already in an academy keeps it.
  if (coach.academyId) {
    await Promise.all([
      AthleteProfile.updateOne({ _id: claimed.athleteId, academyId: null }, { $set: { academyId: coach.academyId } }),
      User.updateOne({ _id: claimed.athleteUserId, academyId: null }, { $set: { academyId: coach.academyId } }),
    ]).catch(() => undefined);
  }

  // Now coached: close the athlete's other open invites and any pending join request.
  await Promise.all([
    CoachInvite.updateMany({ athleteUserId: claimed.athleteUserId, status: "pending" }, { $set: { status: "cancelled", decidedAt: now } }),
    CoachJoinRequest.updateMany({ athleteId: claimed.athleteId, status: "pending" }, { $set: { status: "cancelled", decidedAt: now } }),
  ]);

  const athlete = await User.findById(claimed.athleteUserId).select("name").lean();
  await notify({
    recipientUserId: claimed.coachId as Types.ObjectId,
    recipientRole: "coach",
    type: "coach_invite_accepted",
    invite: claimed,
    template: templates.buildCoachInviteAccepted({ athleteName: (athlete?.name as string | undefined) || "Your new client" }),
  });
  return claimed;
}
