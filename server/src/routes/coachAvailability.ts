import { Router, type Request, type Response } from "express";
import { Types } from "mongoose";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/role";
import { writeRateLimit } from "../middleware/rateLimit";
import { CoachAvailability } from "../models/CoachAvailability";
import { CoachAvailabilityException, AVAILABILITY_EXCEPTION_TYPES } from "../models/CoachAvailabilityException";
import { safeTimezone } from "../services/timezone";
import { dayRange } from "../services/dashboard";
import { parseDateOrNull } from "../lib/trainingCategories";

const router = Router();
router.use(requireAuth, requireRole("coach"));

function serializeRule(r: { _id: Types.ObjectId; dayOfWeek: number; startMinute: number; endMinute: number; timezone: string; sessionDurationMin: number; bufferMin: number }) {
  return {
    id: r._id.toString(),
    dayOfWeek: r.dayOfWeek,
    startMinute: r.startMinute,
    endMinute: r.endMinute,
    timezone: r.timezone,
    sessionDurationMin: r.sessionDurationMin,
    bufferMin: r.bufferMin,
  };
}

function serializeException(e: { _id: Types.ObjectId; date: Date; type: string; startMinute: number | null; endMinute: number | null; reason?: string | null }) {
  return {
    id: e._id.toString(),
    date: e.date.toISOString().slice(0, 10),
    type: e.type,
    startMinute: e.startMinute,
    endMinute: e.endMinute,
    reason: e.reason ?? null,
  };
}

/** GET /availability — this coach's full set of recurring rules. */
router.get("/availability", async (req: Request, res: Response) => {
  const rules = await CoachAvailability.find({ coachId: req.actor!.userId }).sort({ dayOfWeek: 1, startMinute: 1 }).lean();
  res.json({ rules: rules.map(serializeRule as never) });
});

/**
 * PUT /availability — body: { rules: [{dayOfWeek, startMinute, endMinute, timezone, sessionDurationMin, bufferMin}] }.
 * Whole-array replace (same convention as workout-templates/meal-plans PATCH days) — the client always sends the
 * complete desired set; existing bookings are untouched since CoachSession never references a rule by id.
 */
router.put("/availability", writeRateLimit({ windowMs: 60_000, max: 30 }), async (req: Request, res: Response) => {
  const raw = Array.isArray(req.body?.rules) ? (req.body.rules as unknown[]) : null;
  if (!raw || raw.length > 50) return void res.status(400).json({ error: "invalid_rules" });

  const docs: Record<string, unknown>[] = [];
  for (const item of raw) {
    const r = item as Record<string, unknown>;
    const dayOfWeek = Number(r.dayOfWeek);
    const startMinute = Number(r.startMinute);
    const endMinute = Number(r.endMinute);
    const sessionDurationMin = Number(r.sessionDurationMin ?? 30);
    const bufferMin = Number(r.bufferMin ?? 0);
    const timezone = safeTimezone(typeof r.timezone === "string" ? r.timezone : "UTC");
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) return void res.status(400).json({ error: "invalid_dayOfWeek" });
    if (!Number.isFinite(startMinute) || startMinute < 0 || startMinute > 1439) return void res.status(400).json({ error: "invalid_startMinute" });
    if (!Number.isFinite(endMinute) || endMinute <= startMinute || endMinute > 1440) return void res.status(400).json({ error: "invalid_endMinute" });
    if (!Number.isFinite(sessionDurationMin) || sessionDurationMin < 5 || sessionDurationMin > 240) return void res.status(400).json({ error: "invalid_sessionDurationMin" });
    if (!Number.isFinite(bufferMin) || bufferMin < 0 || bufferMin > 120) return void res.status(400).json({ error: "invalid_bufferMin" });
    docs.push({ coachId: req.actor!.userId, dayOfWeek, startMinute, endMinute, timezone, sessionDurationMin, bufferMin });
  }

  await CoachAvailability.deleteMany({ coachId: req.actor!.userId });
  const created = docs.length > 0 ? await CoachAvailability.insertMany(docs) : [];
  res.json({ rules: created.map((r) => serializeRule(r as never)) });
});

/** GET /availability/exceptions?from=&to= */
router.get("/availability/exceptions", async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = { coachId: req.actor!.userId };
  const from = parseDateOrNull(req.query.from);
  const to = parseDateOrNull(req.query.to);
  if (from || to) {
    filter.date = {
      ...(from ? { $gte: dayRange(from).start } : {}),
      ...(to ? { $lte: dayRange(to).start } : {}),
    };
  }
  const rows = await CoachAvailabilityException.find(filter).sort({ date: 1 }).lean();
  res.json({ exceptions: rows.map(serializeException as never) });
});

/** POST /availability/exceptions — body: { date, type, startMinute?, endMinute?, reason? }. Upserts (one per date). */
router.post("/availability/exceptions", writeRateLimit({ windowMs: 60_000, max: 40 }), async (req: Request, res: Response) => {
  const date = parseDateOrNull(req.body?.date);
  if (!date) return void res.status(400).json({ error: "invalid_date" });
  const type = req.body?.type;
  if (!AVAILABILITY_EXCEPTION_TYPES.includes(type)) return void res.status(400).json({ error: "invalid_type" });

  let startMinute: number | null = null;
  let endMinute: number | null = null;
  if (req.body?.startMinute !== undefined || req.body?.endMinute !== undefined || type === "custom_hours") {
    startMinute = Number(req.body?.startMinute);
    endMinute = Number(req.body?.endMinute);
    if (!Number.isFinite(startMinute) || startMinute < 0 || startMinute > 1439) return void res.status(400).json({ error: "invalid_startMinute" });
    if (!Number.isFinite(endMinute) || endMinute <= startMinute || endMinute > 1440) return void res.status(400).json({ error: "invalid_endMinute" });
  }
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 300) : undefined;

  const dayStart = dayRange(date).start;
  const doc = await CoachAvailabilityException.findOneAndUpdate(
    { coachId: req.actor!.userId, date: dayStart },
    { $set: { type, startMinute, endMinute, reason } },
    { upsert: true, new: true, runValidators: true }
  );
  res.status(201).json({ exception: serializeException(doc as never) });
});

router.delete("/availability/exceptions/:id", writeRateLimit({ windowMs: 60_000, max: 40 }), async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!Types.ObjectId.isValid(id)) return void res.status(400).json({ error: "invalid_exception_id" });
  const deleted = await CoachAvailabilityException.findOneAndDelete({ _id: id, coachId: req.actor!.userId });
  if (!deleted) return void res.status(404).json({ error: "exception_not_found" });
  res.json({ ok: true });
});

export default router;
