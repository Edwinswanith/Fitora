import { Router, type Request, type Response } from "express";
import { Types } from "mongoose";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/role";
import { writeRateLimit } from "../middleware/rateLimit";
import { loadScope } from "../middleware/coachAthleteAccess";
import { WorkoutAssignment } from "../models/WorkoutAssignment";
import { ExerciseMedia } from "../models/ExerciseMedia";
import {
  startAssignment,
  skipAssignment,
  updateExerciseProgress,
  serializeAssignment,
  loadProgressFor,
  buildWorkoutAssignmentsForDate,
  WorkoutAssignmentError,
  type ExerciseProgressUpdate,
} from "../services/workoutAssignment";
import { EXERCISE_PROGRESS_STATUS } from "../models/ExerciseProgress";
import { parseDateOrNull } from "../lib/trainingCategories";
import { dayRange } from "../services/dashboard";
import { sendStoredObject } from "../services/objectStorage";

const router = Router();
router.use(requireAuth, requireRole("athlete"), loadScope);

function selfAthleteId(req: Request): Types.ObjectId | null {
  return req.actor?.athleteProfileId ?? null;
}

async function loadOwnAssignment(req: Request, res: Response) {
  const profileId = selfAthleteId(req);
  if (!profileId) {
    res.status(404).json({ error: "athlete_profile_not_found" });
    return null;
  }
  const id = req.params.assignmentId;
  if (!Types.ObjectId.isValid(id)) {
    res.status(400).json({ error: "invalid_assignment_id" });
    return null;
  }
  const assignment = await WorkoutAssignment.findById(id);
  if (!assignment || !assignment.assignedTo.equals(profileId)) {
    res.status(404).json({ error: "assignment_not_found" });
    return null;
  }
  return assignment;
}

/** GET /workout-assignments?date=&from=&to= — defaults to today. */
router.get("/workout-assignments", async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId) return void res.status(404).json({ error: "athlete_profile_not_found" });

  if (req.query.from || req.query.to) {
    const from = parseDateOrNull(req.query.from);
    const to = parseDateOrNull(req.query.to);
    if (!from || !to) return void res.status(400).json({ error: "invalid_date_range" });
    const { start } = dayRange(from);
    const { end } = dayRange(to);
    const rows = await WorkoutAssignment.find({
      assignedTo: profileId,
      scheduledDate: { $gte: start, $lt: end },
    })
      .sort({ scheduledDate: 1, createdAt: 1 })
      .lean();
    res.json({ assignments: rows.map((a) => serializeAssignment(a as never)) });
    return;
  }

  const date = parseDateOrNull(req.query.date) ?? new Date();
  const summaries = await buildWorkoutAssignmentsForDate(profileId, date);
  res.json({ assignments: summaries });
});

/** GET /workout-assignments/:assignmentId — full detail incl. progress. */
router.get("/workout-assignments/:assignmentId", async (req: Request, res: Response) => {
  const assignment = await loadOwnAssignment(req, res);
  if (!assignment) return;
  const progress = await loadProgressFor(assignment._id as Types.ObjectId);
  res.json({ assignment: serializeAssignment(assignment, progress) });
});

/** POST /workout-assignments/:assignmentId/start — idempotent. */
router.post(
  "/workout-assignments/:assignmentId/start",
  writeRateLimit({ windowMs: 60_000, max: 40 }),
  async (req: Request, res: Response) => {
    const assignment = await loadOwnAssignment(req, res);
    if (!assignment) return;
    const updated = await startAssignment(assignment);
    res.json({ assignment: serializeAssignment(updated) });
  }
);

/**
 * POST /workout-assignments/:assignmentId/exercises/:exerciseIndex/progress
 * body: { status?, setsCompleted?, notes? }
 * Auto-starts the assignment if still "scheduled"; auto-completes it (and any
 * linked TrainingSession/Attendance) once every exercise reaches a terminal
 * state — see services/workoutAssignment.ts.
 */
router.post(
  "/workout-assignments/:assignmentId/exercises/:exerciseIndex/progress",
  writeRateLimit({ windowMs: 60_000, max: 120 }),
  async (req: Request, res: Response) => {
    const assignment = await loadOwnAssignment(req, res);
    if (!assignment) return;

    const exerciseIndex = Number(req.params.exerciseIndex);
    if (!Number.isInteger(exerciseIndex) || exerciseIndex < 0) {
      return void res.status(400).json({ error: "invalid_exercise_index" });
    }

    const update: ExerciseProgressUpdate = {};
    if (req.body?.status !== undefined) {
      if (!EXERCISE_PROGRESS_STATUS.includes(req.body.status)) {
        return void res.status(400).json({ error: "invalid_status" });
      }
      update.status = req.body.status;
    }
    if (req.body?.notes !== undefined) {
      const notes = typeof req.body.notes === "string" ? req.body.notes.trim() : "";
      if (notes.length > 500) return void res.status(400).json({ error: "invalid_notes" });
      update.notes = notes;
    }
    if (req.body?.setsCompleted !== undefined) {
      if (!Array.isArray(req.body.setsCompleted)) {
        return void res.status(400).json({ error: "invalid_setsCompleted" });
      }
      const sets: NonNullable<ExerciseProgressUpdate["setsCompleted"]> = [];
      for (const raw of req.body.setsCompleted) {
        const rec = raw as Record<string, unknown>;
        const setNumber = Number(rec?.setNumber);
        if (!Number.isFinite(setNumber) || setNumber < 1) {
          return void res.status(400).json({ error: "invalid_setNumber" });
        }
        sets.push({
          setNumber,
          reps: rec.reps !== undefined ? Number(rec.reps) : undefined,
          weightKg: rec.weightKg !== undefined ? Number(rec.weightKg) : undefined,
          durationSec: rec.durationSec !== undefined ? Number(rec.durationSec) : undefined,
        });
      }
      update.setsCompleted = sets;
    }

    try {
      const { assignment: updatedAssignment, progress } = await updateExerciseProgress(
        assignment,
        exerciseIndex,
        update
      );
      const allProgress = await loadProgressFor(updatedAssignment._id as Types.ObjectId);
      res.json({
        assignment: serializeAssignment(updatedAssignment, allProgress),
        exerciseProgress: progress,
      });
    } catch (err) {
      if (err instanceof WorkoutAssignmentError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  }
);

/** POST /workout-assignments/:assignmentId/skip */
router.post(
  "/workout-assignments/:assignmentId/skip",
  writeRateLimit({ windowMs: 60_000, max: 40 }),
  async (req: Request, res: Response) => {
    const assignment = await loadOwnAssignment(req, res);
    if (!assignment) return;
    const updated = await skipAssignment(assignment);
    res.json({ assignment: serializeAssignment(updated) });
  }
);

/**
 * GET /exercise-media/:mediaId/file — an athlete may view exercise media
 * only if it's referenced by an exercise on an assignment actually assigned
 * to them (never a bare/guessable storage URL, never any coach's whole
 * library). Authorization is a live query on every request, not a cached or
 * client-asserted claim.
 */
router.get("/exercise-media/:mediaId/file", async (req: Request, res: Response) => {
  const profileId = selfAthleteId(req);
  if (!profileId) return void res.status(404).json({ error: "athlete_profile_not_found" });
  const mediaId = req.params.mediaId;
  if (!Types.ObjectId.isValid(mediaId)) return void res.status(400).json({ error: "invalid_media_id" });

  const media = await ExerciseMedia.findById(mediaId);
  if (!media) return void res.status(404).json({ error: "media_not_found" });

  const authorized = await WorkoutAssignment.exists({
    assignedTo: profileId,
    "exercisesSnapshot.mediaId": media._id,
  });
  if (!authorized) return void res.status(403).json({ error: "not_authorized" });

  await sendStoredObject(res, media.storedFilename, media.mimeType);
});

export default router;
