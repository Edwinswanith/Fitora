import { Router, type Request, type Response } from "express";
import { Types } from "mongoose";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/role";
import { writeRateLimit } from "../middleware/rateLimit";
import { loadScope, requireAthleteAccess } from "../middleware/coachAthleteAccess";
import { WorkoutAssignment, WORKOUT_ASSIGNMENT_STATUS } from "../models/WorkoutAssignment";
import { WorkoutTemplate } from "../models/WorkoutTemplate";
import { ExerciseMedia } from "../models/ExerciseMedia";
import { SESSION_SLOTS, type SessionSlot } from "../models/TrainingSession";
import {
  assignTemplateToAthlete,
  loadTemplateOwnedBy,
  buildWorkoutAssignmentsForDate,
  serializeAssignment,
  WorkoutAssignmentError,
} from "../services/workoutAssignment";
import { parseDateOrNull } from "../lib/trainingCategories";
import { dayRange } from "../services/dashboard";
import {
  exerciseMediaUpload,
  exerciseMediaFilePath,
  serializeExerciseMedia,
  kindForMime,
  deleteExerciseMediaFile,
} from "../services/exerciseMedia";

const router = Router();
router.use(requireAuth, requireRole("coach"), loadScope);

function parseSlot(input: unknown): SessionSlot | null | undefined {
  if (input === undefined) return undefined;
  if (input === null || input === "") return null;
  return SESSION_SLOTS.includes(input as SessionSlot) ? (input as SessionSlot) : undefined;
}

/**
 * POST /athletes/:athleteId/workout-assignments
 * body: { templateId, scheduledDate, slot? }
 * Assigns one of this coach's templates to one assigned athlete.
 */
router.post(
  "/athletes/:athleteId/workout-assignments",
  writeRateLimit({ windowMs: 60_000, max: 40 }),
  requireAthleteAccess("athleteId"),
  async (req: Request, res: Response) => {
    if (!req.actor) return void res.status(401).json({ error: "unauthenticated" });
    const templateId = typeof req.body?.templateId === "string" ? req.body.templateId : "";
    const template = await loadTemplateOwnedBy(templateId, req.actor.userId);
    if (!template) return void res.status(404).json({ error: "template_not_found" });

    const scheduledDate = parseDateOrNull(req.body?.scheduledDate);
    if (!scheduledDate) return void res.status(400).json({ error: "invalid_scheduledDate" });
    const slot = parseSlot(req.body?.slot);
    if (slot === undefined && req.body?.slot !== undefined) {
      return void res.status(400).json({ error: "invalid_slot" });
    }

    try {
      const assignment = await assignTemplateToAthlete({
        template,
        assignedTo: new Types.ObjectId(req.params.athleteId),
        assignedBy: req.actor.userId,
        assignedByRole: "coach",
        scheduledDate: dayRange(scheduledDate).start,
        slot: slot ?? null,
      });
      res.status(201).json({ assignment: serializeAssignment(assignment) });
    } catch (err) {
      if (err instanceof WorkoutAssignmentError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  }
);

/**
 * POST /workout-assignments/bulk
 * body: { templateId, athleteIds: string[], scheduledDate, slot? }
 * Assigns one template to multiple Clients in one call — each athlete gets
 * an independent assignment row/snapshot/progress; the template itself is
 * never duplicated. Every athleteId is individually verified as currently
 * assigned to this coach; any that aren't are reported as per-item failures
 * rather than failing the whole batch.
 */
router.post(
  "/workout-assignments/bulk",
  writeRateLimit({ windowMs: 60_000, max: 15 }),
  async (req: Request, res: Response) => {
    if (!req.actor) return void res.status(401).json({ error: "unauthenticated" });
    const templateId = typeof req.body?.templateId === "string" ? req.body.templateId : "";
    const template = await loadTemplateOwnedBy(templateId, req.actor.userId);
    if (!template) return void res.status(404).json({ error: "template_not_found" });

    const athleteIds = Array.isArray(req.body?.athleteIds) ? (req.body.athleteIds as unknown[]) : [];
    if (athleteIds.length === 0 || athleteIds.length > 100) {
      return void res.status(400).json({ error: "invalid_athlete_ids" });
    }
    const scheduledDate = parseDateOrNull(req.body?.scheduledDate);
    if (!scheduledDate) return void res.status(400).json({ error: "invalid_scheduledDate" });
    const slot = parseSlot(req.body?.slot);
    if (slot === undefined && req.body?.slot !== undefined) {
      return void res.status(400).json({ error: "invalid_slot" });
    }

    const assignedSet = new Set((req.actor.assignedAthleteIds ?? []).map((id) => id.toString()));
    const results: Array<{ athleteId: string; ok: boolean; assignmentId?: string; error?: string }> = [];

    for (const raw of athleteIds) {
      const athleteId = typeof raw === "string" ? raw : "";
      if (!Types.ObjectId.isValid(athleteId) || !assignedSet.has(athleteId)) {
        results.push({ athleteId, ok: false, error: "not_in_assignments" });
        continue;
      }
      try {
        const assignment = await assignTemplateToAthlete({
          template,
          assignedTo: new Types.ObjectId(athleteId),
          assignedBy: req.actor.userId,
          assignedByRole: "coach",
          scheduledDate: dayRange(scheduledDate).start,
          slot: slot ?? null,
        });
        results.push({ athleteId, ok: true, assignmentId: assignment._id.toString() });
      } catch (err) {
        const message = err instanceof WorkoutAssignmentError ? err.message : "assignment_failed";
        results.push({ athleteId, ok: false, error: message });
      }
    }

    res.status(207).json({ results });
  }
);

/** GET /athletes/:athleteId/workout-assignments?date= */
router.get(
  "/athletes/:athleteId/workout-assignments",
  requireAthleteAccess("athleteId"),
  async (req: Request, res: Response) => {
    const date = parseDateOrNull(req.query.date) ?? new Date();
    const summaries = await buildWorkoutAssignmentsForDate(new Types.ObjectId(req.params.athleteId), date);
    res.json({ assignments: summaries });
  }
);

/** GET /workout-assignments/:assignmentId — coach view of one assignment. */
router.get("/workout-assignments/:assignmentId", async (req: Request, res: Response) => {
  if (!req.actor) return void res.status(401).json({ error: "unauthenticated" });
  const id = req.params.assignmentId;
  if (!Types.ObjectId.isValid(id)) return void res.status(400).json({ error: "invalid_assignment_id" });
  const assignment = await WorkoutAssignment.findById(id);
  if (!assignment) return void res.status(404).json({ error: "assignment_not_found" });
  const assigned = req.actor.assignedAthleteIds ?? [];
  if (!assigned.some((aid) => aid.equals(assignment.assignedTo as Types.ObjectId))) {
    return void res.status(403).json({ error: "not_in_assignments" });
  }
  res.json({ assignment: serializeAssignment(assignment) });
});

// ---------- Exercise media (coach-owned, reusable demo image/video) ----------

/** POST /exercise-media — multipart upload, field "file". */
router.post(
  "/exercise-media",
  writeRateLimit({ windowMs: 60_000, max: 20 }),
  (req: Request, res: Response, next) => {
    exerciseMediaUpload.single("file")(req, res, (err: unknown) => {
      if (!err) return next();
      const message = err instanceof Error ? err.message : "upload_failed";
      res.status(400).json({ error: message === "unsupported_file_type" ? message : "upload_failed" });
    });
  },
  async (req: Request, res: Response) => {
    if (!req.actor || !req.file) return void res.status(400).json({ error: "file_required" });
    const media = await ExerciseMedia.create({
      coachId: req.actor.userId,
      originalName: req.file.originalname,
      storedFilename: req.file.filename,
      mimeType: req.file.mimetype,
      kind: kindForMime(req.file.mimetype),
      sizeBytes: req.file.size,
      durationSec: typeof req.body?.durationSec === "string" ? Number(req.body.durationSec) || null : null,
    });
    res.status(201).json({ media: serializeExerciseMedia(media) });
  }
);

/** GET /exercise-media — coach's own library. */
router.get("/exercise-media", async (req: Request, res: Response) => {
  if (!req.actor) return void res.status(401).json({ error: "unauthenticated" });
  const media = await ExerciseMedia.find({ coachId: req.actor.userId }).sort({ createdAt: -1 }).lean();
  res.json({ media: media.map((m) => serializeExerciseMedia(m as never)) });
});

async function loadOwnExerciseMedia(req: Request, res: Response) {
  if (!req.actor) {
    res.status(401).json({ error: "unauthenticated" });
    return null;
  }
  const id = req.params.mediaId;
  if (!Types.ObjectId.isValid(id)) {
    res.status(400).json({ error: "invalid_media_id" });
    return null;
  }
  const media = await ExerciseMedia.findById(id);
  if (!media || !media.coachId.equals(req.actor.userId)) {
    res.status(404).json({ error: "media_not_found" });
    return null;
  }
  return media;
}

/** GET /exercise-media/:mediaId/file — coach's own authenticated read. */
router.get("/exercise-media/:mediaId/file", async (req: Request, res: Response) => {
  const media = await loadOwnExerciseMedia(req, res);
  if (!media) return;
  res.type(media.mimeType);
  res.setHeader("Cache-Control", "private, max-age=0, no-store");
  res.sendFile(exerciseMediaFilePath(media), (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: "file_missing" });
  });
});

/** DELETE /exercise-media/:mediaId — only if not referenced by any template. */
router.delete("/exercise-media/:mediaId", writeRateLimit({ windowMs: 60_000, max: 20 }), async (req: Request, res: Response) => {
  const media = await loadOwnExerciseMedia(req, res);
  if (!media) return;
  const inUse = await WorkoutTemplate.exists({ "exercises.mediaId": media._id });
  if (inUse) return void res.status(409).json({ error: "media_in_use" });
  await deleteExerciseMediaFile(media);
  await media.deleteOne();
  res.json({ ok: true });
});

export default router;
export { WORKOUT_ASSIGNMENT_STATUS };
