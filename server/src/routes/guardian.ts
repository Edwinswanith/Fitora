import { Router, type Request, type Response } from "express";
import { Types } from "mongoose";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/role";
import {
  loadScope,
  requireAthleteAccess,
} from "../middleware/coachAthleteAccess";
import { AthleteProfile } from "../models/AthleteProfile";
import { User } from "../models/User";
import { Wellness } from "../models/Wellness";
import { Attendance } from "../models/Attendance";
import { WaterIntake } from "../models/WaterIntake";
import { dayRange } from "../services/dashboard";
import { parseDateOrNull } from "../lib/trainingCategories";

const router = Router();

// Guardians only — deliberately narrow. A guardian may see ONLY three data
// points for a linked athlete: Sleep quality, Water intake, and Attendance for
// a given day. No readiness, training load, injuries, coach feedback, notes,
// or messages are ever exposed here — do not add broader endpoints to this
// router without an explicit ask.
router.use(requireAuth, requireRole("guardian"), loadScope);

function linkedIds(req: Request): Types.ObjectId[] {
  return req.actor?.linkedAthleteIds ?? [];
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

/**
 * GET /api/guardian/athletes
 * Linked athletes (summary only).
 */
router.get("/athletes", async (req: Request, res: Response) => {
  if (!req.actor) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  const ids = linkedIds(req);
  if (ids.length === 0) {
    res.json({ athletes: [] });
    return;
  }
  const profiles = await AthleteProfile.find({ _id: { $in: ids } })
    .select("_id userId sport position academyId")
    .lean();
  const users = await User.find({ _id: { $in: profiles.map((p) => p.userId) } })
    .select("_id name")
    .lean();
  const userById = new Map(users.map((u) => [u._id.toString(), u]));
  res.json({
    athletes: profiles.map((p) => {
      const u = userById.get((p.userId as Types.ObjectId).toString());
      return {
        athleteId: p._id.toString(),
        name: (u?.name as string) ?? "",
        sport: p.sport,
        position: p.position ?? null,
      };
    }),
  });
});

/**
 * GET /api/guardian/athletes/:athleteId/summary?date=YYYY-MM-DD
 * The ONLY per-athlete data guardians can see: Sleep quality, Water intake,
 * and Attendance for the given day.
 */
router.get(
  "/athletes/:athleteId/summary",
  requireAthleteAccess("athleteId"),
  async (req: Request, res: Response) => {
    const start = strictDate(req.query.date, res);
    if (!start) return;
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const athleteId = new Types.ObjectId(req.params.athleteId);

    const [wellness, attendance, waterEntries, profile] = await Promise.all([
      Wellness.findOne({ athleteId, date: start }).select("sleepQuality sleepHours").lean(),
      Attendance.findOne({ athleteId, date: start }).select("status note").lean(),
      WaterIntake.find({ athleteId, date: { $gte: start, $lt: end } }).select("amountMl").lean(),
      AthleteProfile.findById(athleteId).select("hydrationGoalMl").lean(),
    ]);

    const totalMl = waterEntries.reduce((sum, entry) => sum + (entry.amountMl as number), 0);

    res.json({
      date: start.toISOString().slice(0, 10),
      sleep: {
        quality: (wellness?.sleepQuality as number | undefined) ?? null,
        hours: (wellness?.sleepHours as number | undefined) ?? null,
      },
      attendance: {
        status: (attendance?.status as string | undefined) ?? null,
        note: (attendance?.note as string | undefined) ?? null,
      },
      water: {
        totalMl,
        goalMl: (profile?.hydrationGoalMl as number | undefined) ?? 3000,
      },
    });
  }
);

export default router;
