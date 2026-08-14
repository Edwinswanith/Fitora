import { Types } from "mongoose";
import { CoachAthleteAssignment } from "../models/CoachAthleteAssignment";
import { AthleteProfile } from "../models/AthleteProfile";
import { User } from "../models/User";
import type { UserRole } from "../models/User";
import { localDateStringInZone } from "./timezone";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Personalized "week 0" anchor for the periodic digests — deliberately NOT a
 * calendar Monday, since no week/cycle concept exists anywhere in this schema
 * and the existing streak/trend logic (achievements.ts, trends.ts) already
 * uses rolling trailing windows, never calendar weeks. Anchoring per-user also
 * avoids a synchronized thundering-herd digest send.
 */
export async function resolvePeriodAnchor(params: {
  userId: Types.ObjectId;
  role: UserRole;
  athleteProfileId?: Types.ObjectId;
}): Promise<Date> {
  if (params.role === "athlete" && params.athleteProfileId) {
    const earliest = await CoachAthleteAssignment.findOne({
      athleteId: params.athleteProfileId,
      endedAt: null,
    })
      .sort({ assignedAt: 1 })
      .select("assignedAt")
      .lean();
    if (earliest?.assignedAt) return earliest.assignedAt as Date;
    const profile = await AthleteProfile.findById(params.athleteProfileId)
      .select("createdAt")
      .lean();
    return (profile?.createdAt as Date | undefined) ?? new Date(0);
  }
  const user = await User.findById(params.userId).select("createdAt").lean();
  return (user?.createdAt as Date | undefined) ?? new Date(0);
}

/** UTC midnight of the LOCAL calendar date `date` falls on in `tz` — diffing these avoids DST fencepost errors. */
function localMidnightUtcMs(date: Date, tz: string): number {
  const iso = localDateStringInZone(date, tz);
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * Which rolling `periodDays`-length period `now` falls into, counting from
 * `anchor` — e.g. periodDays=7 gives each user their own "week" starting the
 * day they joined, not a shared Monday-Sunday week.
 */
export function periodIndex(now: Date, anchor: Date, periodDays: number, tz: string): number {
  const nowMs = localMidnightUtcMs(now, tz);
  const anchorMs = localMidnightUtcMs(anchor, tz);
  const dayDiff = Math.floor((nowMs - anchorMs) / DAY_MS);
  return Math.floor(Math.max(dayDiff, 0) / periodDays);
}
