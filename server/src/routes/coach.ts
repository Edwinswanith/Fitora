import { Router, type Request, type Response } from "express";
import { Types, type HydratedDocument } from "mongoose";
import bcrypt from "bcryptjs";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/role";
import { writeRateLimit } from "../middleware/rateLimit";
import {
  loadScope,
  requireAthleteAccess,
} from "../middleware/coachAthleteAccess";
import { AthleteProfile } from "../models/AthleteProfile";
import { User } from "../models/User";
import { CoachAthleteAssignment } from "../models/CoachAthleteAssignment";
import { GuardianAthleteLink } from "../models/GuardianAthleteLink";
import { AuditLog } from "../models/AuditLog";
import { CoachComment } from "../models/CoachComment";
import { Announcement } from "../models/Announcement";
import { DeviceToken } from "../models/DeviceToken";
import { NotificationDecision } from "../models/NotificationDecision";
import { createNotification } from "../services/notifications";
import { generateTempPassword } from "../lib/tempPassword";
import { RpeMonitoring } from "../models/RpeMonitoring";
import { Injury, INJURY_SEVERITY } from "../models/Injury";
import { Attendance, ATTENDANCE_STATUS } from "../models/Attendance";
import {
  TrainingSession,
  SESSION_SLOTS,
  SESSION_STATUS,
  SESSION_SLOT_ORDER,
  type SessionSlot,
} from "../models/TrainingSession";
import { Performance } from "../models/Performance";
import {
  buildDailyCardForAthlete,
  buildDailyCardsForAthletes,
  dayRange,
} from "../services/dashboard";
import { evaluateAndDispatch } from "../services/notificationEligibility";
import { getFcmConfigurationStatus } from "../services/fcmDelivery";
import { resolveTimezoneForUser } from "../services/timezone";
import { buildCoachFeedback, buildInjuryAlert } from "../services/notificationTemplates";
import { notificationPreview } from "../services/notificationCopy";
import { buildTrendSeries, clampDays } from "../services/trends";
import { buildActivityFeed, clampLimit } from "../services/activity";
import {
  buildWellnessSeries,
  buildAttendanceSeries,
  buildSessionSeries,
  buildPerformanceSeries,
  buildWaterSeries,
  buildSquadSeries,
  buildCoachNotesInbox,
} from "../services/analytics";
import { parseDateOrNull } from "../lib/trainingCategories";
import { avatarFilePath, avatarSummary } from "../services/avatar";
import {
  fetchThread,
  sendMessage,
  messageView,
  markThreadRead,
  buildCoachThreads,
  coachTotalUnread,
  clampMsgLimit,
} from "../services/messaging";
import multer from "multer";
import fs from "fs";
import {
  WorkoutMedia,
  MEDIA_CONTEXTS,
  type WorkoutMediaDoc,
} from "../models/WorkoutMedia";
import {
  mediaUpload,
  mediaFilePath,
  serializeMedia,
  markMediaSent,
  convertMediaToTable,
  updateMediaTable,
} from "../services/media";

const router = Router();

// Coaches only — every route is gated to athletes assigned to the actor
// (keeps the assigned-only authorization story auditable).
router.use(requireAuth, requireRole("coach"), loadScope);

function maskPushToken(token: unknown): string | null {
  if (typeof token !== "string" || !token) return null;
  if (token.length <= 20) return `${token.slice(0, 4)}...${token.slice(-4)} (${token.length})`;
  return `${token.slice(0, 10)}...${token.slice(-8)} (${token.length})`;
}

function isoOrNull(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

function strictDate(input: unknown, res: Response): Date | null {
  if (input === undefined || input === null || input === "") {
    return dayRange(undefined).start;
  }
  const d = parseDateOrNull(input);
  if (!d) {
    res.status(400).json({ error: "invalid_date" });
    return null;
  }
  return d;
}

function assignedIdsFor(req: Request): Types.ObjectId[] {
  return req.actor?.assignedAthleteIds ?? [];
}

function serializeAnnouncement(a: {
  _id: Types.ObjectId;
  body: string;
  recipientCount?: number;
  createdAt?: Date;
}) {
  return {
    id: a._id.toString(),
    body: a.body,
    recipientCount: a.recipientCount ?? 0,
    createdAt: (a.createdAt ?? new Date()).toISOString(),
  };
}

/**
 * POST /api/coach/announcements — broadcast one message to the coach's currently
 * assigned athletes. Creates the announcement and fans out an in-app
 * notification to each athlete's user account. Scoped: only assigned athletes
 * (req.actor.assignedAthleteIds) ever receive it.
 */
router.post("/announcements", writeRateLimit({ windowMs: 60_000, max: 20 }), async (req: Request, res: Response) => {
  if (!req.actor) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  const body = String(req.body?.body ?? "").trim();
  if (!body) {
    res.status(400).json({ error: "empty_message" });
    return;
  }
  if (body.length > 1000) {
    res.status(400).json({ error: "message_too_long" });
    return;
  }

  const coachId = req.actor.userId;
  const academyId = req.actor.academyId ?? null;
  const assigned = assignedIdsFor(req);
  const profiles = await AthleteProfile.find({ _id: { $in: assigned } })
    .select("_id userId")
    .lean();
  const recipientUserIds = profiles.map((p) => p.userId as Types.ObjectId);

  const announcement = await Announcement.create({
    coachId,
    academyId,
    body,
    recipientCount: recipientUserIds.length,
  });

  const coach = await User.findById(coachId).select("name").lean();
  const coachName = (coach?.name as string) || "Your coach";
  const announcementTitle = `Team update from ${coachName}`;
  const announcementBody = notificationPreview(body);
  await Promise.all(
    recipientUserIds.map(async (uid) => {
      await createNotification({
        recipientUserId: uid,
        type: "announcement",
        title: announcementTitle,
        body: announcementBody,
        priority: "medium",
        link: "/athlete/dashboard",
        academyId,
      });
      const timezone = await resolveTimezoneForUser({ userId: uid, role: "athlete" });
      await evaluateAndDispatch(
        {
          userId: uid,
          type: "announcement",
          category: "messages",
          priorityTier: 2,
          dedupKey: `announcement:${announcement._id.toString()}:${uid.toString()}`,
          title: announcementTitle,
          body: announcementBody,
          link: "/athlete/dashboard",
          academyId,
          entityRef: { collection: "Announcement", id: announcement._id as Types.ObjectId },
          timezone,
        },
        { createInAppNotification: false }
      );
    })
  );

  res.status(201).json({
    announcement: serializeAnnouncement(announcement),
    recipientCount: recipientUserIds.length,
  });
});

/** GET /api/coach/announcements — the coach's own sent broadcasts, newest first. */
router.get("/announcements", async (req: Request, res: Response) => {
  if (!req.actor) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  const items = await Announcement.find({ coachId: req.actor.userId })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  res.json({ announcements: items.map(serializeAnnouncement) });
});

/**
 * GET /api/coach/athletes
 * Returns the coach's currently assigned athletes (profile + user name).
 */
router.get("/athletes", async (req: Request, res: Response) => {
  if (!req.actor) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }

  const ids = assignedIdsFor(req);
  if (ids.length === 0) {
    res.json({ athletes: [] });
    return;
  }

  const profiles = await AthleteProfile.find({ _id: { $in: ids } })
    .select("_id userId sport position academyId")
    .lean();
  const users = await User.find({ _id: { $in: profiles.map((p) => p.userId) } })
    .select("_id name email avatarKind avatarDefaultId")
    .lean();
  const userById = new Map(users.map((u) => [u._id.toString(), u]));

  const athletes = profiles.map((p) => {
    const u = userById.get((p.userId as Types.ObjectId).toString());
    return {
      athleteId: p._id.toString(),
      userId: (p.userId as Types.ObjectId).toString(),
      name: u?.name ?? "",
      email: u?.email ?? "",
      sport: p.sport,
      position: p.position ?? null,
      academyId: p.academyId ? (p.academyId as Types.ObjectId).toString() : null,
      avatar: u ? avatarSummary(u) : { kind: null, defaultId: null },
    };
  });

  res.json({ athletes });
});

/** GET /api/coach/athletes/:athleteId/avatar/file — streams an assigned athlete's uploaded profile photo. */
router.get(
  "/athletes/:athleteId/avatar/file",
  requireAthleteAccess("athleteId"),
  async (req: Request, res: Response) => {
    const profile = await AthleteProfile.findById(req.params.athleteId).select("userId").lean();
    const user = profile
      ? await User.findById(profile.userId).select("avatarKind avatarStoredFilename avatarMimeType").lean()
      : null;
    if (!user || user.avatarKind !== "photo" || !user.avatarStoredFilename) {
      res.status(404).json({ error: "no_avatar_photo" });
      return;
    }
    const filePath = avatarFilePath(user);
    res.type(user.avatarMimeType ?? "image/jpeg");
    res.setHeader("Cache-Control", "private, max-age=0, no-store");
    res.sendFile(filePath, (err) => {
      if (err && !res.headersSent) {
        res.status(404).json({ error: "file_missing" });
      }
    });
  }
);

// ── Coach-led onboarding ──────────────────────────────────────────────────
// A coach provisions athletes/guardians in their own academy. Scoped & audited;
// the coach can only ever create `athlete`/`guardian` roles (never coach/admin)
// and only attach guardians to athletes assigned to them. Replaces the removed
// admin provisioning surface — see CLAUDE.md "No admin".

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function reqStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

async function auditAllow(
  req: Request,
  targetType: string,
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
      targetType,
      targetId,
      outcome: "allow",
      reason,
      ip: req.ip,
    });
  } catch {
    // Audit persistence must never change the response.
  }
}

/**
 * POST /api/coach/athletes
 * body: { name, email, sport, position?, timezone? }
 * Creates a new athlete account (User + AthleteProfile) and assigns the new
 * athlete to the acting coach. Returns a one-time temp password.
 */
router.post(
  "/athletes",
  writeRateLimit({ windowMs: 60_000, max: 40 }),
  async (req: Request, res: Response) => {
    if (!req.actor) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const name = reqStr(req.body?.name);
    const email = reqStr(req.body?.email).toLowerCase();
    const sport = reqStr(req.body?.sport);
    const position = reqStr(req.body?.position) || undefined;
    const timezone = reqStr(req.body?.timezone) || "UTC";

    if (!name) return void res.status(400).json({ error: "invalid_name" });
    if (!EMAIL_RE.test(email)) return void res.status(400).json({ error: "invalid_email" });
    if (!sport) return void res.status(400).json({ error: "invalid_sport" });

    if (await User.exists({ email })) {
      res.status(409).json({ error: "email_already_exists" });
      return;
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    const academyId = req.actor.academyId ?? undefined;

    let userId: Types.ObjectId | undefined;
    let profileId: Types.ObjectId | undefined;
    try {
      const user = await User.create({
        email,
        passwordHash,
        role: "athlete",
        name,
        academyId,
        isActive: true,
        mustChangePassword: true,
      });
      userId = user._id;

      const profile = await AthleteProfile.create({
        userId: user._id,
        academyId,
        sport,
        position,
        timezone,
      });
      profileId = profile._id;

      await CoachAthleteAssignment.create({
        coachId: req.actor.userId,
        athleteId: profile._id,
        assignedBy: req.actor.userId,
        endedAt: null,
      });

      await auditAllow(req, "athlete", profile._id, "athlete_created");

      res.status(201).json({
        athlete: {
          athleteId: profile._id.toString(),
          userId: user._id.toString(),
          name,
          email,
          sport,
          position: position ?? null,
          timezone,
        },
        tempPassword,
      });
    } catch (err) {
      // No transactions in this stack — roll back partial creates to avoid orphans.
      if (profileId) await AthleteProfile.deleteOne({ _id: profileId }).catch(() => undefined);
      if (userId) await User.deleteOne({ _id: userId }).catch(() => undefined);
      if ((err as { code?: number }).code === 11000) {
        res.status(409).json({ error: "email_already_exists" });
        return;
      }
      throw err;
    }
  }
);

/**
 * POST /api/coach/athletes/link
 * body: { email }
 * Links an EXISTING athlete (e.g. one who self-registered) to the acting coach
 * by email — the counterpart to POST /athletes, which creates a fresh account.
 * No password is issued: the athlete already has their own. If the athlete has
 * no academy yet, they're adopted into the coach's academy so their RPE rows
 * and announcements tag correctly. Idempotent-ish: re-linking an already-active
 * athlete returns 409 already_linked.
 */
router.post(
  "/athletes/link",
  writeRateLimit({ windowMs: 60_000, max: 40 }),
  async (req: Request, res: Response) => {
    if (!req.actor) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const email = reqStr(req.body?.email).toLowerCase();
    if (!EMAIL_RE.test(email)) {
      res.status(400).json({ error: "invalid_email" });
      return;
    }

    const user = await User.findOne({ email }).select("_id role name email").lean();
    if (!user || user.role !== "athlete") {
      // Don't leak whether the email exists as a non-athlete account.
      res.status(404).json({ error: "athlete_not_found" });
      return;
    }
    const profile = await AthleteProfile.findOne({ userId: user._id })
      .select("_id userId academyId sport position")
      .lean();
    if (!profile) {
      res.status(404).json({ error: "athlete_not_found" });
      return;
    }

    const active = await CoachAthleteAssignment.exists({
      coachId: req.actor.userId,
      athleteId: profile._id,
      endedAt: null,
    });
    if (active) {
      res.status(409).json({ error: "already_linked" });
      return;
    }

    const coachAcademyId = req.actor.academyId ?? undefined;

    try {
      await CoachAthleteAssignment.create({
        coachId: req.actor.userId,
        athleteId: profile._id,
        assignedBy: req.actor.userId,
        endedAt: null,
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        res.status(409).json({ error: "already_linked" });
        return;
      }
      throw err;
    }

    // Adopt an unaffiliated athlete into the coach's academy (never reassign one
    // that already belongs to an academy).
    if (!profile.academyId && coachAcademyId) {
      await Promise.all([
        AthleteProfile.updateOne({ _id: profile._id }, { $set: { academyId: coachAcademyId } }),
        User.updateOne({ _id: user._id }, { $set: { academyId: coachAcademyId } }),
      ]).catch(() => undefined);
    }

    await auditAllow(req, "athlete", profile._id, "athlete_linked");

    res.status(201).json({
      athlete: {
        athleteId: profile._id.toString(),
        userId: (user._id as Types.ObjectId).toString(),
        name: user.name,
        email: user.email,
        sport: profile.sport,
        position: profile.position ?? null,
      },
      linkedExisting: true,
    });
  }
);

/**
 * POST /api/coach/athletes/:athleteId/guardians
 * body: { name, email, relationship? }
 * Adds a guardian for an assigned athlete. Reuses an existing guardian account
 * if the email already belongs to one (e.g. a parent of two athletes).
 */
router.post(
  "/athletes/:athleteId/guardians",
  writeRateLimit({ windowMs: 60_000, max: 40 }),
  requireAthleteAccess("athleteId"),
  async (req: Request, res: Response) => {
    if (!req.actor) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const name = reqStr(req.body?.name);
    const email = reqStr(req.body?.email).toLowerCase();
    const relationship = reqStr(req.body?.relationship) || undefined;
    if (!name) return void res.status(400).json({ error: "invalid_name" });
    if (!EMAIL_RE.test(email)) return void res.status(400).json({ error: "invalid_email" });

    const athleteId = new Types.ObjectId(req.params.athleteId);
    const academyId = req.actor.academyId ?? undefined;

    const existing = await User.findOne({ email }).select("_id role name").lean();
    if (existing && existing.role !== "guardian") {
      res.status(409).json({ error: "email_already_exists" });
      return;
    }

    let tempPassword: string | undefined;
    let guardian: { _id: Types.ObjectId; name: string };

    if (existing) {
      guardian = { _id: existing._id, name: existing.name };
      const active = await GuardianAthleteLink.exists({
        guardianId: existing._id,
        athleteId,
        endedAt: null,
      });
      if (active) {
        res.status(409).json({ error: "already_linked" });
        return;
      }
    } else {
      tempPassword = generateTempPassword();
      const passwordHash = await bcrypt.hash(tempPassword, 10);
      const user = await User.create({
        email,
        passwordHash,
        role: "guardian",
        name,
        academyId,
        isActive: true,
        mustChangePassword: true,
      });
      guardian = { _id: user._id, name: user.name };
    }

    try {
      await GuardianAthleteLink.create({
        guardianId: guardian._id,
        athleteId,
        relationship,
        endedAt: null,
      });
    } catch (err) {
      // Roll back a brand-new guardian if the link can't be created.
      if (!existing) await User.deleteOne({ _id: guardian._id }).catch(() => undefined);
      if ((err as { code?: number }).code === 11000) {
        res.status(409).json({ error: "already_linked" });
        return;
      }
      throw err;
    }

    await auditAllow(req, "guardian", guardian._id, "guardian_linked");

    res.status(201).json({
      guardian: { userId: guardian._id.toString(), name: guardian.name, email },
      relationship: relationship ?? null,
      linkedExisting: Boolean(existing),
      ...(tempPassword ? { tempPassword } : {}),
    });
  }
);

// ── Academy-owner: manage coaches ─────────────────────────────────────────
// An "academy owner" is a coach with isAcademyOwner=true — a scoped capability
// to create/list other coaches in their academy. NOT an admin role/route.

function requireOwner(req: Request, res: Response, next: () => void): void {
  if (!req.actor) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  if (!req.actor.isAcademyOwner) {
    res.status(403).json({ error: "forbidden_not_owner" });
    return;
  }
  next();
}

/**
 * GET /api/coach/coaches — owner only.
 * Lists coaches in the owner's academy.
 */
router.get("/coaches", requireOwner, async (req: Request, res: Response) => {
  const coaches = await User.find({ role: "coach", academyId: req.actor!.academyId ?? null })
    .select("_id name email isAcademyOwner")
    .sort({ name: 1 })
    .lean();
  res.json({
    coaches: coaches.map((c) => ({
      userId: c._id.toString(),
      name: c.name,
      email: c.email,
      isAcademyOwner: Boolean(c.isAcademyOwner),
    })),
  });
});

/**
 * POST /api/coach/coaches — owner only.
 * body: { name, email }
 * Creates a new (non-owner) coach in the owner's academy; returns a temp password.
 */
router.post(
  "/coaches",
  writeRateLimit({ windowMs: 60_000, max: 40 }),
  requireOwner,
  async (req: Request, res: Response) => {
    const name = reqStr(req.body?.name);
    const email = reqStr(req.body?.email).toLowerCase();
    if (!name) return void res.status(400).json({ error: "invalid_name" });
    if (!EMAIL_RE.test(email)) return void res.status(400).json({ error: "invalid_email" });

    if (await User.exists({ email })) {
      res.status(409).json({ error: "email_already_exists" });
      return;
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    try {
      const user = await User.create({
        email,
        passwordHash,
        role: "coach",
        name,
        academyId: req.actor!.academyId ?? undefined,
        isActive: true,
        isAcademyOwner: false,
        mustChangePassword: true,
      });
      await auditAllow(req, "coach", user._id, "coach_created");
      res.status(201).json({
        coach: { userId: user._id.toString(), name, email },
        tempPassword,
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        res.status(409).json({ error: "email_already_exists" });
        return;
      }
      throw err;
    }
  }
);

// ── Direct messaging (coach side) ─────────────────────────────────────────
// Coach⇄athlete 1:1 threads. Every per-thread route is gated by
// requireAthleteAccess(athleteId), so a coach can only ever reach threads for
// athletes assigned to them — the coach-scope invariant holds for messaging too.

/** GET /api/coach/messages/threads — one row per athlete the coach has messaged. */
router.get("/messages/threads", async (req: Request, res: Response) => {
  if (!req.actor) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  const threads = await buildCoachThreads(req.actor.userId, assignedIdsFor(req));
  res.json({ threads });
});

/** GET /api/coach/messages/unread-count — total unread across all threads (badge). */
router.get("/messages/unread-count", async (req: Request, res: Response) => {
  if (!req.actor) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  const unreadCount = await coachTotalUnread(req.actor.userId, assignedIdsFor(req));
  res.json({ unreadCount });
});

/** GET /api/coach/athletes/:athleteId/messages?before=&limit= — thread history. */
router.get(
  "/athletes/:athleteId/messages",
  requireAthleteAccess("athleteId"),
  async (req: Request, res: Response) => {
    if (!req.actor) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const before = req.query.before ? new Date(String(req.query.before)) : undefined;
    if (before && Number.isNaN(before.getTime())) {
      res.status(400).json({ error: "invalid_before" });
      return;
    }
    const { messages, hasMore } = await fetchThread({
      coachId: req.actor.userId,
      athleteId: new Types.ObjectId(req.params.athleteId),
      viewerRole: "coach",
      before,
      limit: clampMsgLimit(req.query.limit),
    });
    res.json({ messages, hasMore });
  }
);

/** POST /api/coach/athletes/:athleteId/messages  body: { body } — send a message. */
router.post(
  "/athletes/:athleteId/messages",
  writeRateLimit({ windowMs: 60_000, max: 60 }),
  requireAthleteAccess("athleteId"),
  async (req: Request, res: Response) => {
    if (!req.actor) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const body = reqStr(req.body?.body);
    if (!body) {
      res.status(400).json({ error: "empty_message" });
      return;
    }
    if (body.length > 4000) {
      res.status(400).json({ error: "message_too_long" });
      return;
    }
    const { message: created, media } = await sendMessage({
      coachId: req.actor.userId,
      athleteId: new Types.ObjectId(req.params.athleteId),
      senderRole: "coach",
      body,
    });
    res.status(201).json({ message: messageView(created, "coach", media) });
  }
);

/** POST /api/coach/athletes/:athleteId/messages/read — mark athlete msgs read. */
router.post(
  "/athletes/:athleteId/messages/read",
  requireAthleteAccess("athleteId"),
  async (req: Request, res: Response) => {
    if (!req.actor) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const marked = await markThreadRead({
      coachId: req.actor.userId,
      athleteId: new Types.ObjectId(req.params.athleteId),
      readerRole: "coach",
    });
    res.json({ marked });
  }
);

/** GET /api/coach/athletes/:athleteId/notification-debug — sanitized push status for an assigned athlete. */
router.get(
  "/athletes/:athleteId/notification-debug",
  requireAthleteAccess("athleteId"),
  async (req: Request, res: Response) => {
    const athleteId = new Types.ObjectId(req.params.athleteId);
    const profile = await AthleteProfile.findById(athleteId).select("userId").lean();
    if (!profile?.userId) {
      res.status(404).json({ error: "athlete_not_found" });
      return;
    }

    const userId = profile.userId as Types.ObjectId;
    const rawLimit = Number(req.query.limit ?? 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 20) : 10;
    const [deviceTokens, recentDecisions] = await Promise.all([
      DeviceToken.find({ userId }).sort({ disabledAt: 1, updatedAt: -1 }).limit(10).lean(),
      NotificationDecision.find({ userId })
        .sort({ sentTime: -1, createdAt: -1 })
        .limit(limit)
        .lean(),
    ]);
    const activePushTokenCount = deviceTokens.filter((token) => !token.disabledAt).length;

    res.json({
      athleteId: athleteId.toString(),
      userId: userId.toString(),
      fcm: getFcmConfigurationStatus(),
      activePushTokenCount,
      deviceTokens: deviceTokens.map((token) => {
        const stamped = token as typeof token & { createdAt?: Date; updatedAt?: Date };
        return {
          id: token._id.toString(),
          platform: token.platform,
          token: maskPushToken(token.token),
          appVersion: token.appVersion ?? null,
          deviceName: token.deviceName ?? null,
          osName: token.osName ?? null,
          osVersion: token.osVersion ?? null,
          active: !token.disabledAt,
          lastSeenAt: isoOrNull(token.lastSeenAt),
          disabledAt: isoOrNull(token.disabledAt),
          createdAt: isoOrNull(stamped.createdAt),
          updatedAt: isoOrNull(stamped.updatedAt),
        };
      }),
      recentDecisions: recentDecisions.map((decision) => ({
        type: decision.type,
        category: decision.category,
        status: decision.status,
        suppressReason: decision.suppressReason ?? null,
        sentTime: (decision.sentTime as Date).toISOString(),
        dedupKey: decision.dedupKey,
        deliveryResult: {
          attempted: Boolean(decision.deliveryResult?.attempted),
          providerMessageCount: decision.deliveryResult?.providerMessageIds?.length ?? 0,
          errors: decision.deliveryResult?.errors ?? [],
        },
      })),
    });
  }
);

/**
 * GET /api/coach/dashboard?date=YYYY-MM-DD
 * Returns daily cards for each assigned athlete.
 */
router.get("/dashboard", async (req: Request, res: Response) => {
  if (!req.actor || req.actor.role !== "coach") {
    res.status(403).json({ error: "forbidden_role" });
    return;
  }
  const ids = assignedIdsFor(req);
  const start = strictDate(req.query.date, res);
  if (!start) return;
  const cards = await buildDailyCardsForAthletes(ids, start);
  res.json({
    date: start.toISOString().slice(0, 10),
    count: cards.length,
    cards,
  });
});

/**
 * GET /api/coach/athletes/:athleteId/daily-card?date=YYYY-MM-DD
 */
router.get(
  "/athletes/:athleteId/daily-card",
  requireAthleteAccess("athleteId"),
  async (req: Request, res: Response) => {
    const start = strictDate(req.query.date, res);
    if (!start) return;
    const card = await buildDailyCardForAthlete(
      new Types.ObjectId(req.params.athleteId),
      start
    );
    if (!card) {
      res.status(404).json({ error: "athlete_not_found" });
      return;
    }
    res.json({ card });
  }
);

/**
 * POST /api/coach/athletes/:athleteId/comment
 * body: { date?, body }
 * Coach writes a feedback comment visible to the athlete.
 */
router.post(
  "/athletes/:athleteId/comment",
  requireAthleteAccess("athleteId"),
  async (req: Request, res: Response) => {
    if (!req.actor) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if (!body) {
      res.status(400).json({ error: "body_required" });
      return;
    }
    const start = strictDate(req.body?.date, res);
    if (!start) return;
    const athleteId = new Types.ObjectId(req.params.athleteId);
    const created = await CoachComment.create({
      athleteId,
      coachId: req.actor.userId,
      date: start,
      body,
    });

    const [profile, coach] = await Promise.all([
      AthleteProfile.findById(athleteId).select("userId academyId").lean(),
      User.findById(req.actor.userId).select("name").lean(),
    ]);
    if (profile?.userId) {
      const recipientUserId = profile.userId as Types.ObjectId;
      const academyId = (profile.academyId as Types.ObjectId | undefined) ?? null;
      const { title, body: pushBody, link } = buildCoachFeedback({
        coachName: (coach?.name as string) || "your coach",
        preview: notificationPreview(body),
      });
      await createNotification({
        recipientUserId,
        type: "coach_feedback",
        title,
        body: pushBody,
        priority: "medium",
        link,
        academyId,
      });
      const timezone = await resolveTimezoneForUser({ userId: recipientUserId, role: "athlete" });
      await evaluateAndDispatch(
        {
          userId: recipientUserId,
          type: "coach_feedback",
          category: "messages",
          priorityTier: 2,
          dedupKey: `coach_feedback:${created._id.toString()}`,
          title,
          body: pushBody,
          link,
          academyId,
          entityRef: { collection: "CoachComment", id: created._id as Types.ObjectId },
          timezone,
        },
        { createInAppNotification: false }
      );
    }
    res.status(201).json({ comment: created.toObject() });
  }
);

/**
 * POST /api/coach/athletes/:athleteId/injuries
 * body: { bodyPart, description?, severity, restriction? }
 * Coach logs an injury for an assigned athlete and notifies assigned coaches
 * plus linked guardians. Severe injuries bypass quiet-hours/cap throttles.
 */
router.post(
  "/athletes/:athleteId/injuries",
  requireAthleteAccess("athleteId"),
  async (req: Request, res: Response) => {
    const bodyPart = strOrUndef(req.body?.bodyPart);
    if (!bodyPart) {
      res.status(400).json({ error: "body_part_required" });
      return;
    }
    const severity = req.body?.severity;
    if (!INJURY_SEVERITY.includes(severity)) {
      res.status(400).json({ error: "invalid_severity" });
      return;
    }
    const restriction = strOrUndef(req.body?.restriction);
    const athleteId = new Types.ObjectId(req.params.athleteId);
    const created = await Injury.create({
      athleteId,
      bodyPart,
      description: strOrUndef(req.body?.description),
      severity,
      restriction,
    });

    const [profile, assignedCoaches, guardians] = await Promise.all([
      AthleteProfile.findById(athleteId).select("userId academyId").lean(),
      CoachAthleteAssignment.find({ athleteId, endedAt: null }).select("coachId").lean(),
      GuardianAthleteLink.find({ athleteId, endedAt: null }).select("guardianId").lean(),
    ]);
    const athleteUser = profile?.userId
      ? await User.findById(profile.userId).select("name").lean()
      : null;
    const academyId = (profile?.academyId as Types.ObjectId | undefined) ?? null;
    const isSevere = severity === "severe";
    const { title, body: alertBody } = buildInjuryAlert({
      athleteName: (athleteUser?.name as string) || "An athlete",
      bodyPart,
      severity,
      restriction: restriction ?? null,
    });

    const coachLink = `/coach/athletes/${athleteId.toString()}`;
    await Promise.all(
      assignedCoaches.map(async (a) => {
        const coachUserId = a.coachId as Types.ObjectId;
        await createNotification({
          recipientUserId: coachUserId,
          type: "injury_alert",
          title,
          body: alertBody,
          priority: isSevere ? "high" : "medium",
          link: coachLink,
          academyId,
        });
        const timezone = await resolveTimezoneForUser({
          userId: coachUserId,
          role: "coach",
          academyId,
        });
        await evaluateAndDispatch(
          {
            userId: coachUserId,
            type: "injury_alert",
            category: "alerts",
            priorityTier: isSevere ? 1 : 2,
            dedupKey: `injury_alert:${created._id.toString()}:${coachUserId.toString()}`,
            title,
            body: alertBody,
            link: coachLink,
            academyId,
            entityRef: { collection: "Injury", id: created._id as Types.ObjectId },
            timezone,
            override: isSevere,
          },
          { createInAppNotification: false }
        );
      })
    );

    await Promise.all(
      guardians.map(async (g) => {
        const guardianUserId = g.guardianId as Types.ObjectId;
        await createNotification({
          recipientUserId: guardianUserId,
          type: "injury_alert",
          title,
          body: alertBody,
          priority: isSevere ? "high" : "medium",
          link: "/guardian/dashboard",
          academyId,
        });
        const timezone = await resolveTimezoneForUser({
          userId: guardianUserId,
          role: "guardian",
          academyId,
        });
        await evaluateAndDispatch(
          {
            userId: guardianUserId,
            type: "injury_alert",
            category: "alerts",
            priorityTier: isSevere ? 1 : 2,
            dedupKey: `injury_alert:${created._id.toString()}:${guardianUserId.toString()}`,
            title,
            body: alertBody,
            link: "/guardian/dashboard",
            academyId,
            entityRef: { collection: "Injury", id: created._id as Types.ObjectId },
            timezone,
            override: isSevere,
          },
          { createInAppNotification: false }
        );
      })
    );

    res.status(201).json({ injury: created.toObject() });
  }
);

/**
 * GET /api/coach/athletes/:athleteId/rpe-monitoring?date=YYYY-MM-DD
 * Returns AM/PM RPE entries for an assigned athlete on the given date.
 */
router.get(
  "/athletes/:athleteId/rpe-monitoring",
  requireAthleteAccess("athleteId"),
  async (req: Request, res: Response) => {
    const start = strictDate(req.query.date, res);
    if (!start) return;
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const entries = (
      await RpeMonitoring.find({
        athleteId: new Types.ObjectId(req.params.athleteId),
        date: { $gte: start, $lt: end },
      }).lean()
    ).sort(
      (a, b) =>
        SESSION_SLOT_ORDER[a.sessionType as SessionSlot] -
        SESSION_SLOT_ORDER[b.sessionType as SessionSlot]
    );
    res.json({
      date: start.toISOString().slice(0, 10),
      entries,
    });
  }
);

function strOrUndef(v: unknown): string | undefined {
  if (typeof v !== "string" || !v.trim()) return undefined;
  return v.trim();
}

/**
 * GET /api/coach/athletes/:athleteId/trends?days=7
 * Trailing per-day readiness / load series for an assigned athlete.
 */
router.get(
  "/athletes/:athleteId/trends",
  requireAthleteAccess("athleteId"),
  async (req: Request, res: Response) => {
    const days = clampDays(req.query.days);
    const series = await buildTrendSeries(
      new Types.ObjectId(req.params.athleteId),
      days
    );
    res.json({ days, series });
  }
);

/**
 * GET /api/coach/athletes/:athleteId/activity?limit=40
 * Recent-activity timeline for an assigned athlete.
 */
router.get(
  "/athletes/:athleteId/activity",
  requireAthleteAccess("athleteId"),
  async (req: Request, res: Response) => {
    const limit = clampLimit(req.query.limit);
    const items = await buildActivityFeed(new Types.ObjectId(req.params.athleteId), limit);
    res.json({ items });
  }
);

/**
 * Per-athlete analytics series for an assigned athlete (charts).
 *   GET /api/coach/athletes/:athleteId/analytics/{wellness,attendance,sessions,performance}
 */
router.get(
  "/athletes/:athleteId/analytics/wellness",
  requireAthleteAccess("athleteId"),
  async (req: Request, res: Response) => {
    const days = clampDays(req.query.days, 30, 90);
    res.json({ days, series: await buildWellnessSeries(new Types.ObjectId(req.params.athleteId), days) });
  }
);
router.get(
  "/athletes/:athleteId/analytics/water",
  requireAthleteAccess("athleteId"),
  async (req: Request, res: Response) => {
    const days = clampDays(req.query.days, 30, 90);
    res.json({ days, ...(await buildWaterSeries(new Types.ObjectId(req.params.athleteId), days)) });
  }
);
router.get(
  "/athletes/:athleteId/analytics/attendance",
  requireAthleteAccess("athleteId"),
  async (req: Request, res: Response) => {
    const days = clampDays(req.query.days, 30, 90);
    res.json({ days, ...(await buildAttendanceSeries(new Types.ObjectId(req.params.athleteId), days)) });
  }
);
router.get(
  "/athletes/:athleteId/analytics/sessions",
  requireAthleteAccess("athleteId"),
  async (req: Request, res: Response) => {
    const days = clampDays(req.query.days, 30, 90);
    res.json({ days, series: await buildSessionSeries(new Types.ObjectId(req.params.athleteId), days) });
  }
);
router.get(
  "/athletes/:athleteId/analytics/performance",
  requireAthleteAccess("athleteId"),
  async (req: Request, res: Response) => {
    const days = clampDays(req.query.days, 90, 90);
    const metric = typeof req.query.metric === "string" ? req.query.metric : undefined;
    res.json({ days, ...(await buildPerformanceSeries(new Types.ObjectId(req.params.athleteId), metric, days)) });
  }
);

/**
 * GET /api/coach/analytics/squad?days=30
 * Per-day rollup across THIS coach's assigned athletes only (avg readiness,
 * attendance rate, avg load, red-flag count). Scoped via assignedAthleteIds.
 */
router.get("/analytics/squad", async (req: Request, res: Response) => {
  if (!req.actor || req.actor.role !== "coach") {
    res.status(403).json({ error: "forbidden_role" });
    return;
  }
  const days = clampDays(req.query.days, 30, 90);
  res.json({ days, series: await buildSquadSeries(assignedIdsFor(req), days) });
});

/**
 * GET /api/coach/notes-inbox?days=14
 * Recent athlete notes across THIS coach's roster with a needs-reply flag +
 * openCount badge, so athlete→coach notes are discoverable (not buried in each
 * athlete's activity feed). Scoped via assignedAthleteIds.
 */
router.get("/notes-inbox", async (req: Request, res: Response) => {
  if (!req.actor || req.actor.role !== "coach") {
    res.status(403).json({ error: "forbidden_role" });
    return;
  }
  const days = clampDays(req.query.days, 14, 60);
  res.json({ days, ...(await buildCoachNotesInbox(assignedIdsFor(req), days)) });
});

/**
 * POST /api/coach/athletes/:athleteId/attendance
 * body: { date?, status, note? }
 * Coach records attendance for an assigned athlete (upsert per day).
 */
router.post(
  "/athletes/:athleteId/attendance",
  requireAthleteAccess("athleteId"),
  async (req: Request, res: Response) => {
    if (!req.actor) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const status = req.body?.status;
    if (!ATTENDANCE_STATUS.includes(status)) {
      res.status(400).json({ error: "invalid_status" });
      return;
    }
    const date = strictDate(req.body?.date, res);
    if (!date) return;
    const athleteId = new Types.ObjectId(req.params.athleteId);
    await Attendance.updateOne(
      { athleteId, date },
      {
        $set: {
          athleteId,
          date,
          status,
          note: strOrUndef(req.body?.note),
          recordedBy: req.actor.userId,
        },
      },
      { upsert: true, runValidators: true }
    );
    const saved = await Attendance.findOne({ athleteId, date }).lean();
    res.json({ attendance: saved });
  }
);

/**
 * POST /api/coach/athletes/:athleteId/training/:slot
 * body: { date?, type?, plan?, status?, durationMin?, intensityRpe?, notes? }
 * Coach owns the plan: type/plan/duration/intensity are coach-set here.
 */
router.post(
  "/athletes/:athleteId/training/:slot",
  requireAthleteAccess("athleteId"),
  async (req: Request, res: Response) => {
    if (!req.actor) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const slot = req.params.slot as (typeof SESSION_SLOTS)[number];
    if (!SESSION_SLOTS.includes(slot)) {
      res.status(400).json({ error: "invalid_slot" });
      return;
    }
    const b = req.body ?? {};
    if (b.status !== undefined && !SESSION_STATUS.includes(b.status)) {
      res.status(400).json({ error: "invalid_status" });
      return;
    }
    if (
      b.intensityRpe !== undefined &&
      b.intensityRpe !== null &&
      b.intensityRpe !== "" &&
      (typeof b.intensityRpe !== "number" ||
        Number.isNaN(b.intensityRpe) ||
        b.intensityRpe < 1 ||
        b.intensityRpe > 100)
    ) {
      res.status(400).json({ error: "invalid_intensityRpe" });
      return;
    }
    if (
      b.durationMin !== undefined &&
      b.durationMin !== null &&
      b.durationMin !== "" &&
      (typeof b.durationMin !== "number" ||
        Number.isNaN(b.durationMin) ||
        b.durationMin < 0)
    ) {
      res.status(400).json({ error: "invalid_durationMin" });
      return;
    }
    const date = strictDate(b.date, res);
    if (!date) return;
    const athleteId = new Types.ObjectId(req.params.athleteId);

    const $set: Record<string, unknown> = { coachId: req.actor.userId };
    if (b.status !== undefined) $set.status = b.status;
    const type = strOrUndef(b.type);
    if (type !== undefined) $set.type = type;
    if (b.plan !== undefined) $set.plan = b.plan;
    if (typeof b.durationMin === "number") $set.durationMin = b.durationMin;
    if (typeof b.intensityRpe === "number") $set.intensityRpe = b.intensityRpe;
    const notes = strOrUndef(b.notes);
    if (notes !== undefined) $set.notes = notes;

    await TrainingSession.updateOne(
      { athleteId, date, slot },
      { $set, $setOnInsert: { athleteId, date, slot } },
      { upsert: true, runValidators: true }
    );
    const saved = await TrainingSession.findOne({ athleteId, date, slot }).lean();
    res.json({ session: saved });
  }
);

function serializeSessionPhoto(p: {
  _id: Types.ObjectId;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt?: Date;
}) {
  return {
    id: p._id.toString(),
    originalName: p.originalName,
    mimeType: p.mimeType,
    sizeBytes: p.sizeBytes,
    uploadedAt: (p.uploadedAt ?? new Date()).toISOString(),
  };
}

/**
 * POST /api/coach/athletes/:athleteId/training/:slot/photos  multipart, field "file", body: { date }
 * Attaches a photo to a session's notes — visible to both sides immediately
 * (no send gate), matching the shared/no-gate `notes` field it sits next to.
 */
router.post(
  "/athletes/:athleteId/training/:slot/photos",
  writeRateLimit({ windowMs: 60_000, max: 20 }),
  requireAthleteAccess("athleteId"),
  (req: Request, res: Response, next) => {
    mediaUpload.single("file")(req, res, (err: unknown) => {
      if (!err) {
        next();
        return;
      }
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        res.status(400).json({ error: "file_too_large" });
        return;
      }
      res.status(400).json({ error: "unsupported_file_type" });
    });
  },
  async (req: Request, res: Response) => {
    const slot = req.params.slot as (typeof SESSION_SLOTS)[number];
    if (!SESSION_SLOTS.includes(slot)) {
      res.status(400).json({ error: "invalid_slot" });
      return;
    }
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "file_required" });
      return;
    }
    const date = strictDate(req.body?.date, res);
    if (!date) {
      await fs.promises.unlink(file.path).catch(() => undefined);
      return;
    }
    const athleteId = new Types.ObjectId(req.params.athleteId);
    const photo = {
      _id: new Types.ObjectId(),
      storedFilename: file.filename,
      originalName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      uploadedAt: new Date(),
    };
    await TrainingSession.updateOne(
      { athleteId, date, slot },
      { $push: { photos: photo }, $setOnInsert: { athleteId, date, slot } },
      { upsert: true, runValidators: true }
    );
    res.status(201).json({ photo: serializeSessionPhoto(photo) });
  }
);

/** GET /api/coach/athletes/:athleteId/training/:slot/photos/:photoId/file — streams the raw image bytes. */
router.get(
  "/athletes/:athleteId/training/:slot/photos/:photoId/file",
  requireAthleteAccess("athleteId"),
  async (req: Request, res: Response) => {
    const athleteId = new Types.ObjectId(req.params.athleteId);
    const session = await TrainingSession.findOne(
      { athleteId, "photos._id": req.params.photoId },
      { "photos.$": 1 }
    ).lean();
    const photo = session?.photos?.[0];
    if (!photo) {
      res.status(404).json({ error: "photo_not_found" });
      return;
    }
    const filePath = mediaFilePath(photo);
    res.type(photo.mimeType);
    res.setHeader("Cache-Control", "private, max-age=0, no-store");
    res.sendFile(filePath, (err) => {
      if (err && !res.headersSent) {
        res.status(404).json({ error: "file_missing" });
      }
    });
  }
);

/**
 * POST /api/coach/athletes/:athleteId/performance
 * body: { date?, metric, value, unit, context? }
 * Append-only performance entry for an assigned athlete.
 */
router.post(
  "/athletes/:athleteId/performance",
  requireAthleteAccess("athleteId"),
  async (req: Request, res: Response) => {
    const b = req.body ?? {};
    const metric = strOrUndef(b.metric);
    if (!metric) {
      res.status(400).json({ error: "invalid_metric" });
      return;
    }
    if (typeof b.value !== "number" || Number.isNaN(b.value)) {
      res.status(400).json({ error: "invalid_value" });
      return;
    }
    const unit = strOrUndef(b.unit);
    if (!unit) {
      res.status(400).json({ error: "invalid_unit" });
      return;
    }
    const date = strictDate(b.date, res);
    if (!date) return;
    const created = await Performance.create({
      athleteId: new Types.ObjectId(req.params.athleteId),
      date,
      metric,
      value: b.value,
      unit,
      context: strOrUndef(b.context),
    });
    res.status(201).json({ performance: created.toObject() });
  }
);

/**
 * GET /api/coach/athletes/:athleteId/performance?metric=&limit=
 * Recent performance history for an assigned athlete.
 */
router.get(
  "/athletes/:athleteId/performance",
  requireAthleteAccess("athleteId"),
  async (req: Request, res: Response) => {
    const filter: Record<string, unknown> = {
      athleteId: new Types.ObjectId(req.params.athleteId),
    };
    const metric = strOrUndef(req.query.metric);
    if (metric) filter.metric = metric;
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const entries = await Performance.find(filter)
      .sort({ date: -1 })
      .limit(limit)
      .lean();
    res.json({ entries });
  }
);

/**
 * Coach image upload — a coach can upload an image tied to one assigned
 * athlete (context: athlete / workout / training_plan), later send the raw
 * image to that athlete, and/or convert it into a structured workout table
 * via the (currently mock) OCR/vision adapter in services/workoutImageConverter.
 *
 * Every media row carries its own athleteId AND coachId, so access to a
 * media-id-scoped route (get/file/send/convert below) is gated on BOTH
 * `doc.coachId` matching the actor (mirrors the Message-thread ownership
 * pattern) AND the athlete still being in the coach's current assignments —
 * ending an assignment immediately cuts off a coach's access to that
 * athlete's media, consistent with the rest of the coach-scope invariant.
 */
async function loadOwnedMedia(
  req: Request,
  res: Response
): Promise<HydratedDocument<WorkoutMediaDoc> | null> {
  const raw = req.params.mediaId;
  if (!raw || !Types.ObjectId.isValid(raw)) {
    res.status(400).json({ error: "invalid_media_id" });
    return null;
  }
  const media = await WorkoutMedia.findById(raw);
  if (!media) {
    res.status(404).json({ error: "media_not_found" });
    return null;
  }
  if (!req.actor || !media.coachId.equals(req.actor.userId)) {
    res.status(403).json({ error: "not_media_owner" });
    return null;
  }
  const assigned = req.actor.assignedAthleteIds ?? [];
  if (!assigned.some((id) => id.equals(media.athleteId as Types.ObjectId))) {
    res.status(403).json({ error: "not_in_assignments" });
    return null;
  }
  return media;
}

/** POST /api/coach/athletes/:athleteId/media — multipart upload, field name "file". */
router.post(
  "/athletes/:athleteId/media",
  writeRateLimit({ windowMs: 60_000, max: 20 }),
  requireAthleteAccess("athleteId"),
  (req: Request, res: Response, next) => {
    mediaUpload.single("file")(req, res, (err: unknown) => {
      if (!err) {
        next();
        return;
      }
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        res.status(400).json({ error: "file_too_large" });
        return;
      }
      res.status(400).json({ error: "unsupported_file_type" });
    });
  },
  async (req: Request, res: Response) => {
    if (!req.actor) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "file_required" });
      return;
    }
    const context = req.body?.context;
    if (!MEDIA_CONTEXTS.includes(context)) {
      await fs.promises.unlink(file.path).catch(() => undefined);
      res.status(400).json({ error: "invalid_context" });
      return;
    }
    const created = await WorkoutMedia.create({
      coachId: req.actor.userId,
      athleteId: new Types.ObjectId(req.params.athleteId),
      academyId: req.actor.academyId ?? null,
      context,
      originalName: file.originalname,
      storedFilename: file.filename,
      mimeType: file.mimetype,
      sizeBytes: file.size,
    });
    res.status(201).json({ media: serializeMedia(created) });
  }
);

/** GET /api/coach/athletes/:athleteId/media — this coach's uploads for one assigned athlete. */
router.get(
  "/athletes/:athleteId/media",
  requireAthleteAccess("athleteId"),
  async (req: Request, res: Response) => {
    if (!req.actor) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const rows = await WorkoutMedia.find({
      coachId: req.actor.userId,
      athleteId: new Types.ObjectId(req.params.athleteId),
    })
      .sort({ createdAt: -1 })
      .lean<WorkoutMediaDoc[]>();
    res.json({ media: rows.map((m) => serializeMedia(m as WorkoutMediaDoc)) });
  }
);

/** GET /api/coach/media/:mediaId — one media's metadata (incl. conversion table). */
router.get("/media/:mediaId", async (req: Request, res: Response) => {
  const media = await loadOwnedMedia(req, res);
  if (!media) return;
  res.json({ media: serializeMedia(media) });
});

/** GET /api/coach/media/:mediaId/file — streams the raw image bytes. */
router.get("/media/:mediaId/file", async (req: Request, res: Response) => {
  const media = await loadOwnedMedia(req, res);
  if (!media) return;
  const filePath = mediaFilePath(media);
  res.type(media.mimeType);
  res.setHeader("Cache-Control", "private, max-age=0, no-store");
  res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: "file_missing" });
    }
  });
});

/**
 * POST /api/coach/media/:mediaId/send — shares the raw image with the
 * athlete AND posts it into the coach⇄athlete chat thread (optional
 * `caption` body text rides along on the same message).
 */
router.post(
  "/media/:mediaId/send",
  writeRateLimit({ windowMs: 60_000, max: 40 }),
  async (req: Request, res: Response) => {
    if (!req.actor) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const media = await loadOwnedMedia(req, res);
    if (!media) return;
    const caption = reqStr(req.body?.caption);
    if (caption.length > 4000) {
      res.status(400).json({ error: "message_too_long" });
      return;
    }
    const updated = await markMediaSent(media);
    const { message } = await sendMessage({
      coachId: req.actor.userId,
      athleteId: updated.athleteId as Types.ObjectId,
      senderRole: "coach",
      body: caption,
      mediaId: updated._id,
    });
    res.json({ media: serializeMedia(updated), message: messageView(message, "coach", updated) });
  }
);

/** POST /api/coach/media/:mediaId/convert — runs the workout-image → table conversion. */
router.post(
  "/media/:mediaId/convert",
  writeRateLimit({ windowMs: 60_000, max: 20 }),
  async (req: Request, res: Response) => {
    const media = await loadOwnedMedia(req, res);
    if (!media) return;
    const updated = await convertMediaToTable(media);
    res.json({ media: serializeMedia(updated) });
  }
);

/**
 * PATCH /api/coach/media/:mediaId/table — body: { table: WorkoutTableRow[] }.
 * Lets the coach correct/fill in the extracted table before sending (e.g.
 * the source image had no explicit sets/reps for some rows). Rejected once
 * the media has already been sent — the athlete has seen it, so it's frozen.
 */
router.patch(
  "/media/:mediaId/table",
  writeRateLimit({ windowMs: 60_000, max: 60 }),
  async (req: Request, res: Response) => {
    const media = await loadOwnedMedia(req, res);
    if (!media) return;
    if (!Array.isArray(req.body?.table)) {
      res.status(400).json({ error: "table_required" });
      return;
    }
    try {
      const updated = await updateMediaTable(media, req.body.table);
      res.json({ media: serializeMedia(updated) });
    } catch (err) {
      if ((err as Error).message === "already_sent") {
        res.status(409).json({ error: "already_sent" });
        return;
      }
      throw err;
    }
  }
);

export default router;
