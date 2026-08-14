import { Types } from "mongoose";
import {
  TrainingSession,
  SESSION_SLOT_LABELS,
  type SessionSlot,
} from "../models/TrainingSession";
import { RpeMonitoring } from "../models/RpeMonitoring";

/** Human label for a slot ("AFT" → "Afternoon"); falls back to the raw value. */
function slotLabel(slot: unknown): string {
  return SESSION_SLOT_LABELS[slot as SessionSlot] ?? String(slot ?? "");
}
import { Attendance } from "../models/Attendance";
import { Recovery } from "../models/Recovery";
import { CoachComment } from "../models/CoachComment";
import { AthleteNote } from "../models/AthleteNote";
import { Performance } from "../models/Performance";
import { Injury } from "../models/Injury";

export type FeedKind =
  | "session"
  | "rpe"
  | "attendance"
  | "recovery"
  | "comment"
  | "note"
  | "performance"
  | "injury";

export type Band = "green" | "amber" | "red";

export type FeedItem = {
  id: string;
  at: string; // ISO timestamp
  kind: FeedKind;
  title: string;
  detail?: string;
  band?: Band;
};

export function clampLimit(input: unknown, fallback = 40, max = 100): number {
  const n = Number(input);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), 1), max);
}

/** Pulls the first present date-ish field and returns it as an ISO string. */
function whenOf(doc: Record<string, unknown>, fields: string[]): string {
  for (const f of fields) {
    const v = doc[f];
    if (v) return new Date(v as string | number | Date).toISOString();
  }
  return new Date(0).toISOString();
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

const recoveryBand = (s: unknown): Band | undefined =>
  s === "green" || s === "amber" || s === "red" ? s : undefined;

/**
 * Unified, time-sorted activity feed for one athlete — sessions, RPE, check-ins,
 * recovery, coach comments, notes, performance tests and injuries merged into a
 * single Strava-style timeline. Reads only; the caller enforces access scope.
 */
export async function buildActivityFeed(
  athleteId: Types.ObjectId,
  limit = 40
): Promise<FeedItem[]> {
  const cap = 20; // per source, before the merge + final slice
  const [sessions, rpes, attendance, recovery, comments, notes, performance, injuries] =
    await Promise.all([
      TrainingSession.find({ athleteId }).sort({ updatedAt: -1 }).limit(cap).lean(),
      RpeMonitoring.find({ athleteId }).sort({ updatedAt: -1 }).limit(cap).lean(),
      Attendance.find({ athleteId }).sort({ updatedAt: -1 }).limit(cap).lean(),
      Recovery.find({ athleteId }).sort({ updatedAt: -1 }).limit(cap).lean(),
      CoachComment.find({ athleteId }).sort({ createdAt: -1 }).limit(cap).lean(),
      AthleteNote.find({ athleteId }).sort({ createdAt: -1 }).limit(cap).lean(),
      Performance.find({ athleteId }).sort({ date: -1 }).limit(cap).lean(),
      Injury.find({ athleteId }).sort({ startedAt: -1 }).limit(cap).lean(),
    ]);

  const items: FeedItem[] = [];

  for (const s of sessions as Record<string, unknown>[]) {
    if (!s.status || s.status === "planned") continue; // only real activity
    items.push({
      id: `session:${String(s._id)}`,
      at: whenOf(s, ["updatedAt", "date"]),
      kind: "session",
      title: `${slotLabel(s.slot)} ${str(s.type) ?? "session"}`,
      detail: String(s.status).replace("_", " "),
      band: s.status === "completed" ? "green" : s.status === "skipped" ? "red" : undefined,
    });
  }

  for (const r of rpes as Record<string, unknown>[]) {
    items.push({
      id: `rpe:${String(r._id)}`,
      at: whenOf(r, ["updatedAt", "date"]),
      kind: "rpe",
      title: `RPE ${r.rpe} · ${slotLabel(r.sessionType)}`,
      detail: `load ${r.calculatedTrainingLoad} · ${str(r.trainingCategory) ?? ""}`.trim(),
      band: recoveryBand(r.riskFlag),
    });
  }

  for (const a of attendance as Record<string, unknown>[]) {
    items.push({
      id: `attendance:${String(a._id)}`,
      at: whenOf(a, ["updatedAt", "date"]),
      kind: "attendance",
      title: `Attendance · ${a.status}`,
      band: a.status === "present" ? "green" : a.status === "absent" ? "red" : "amber",
    });
  }

  for (const rec of recovery as Record<string, unknown>[]) {
    const mods = Array.isArray(rec.modalities) ? (rec.modalities as string[]) : [];
    items.push({
      id: `recovery:${String(rec._id)}`,
      at: whenOf(rec, ["updatedAt", "date"]),
      kind: "recovery",
      title: "Recovery logged",
      detail: mods.length ? mods.join(", ") : undefined,
      band: recoveryBand(rec.status),
    });
  }

  for (const c of comments as Record<string, unknown>[]) {
    items.push({
      id: `comment:${String(c._id)}`,
      at: whenOf(c, ["createdAt", "date"]),
      kind: "comment",
      title: "Coach feedback",
      detail: str(c.body),
    });
  }

  for (const n of notes as Record<string, unknown>[]) {
    items.push({
      id: `note:${String(n._id)}`,
      at: whenOf(n, ["createdAt", "date"]),
      kind: "note",
      title: "Note to coach",
      detail: str(n.body),
    });
  }

  for (const p of performance as Record<string, unknown>[]) {
    items.push({
      id: `performance:${String(p._id)}`,
      at: whenOf(p, ["date", "createdAt"]),
      kind: "performance",
      title: `${str(p.metric) ?? "Result"} · ${p.value}${str(p.unit) ?? ""}`,
      detail: str(p.context),
    });
  }

  for (const inj of injuries as Record<string, unknown>[]) {
    items.push({
      id: `injury:${String(inj._id)}`,
      at: whenOf(inj, ["startedAt", "createdAt"]),
      kind: "injury",
      title: `Injury · ${str(inj.bodyPart) ?? "flagged"}`,
      detail: [str(inj.severity), str(inj.status)].filter(Boolean).join(" · ") || undefined,
      band: inj.status === "cleared" ? "green" : "amber",
    });
  }

  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return items.slice(0, limit);
}
