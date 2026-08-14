import { Types } from "mongoose";
import { env } from "../config/env";
import { User, type UserRole } from "../models/User";
import { AthleteProfile } from "../models/AthleteProfile";
import { CoachAthleteAssignment } from "../models/CoachAthleteAssignment";
import { Attendance } from "../models/Attendance";
import { Wellness } from "../models/Wellness";
import { TrainingSession, type SessionSlot } from "../models/TrainingSession";
import { RpeMonitoring, type RpeSessionType } from "../models/RpeMonitoring";
import { WaterIntake } from "../models/WaterIntake";
import { AthleteNote } from "../models/AthleteNote";
import { CoachComment } from "../models/CoachComment";
import { dayRange } from "./dashboard";
import { buildTrendSeries } from "./trends";
import { buildAthleteAchievements } from "./achievements";
import { resolveTimezoneForUser, safeTimezone, minuteOfDayInZone } from "./timezone";
import { resolvePeriodAnchor, periodIndex } from "./notificationCycle";
import * as templates from "./notificationTemplates";
import {
  evaluateAndDispatch,
  loadSendBudget,
  type NotificationCandidate,
  type SendBudget,
} from "./notificationEligibility";

async function athleteNameMap(athleteIds: Types.ObjectId[]): Promise<Map<string, string>> {
  if (athleteIds.length === 0) return new Map();
  const profiles = await AthleteProfile.find({ _id: { $in: athleteIds } })
    .select("_id userId")
    .lean();
  const users = await User.find({ _id: { $in: profiles.map((p) => p.userId) } })
    .select("_id name")
    .lean();
  const nameByUser = new Map(users.map((u) => [u._id.toString(), u.name as string]));
  return new Map(
    profiles.map((p) => [
      p._id.toString(),
      nameByUser.get((p.userId as Types.ObjectId).toString()) ?? "Athlete",
    ])
  );
}

/**
 * Candidates for one athlete. Day-keyed dedup/"already completed" checks
 * deliberately use the SAME UTC-midnight bucket (`dayRange`) that Wellness/
 * TrainingSession/RpeMonitoring are already keyed by elsewhere in this app —
 * NOT the athlete's local calendar date — so a check-in logged via the
 * existing endpoints is recognized as "done" with zero risk of a local-date/
 * UTC-date mismatch. The athlete's resolved timezone is used ONLY to decide
 * WHEN (clock-time) a reminder is due, via minuteOfDayInZone.
 */
export async function buildAthleteCandidates(
  user: { _id: Types.ObjectId; academyId?: Types.ObjectId | null },
  now: Date
): Promise<NotificationCandidate[]> {
  const profile = await AthleteProfile.findOne({ userId: user._id })
    .select("_id timezone academyId hydrationGoalMl")
    .lean();
  if (!profile) return [];

  const tz = safeTimezone(profile.timezone as string | undefined);
  const minute = minuteOfDayInZone(now, tz);
  const today = dayRange(now).start;
  const todayEnd = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const dateKey = today.toISOString().slice(0, 10);
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayKey = yesterday.toISOString().slice(0, 10);
  const academyId = (profile.academyId as Types.ObjectId | undefined) ?? user.academyId ?? null;

  const candidates: NotificationCandidate[] = [];

  if (minute >= env.notification.dailyCheckinReminderMinute) {
    candidates.push({
      userId: user._id,
      type: "daily_checkin_reminder",
      category: "reminders",
      priorityTier: 2,
      dedupKey: `daily_checkin_reminder:${user._id.toString()}:${dateKey}`,
      timezone: tz,
      academyId,
      ...templates.buildDailyCheckinReminder(),
      isActionAlreadyCompleted: async () =>
        Boolean(
          await Wellness.exists({ athleteId: profile._id, date: { $gte: today, $lt: todayEnd } })
        ),
    });
  }

  const sessionSlots: { slot: SessionSlot; minute: number }[] = [
    { slot: "AM", minute: env.notification.trainingSessionReminderAmMinute },
    { slot: "AFT", minute: env.notification.trainingSessionReminderAftMinute },
    { slot: "PM", minute: env.notification.trainingSessionReminderPmMinute },
  ];
  for (const { slot, minute: threshold } of sessionSlots) {
    if (minute < threshold) continue;
    candidates.push({
      userId: user._id,
      type: "training_session_reminder",
      category: "reminders",
      priorityTier: 2,
      dedupKey: `training_session_reminder:${user._id.toString()}:${slot}:${dateKey}`,
      timezone: tz,
      academyId,
      ...templates.buildTrainingSessionReminder({ slot }),
      isActionAlreadyCompleted: async () => {
        const session = await TrainingSession.findOne({
          athleteId: profile._id,
          date: { $gte: today, $lt: todayEnd },
          slot,
        })
          .select("status")
          .lean();
        if (!session) return true; // nothing planned for this slot — nothing to remind about
        return ["completed", "skipped", "rest"].includes(session.status as string);
      },
    });
  }

  const rpeSlots: { sessionType: RpeSessionType; minute: number }[] = [
    { sessionType: "AM", minute: env.notification.rpeMonitoringReminderAmMinute },
    { sessionType: "AFT", minute: env.notification.rpeMonitoringReminderAftMinute },
    { sessionType: "PM", minute: env.notification.rpeMonitoringReminderPmMinute },
  ];
  for (const { sessionType, minute: threshold } of rpeSlots) {
    if (minute < threshold) continue;
    candidates.push({
      userId: user._id,
      type: "rpe_monitoring_reminder",
      category: "reminders",
      priorityTier: 2,
      dedupKey: `rpe_monitoring_reminder:${user._id.toString()}:${sessionType}:${dateKey}`,
      timezone: tz,
      academyId,
      ...templates.buildRpeMonitoringReminder({ slot: sessionType }),
      isActionAlreadyCompleted: async () =>
        Boolean(
          await RpeMonitoring.exists({
            athleteId: profile._id,
            date: { $gte: today, $lt: todayEnd },
            sessionType,
          })
        ),
    });
  }

  // Hydration reminders are Apex/system-owned reminders, not coach messages.
  if (minute >= env.notification.hydrationReminderMinute) {
    candidates.push({
      userId: user._id,
      type: "hydration_reminder",
      category: "reminders",
      priorityTier: 2,
      dedupKey: `hydration_reminder:${user._id.toString()}:${dateKey}`,
      timezone: tz,
      academyId,
      ...templates.buildHydrationReminder(),
      isActionAlreadyCompleted: async () => {
        const entries = await WaterIntake.find({
          athleteId: profile._id,
          date: { $gte: today, $lt: todayEnd },
        })
          .select("amountMl")
          .lean();
        const totalMl = entries.reduce((sum, entry) => sum + (entry.amountMl as number), 0);
        const goalMl = (profile.hydrationGoalMl as number | undefined) ?? 3000;
        return totalMl >= goalMl;
      },
    });
  }

  if (minute >= env.notification.missedActivityReminderMinute) {
    const missedSessionQuery = {
      athleteId: profile._id,
      date: { $gte: yesterday, $lt: today },
      status: { $nin: ["completed", "skipped", "rest"] },
    };
    const missedCount = await TrainingSession.countDocuments(missedSessionQuery);
    if (missedCount > 0) {
      candidates.push({
        userId: user._id,
        type: "missed_activity_reminder",
        category: "reminders",
        priorityTier: 3,
        dedupKey: `missed_activity_reminder:${user._id.toString()}:${yesterdayKey}`,
        timezone: tz,
        academyId,
        ...templates.buildMissedActivityReminder({ count: missedCount }),
        isActionAlreadyCompleted: async () =>
          (await TrainingSession.countDocuments(missedSessionQuery)) === 0,
      });
    }
  }

  // Streak milestones reuse the existing achievements.ts streak concept.
  // Dedup is anchored to the streak's START date (today - (currentStreak-1)
  // days): the key stays the same every day the streak continues (so no
  // repeat notification while it's held), but changes once it breaks and a
  // later run reaches the same target again.
  const achievements = await buildAthleteAchievements(profile._id, 60, today);
  for (const goal of achievements.goals) {
    if (goal.currentStreak >= goal.target && goal.currentStreak > 0) {
      const streakStart = new Date(today.getTime() - (goal.currentStreak - 1) * 24 * 60 * 60 * 1000);
      const streakStartKey = streakStart.toISOString().slice(0, 10);
      candidates.push({
        userId: user._id,
        type: "streak_milestone",
        category: "milestones",
        priorityTier: 6,
        dedupKey: `streak_milestone:${profile._id.toString()}:${goal.key}:${streakStartKey}`,
        timezone: tz,
        academyId,
        ...templates.buildStreakMilestone({
          goalTitle: goal.title,
          badgeLabel: goal.reward.badgeLabel,
          streakCount: goal.currentStreak,
        }),
      });
    }
  }

  // Weekly digest — personalized rolling period anchored to the athlete's own
  // join date (see notificationCycle.ts), not a shared calendar week.
  if (minute >= env.notification.weeklySummaryMinute) {
    const anchor = await resolvePeriodAnchor({
      userId: user._id,
      role: "athlete",
      athleteProfileId: profile._id,
    });
    const period = periodIndex(now, anchor, 7, tz);
    const weekStart = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
    const [checkins, sessions, series] = await Promise.all([
      Wellness.countDocuments({ athleteId: profile._id, date: { $gte: weekStart, $lt: todayEnd } }),
      TrainingSession.countDocuments({
        athleteId: profile._id,
        date: { $gte: weekStart, $lt: todayEnd },
        $or: [{ status: "completed" }, { attended: true }],
      }),
      buildTrendSeries(profile._id, 7, today),
    ]);
    const readinessValues = series
      .map((s) => s.readiness)
      .filter((r): r is number => typeof r === "number");
    const readinessAvg = readinessValues.length
      ? Math.round(readinessValues.reduce((a, r) => a + r, 0) / readinessValues.length)
      : null;
    candidates.push({
      userId: user._id,
      type: "athlete_weekly_summary",
      category: "digests",
      priorityTier: 5,
      dedupKey: `athlete_weekly_summary:${user._id.toString()}:w${period}`,
      timezone: tz,
      academyId,
      ...templates.buildAthleteWeeklySummary({ checkins, sessions, readinessAvg }),
    });
  }

  return candidates;
}

export async function buildCoachCandidates(
  user: { _id: Types.ObjectId; academyId?: Types.ObjectId | null },
  now: Date
): Promise<NotificationCandidate[]> {
  const tz = await resolveTimezoneForUser({
    userId: user._id,
    role: "coach",
    academyId: user.academyId ?? null,
  });
  const minute = minuteOfDayInZone(now, tz);
  const today = dayRange(now).start;
  const todayEnd = new Date(today.getTime() + 24 * 60 * 60 * 1000);

  const assignments = await CoachAthleteAssignment.find({ coachId: user._id, endedAt: null })
    .select("athleteId")
    .lean();
  const athleteIds = assignments.map((a) => a.athleteId as Types.ObjectId);
  if (athleteIds.length === 0) return [];

  const candidates: NotificationCandidate[] = [];

  // Notes still unanswered after the configured window (best-effort "answered"
  // signal: any CoachComment for that athlete created after the note — there's
  // no direct reply-to-note link in the schema).
  const cutoff = new Date(now.getTime() - env.notification.noteNeedsReplyHours * 60 * 60 * 1000);
  const staleNotes = await AthleteNote.find({
    athleteId: { $in: athleteIds },
    createdAt: { $lte: cutoff },
  })
    .select("_id athleteId createdAt")
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  if (staleNotes.length > 0) {
    const names = await athleteNameMap(athleteIds);
    for (const note of staleNotes) {
      const athleteId = note.athleteId as Types.ObjectId;
      candidates.push({
        userId: user._id,
        type: "note_needs_reply",
        category: "deadlines",
        priorityTier: 3,
        dedupKey: `note_needs_reply:${(note._id as Types.ObjectId).toString()}:${user._id.toString()}`,
        timezone: tz,
        academyId: user.academyId ?? null,
        entityRef: { collection: "AthleteNote", id: note._id as Types.ObjectId },
        ...templates.buildNoteNeedsReply({
          athleteName: names.get(athleteId.toString()) ?? "An athlete",
          hours: env.notification.noteNeedsReplyHours,
        }),
        link: `/coach/athletes/${athleteId.toString()}`,
        isActionAlreadyCompleted: async () =>
          Boolean(
            await CoachComment.exists({
              athleteId,
              coachId: user._id,
              createdAt: { $gt: note.createdAt as Date },
            })
          ),
      });
    }
  }

  if (minute >= env.notification.squadDigestMinute) {
    const anchor = await resolvePeriodAnchor({ userId: user._id, role: "coach" });
    const period = periodIndex(now, anchor, 7, tz);
    const weekStart = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
    const [presentCount, flaggedCount] = await Promise.all([
      Attendance.countDocuments({
        athleteId: { $in: athleteIds },
        date: { $gte: weekStart, $lt: todayEnd },
        status: "present",
      }),
      RpeMonitoring.countDocuments({
        athleteId: { $in: athleteIds },
        date: { $gte: weekStart, $lt: todayEnd },
        riskFlag: { $ne: "green" },
      }),
    ]);
    candidates.push({
      userId: user._id,
      type: "coach_squad_digest",
      category: "digests",
      priorityTier: 5,
      dedupKey: `coach_squad_digest:${user._id.toString()}:w${period}`,
      timezone: tz,
      academyId: user.academyId ?? null,
      ...templates.buildCoachSquadDigest({
        presentCount,
        totalSlots: athleteIds.length * 7,
        flaggedCount,
      }),
    });
  }

  return candidates;
}

async function processUser(
  user: { _id: Types.ObjectId; role: UserRole; academyId?: Types.ObjectId | null },
  now: Date
): Promise<{ sent: number; suppressed: number }> {
  const candidates =
    user.role === "athlete"
      ? await buildAthleteCandidates(user, now)
      : await buildCoachCandidates(user, now);
  if (candidates.length === 0) return { sent: 0, suppressed: 0 };

  candidates.sort((a, b) => a.priorityTier - b.priorityTier);

  const localDayStart = new Date(now);
  localDayStart.setUTCHours(0, 0, 0, 0);
  const budget: SendBudget = await loadSendBudget(user._id, localDayStart);

  let sent = 0;
  let suppressed = 0;
  for (const candidate of candidates) {
    const outcome = await evaluateAndDispatch(candidate, { budget, now });
    if (outcome === "sent") sent += 1;
    if (outcome === "suppressed") suppressed += 1;
  }
  return { sent, suppressed };
}

export type SweepResult = {
  pagesRun: number;
  usersProcessed: number;
  decisionsSent: number;
  decisionsSuppressed: number;
  nextCursor: string | null;
};

/**
 * Pages through active athletes/coaches (plain _id-cursor pagination), builds
 * each user's sweep-driven candidate list, and dispatches through the decision
 * engine. Bounded by `pages` per call so one HTTP request can't try to drain
 * the whole user base inside Cloud Run's request timeout — the scheduler
 * calling this every 15-30 min gradually covers everyone. `now` defaults to
 * the real clock; tests inject a fixed value to make time-of-day-gated
 * candidates (daily_checkin_reminder, digests, ...) deterministic.
 */
export async function runSweep(params: {
  limit: number;
  pages: number;
  cursor: Types.ObjectId | null;
  now?: Date;
}): Promise<SweepResult> {
  const now = params.now ?? new Date();
  let cursor = params.cursor;
  let pagesRun = 0;
  let usersProcessed = 0;
  let decisionsSent = 0;
  let decisionsSuppressed = 0;

  for (let page = 0; page < params.pages; page++) {
    const filter: Record<string, unknown> = {
      role: { $in: ["athlete", "coach"] },
      isActive: true,
      ...(cursor ? { _id: { $gt: cursor } } : {}),
    };
    const users = await User.find(filter)
      .sort({ _id: 1 })
      .limit(params.limit)
      .select("_id role academyId")
      .lean();
    pagesRun += 1;
    if (users.length === 0) {
      cursor = null;
      break;
    }

    for (const user of users) {
      usersProcessed += 1;
      const outcome = await processUser(
        {
          _id: user._id as Types.ObjectId,
          role: user.role as UserRole,
          academyId: (user.academyId as Types.ObjectId | undefined) ?? null,
        },
        now
      );
      decisionsSent += outcome.sent;
      decisionsSuppressed += outcome.suppressed;
    }

    cursor = users[users.length - 1]._id as Types.ObjectId;
    if (users.length < params.limit) {
      cursor = null;
      break;
    }
  }

  return {
    pagesRun,
    usersProcessed,
    decisionsSent,
    decisionsSuppressed,
    nextCursor: cursor ? cursor.toString() : null,
  };
}
