import { Types } from "mongoose";
import { CoachAvailability } from "../models/CoachAvailability";
import { CoachAvailabilityException } from "../models/CoachAvailabilityException";
import { CoachSession, type CoachSessionStatus } from "../models/CoachSession";
import { zonedMinuteToUtc } from "./timezone";

export type AvailabilityWindow = {
  startMinute: number;
  endMinute: number;
  timezone: string;
  sessionDurationMin: number;
  bufferMin: number;
};

export type TimeRange = { start: Date; end: Date };

const ACTIVE_SESSION_STATUSES: CoachSessionStatus[] = ["requested", "confirmed", "rescheduled"];

function subtractRange(windows: AvailabilityWindow[], exStart: number, exEnd: number): AvailabilityWindow[] {
  const result: AvailabilityWindow[] = [];
  for (const w of windows) {
    if (exEnd <= w.startMinute || exStart >= w.endMinute) {
      result.push(w);
      continue;
    }
    if (exStart > w.startMinute) result.push({ ...w, endMinute: exStart });
    if (exEnd < w.endMinute) result.push({ ...w, startMinute: exEnd });
  }
  return result;
}

/**
 * Resolves the coach's availability windows (post-exception) for a single
 * calendar date, given as a UTC-midnight-anchored Date (dayRange convention)
 * — the caller already knows which calendar date it means (either an
 * athlete browsing a specific day, or a candidate date being probed by
 * isWithinAvailability below); this function never guesses a date from a
 * timezone.
 */
export async function resolveWindowsForDate(coachId: Types.ObjectId, dayStart: Date): Promise<AvailabilityWindow[]> {
  const dayOfWeek = dayStart.getUTCDay();
  const exception = await CoachAvailabilityException.findOne({ coachId, date: dayStart }).lean();

  if (exception?.type === "unavailable" && exception.startMinute == null) {
    return [];
  }

  let windows: AvailabilityWindow[];
  if (exception?.type === "custom_hours") {
    const anyRule = await CoachAvailability.findOne({ coachId }).sort({ dayOfWeek: 1 }).lean();
    windows = [
      {
        startMinute: exception.startMinute as number,
        endMinute: exception.endMinute as number,
        timezone: anyRule?.timezone ?? "UTC",
        sessionDurationMin: anyRule?.sessionDurationMin ?? 30,
        bufferMin: anyRule?.bufferMin ?? 0,
      },
    ];
  } else {
    const rules = await CoachAvailability.find({ coachId, dayOfWeek }).lean();
    windows = rules.map((r) => ({
      startMinute: r.startMinute,
      endMinute: r.endMinute,
      timezone: r.timezone,
      sessionDurationMin: r.sessionDurationMin,
      bufferMin: r.bufferMin ?? 0,
    }));
  }

  if (exception?.type === "unavailable" && exception.startMinute != null && exception.endMinute != null) {
    windows = subtractRange(windows, exception.startMinute, exception.endMinute);
  }

  return windows;
}

function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * The effective daily session cap for a coach on a given calendar date's day
 * of week — the MINIMUM of every non-null `maxSessionsPerDay` set across that
 * day's recurring CoachAvailability rules (conservative: a coach who sets a
 * cap on any one of several same-day rules means it to apply day-wide). Null
 * = uncapped (no rule sets one, the default and existing behavior).
 * Deliberately scoped to the recurring rules only, not availability
 * exceptions — an exception's `custom_hours` reuses "any rule" for its
 * duration/buffer defaults the same way (see resolveWindowsForDate above).
 */
export async function resolveMaxSessionsPerDay(coachId: Types.ObjectId, dayStart: Date): Promise<number | null> {
  const dayOfWeek = dayStart.getUTCDay();
  const rules = await CoachAvailability.find({ coachId, dayOfWeek }).select("maxSessionsPerDay").lean();
  const caps = rules.map((r) => r.maxSessionsPerDay).filter((n): n is number => typeof n === "number");
  return caps.length > 0 ? Math.min(...caps) : null;
}

/** Count of the coach's active-status sessions scheduled on one calendar date. */
export async function countSessionsForCoachOnDate(coachId: Types.ObjectId, dayStart: Date): Promise<number> {
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  return CoachSession.countDocuments({
    coachId,
    status: { $in: ACTIVE_SESSION_STATUSES },
    scheduledStart: { $gte: dayStart, $lt: dayEnd },
  });
}

/** Discretized bookable slot options for a given calendar date — for the athlete's "pick a time" UI. */
export async function resolveAvailableSlots(coachId: Types.ObjectId, dayStart: Date): Promise<TimeRange[]> {
  const dateString = dayStart.toISOString().slice(0, 10);
  const windows = await resolveWindowsForDate(coachId, dayStart);
  if (windows.length === 0) return [];

  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const existing = await CoachSession.find({
    coachId,
    status: { $in: ACTIVE_SESSION_STATUSES },
    scheduledStart: { $lt: dayEnd },
    scheduledEnd: { $gt: dayStart },
  })
    .select("scheduledStart scheduledEnd bufferMin")
    .lean();

  const slots: TimeRange[] = [];
  for (const w of windows) {
    for (let m = w.startMinute; m + w.sessionDurationMin <= w.endMinute; m += w.sessionDurationMin) {
      const slotStart = zonedMinuteToUtc(dateString, m, w.timezone);
      const slotEnd = new Date(slotStart.getTime() + w.sessionDurationMin * 60_000);
      const paddedStart = new Date(slotStart.getTime() - w.bufferMin * 60_000);
      const paddedEnd = new Date(slotEnd.getTime() + w.bufferMin * 60_000);
      const conflicts = existing.some((e) => {
        const eStart = new Date(e.scheduledStart.getTime() - e.bufferMin * 60_000);
        const eEnd = new Date(e.scheduledEnd.getTime() + e.bufferMin * 60_000);
        return rangesOverlap(paddedStart, paddedEnd, eStart, eEnd);
      });
      if (!conflicts) slots.push({ start: slotStart, end: slotEnd });
    }
  }
  slots.sort((a, b) => a.start.getTime() - b.start.getTime());

  // maxSessionsPerDay caps TOTAL bookable sessions that day, already-booked
  // ones included — trim the remaining offerable slots to what's left.
  const cap = await resolveMaxSessionsPerDay(coachId, dayStart);
  if (cap != null) {
    const alreadyBooked = await countSessionsForCoachOnDate(coachId, dayStart);
    const remaining = Math.max(0, cap - alreadyBooked);
    return slots.slice(0, remaining);
  }
  return slots;
}

/**
 * Validates a specific requested [scheduledStart, scheduledEnd) against the
 * coach's availability windows — used at actual booking time, independent
 * of whether the client's chosen start matches a resolveAvailableSlots
 * discretization exactly (arbitrary starts within a window are allowed as
 * long as a full session's worth of window remains). Tries the UTC calendar
 * date of scheduledStart plus its neighbors, since a timezone conversion can
 * shift which local calendar date a window belongs to.
 */
export async function findMatchingWindow(
  coachId: Types.ObjectId,
  scheduledStart: Date
): Promise<(AvailabilityWindow & { scheduledEnd: Date }) | null> {
  const baseDayMs = Date.UTC(scheduledStart.getUTCFullYear(), scheduledStart.getUTCMonth(), scheduledStart.getUTCDate());
  for (const offsetDays of [0, -1, 1]) {
    const dayStart = new Date(baseDayMs + offsetDays * 24 * 60 * 60 * 1000);
    const dateString = dayStart.toISOString().slice(0, 10);
    const windows = await resolveWindowsForDate(coachId, dayStart);
    for (const w of windows) {
      const windowStartUtc = zonedMinuteToUtc(dateString, w.startMinute, w.timezone);
      const windowEndUtc = zonedMinuteToUtc(dateString, w.endMinute, w.timezone);
      const candidateEnd = new Date(scheduledStart.getTime() + w.sessionDurationMin * 60_000);
      if (scheduledStart >= windowStartUtc && candidateEnd <= windowEndUtc) {
        return { ...w, scheduledEnd: candidateEnd };
      }
    }
  }
  return null;
}
