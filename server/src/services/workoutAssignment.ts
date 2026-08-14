import { Types, type HydratedDocument } from "mongoose";
import {
  WorkoutAssignment,
  type WorkoutAssignmentDoc,
} from "../models/WorkoutAssignment";
import { WorkoutTemplate, type WorkoutTemplateDoc, type WorkoutExerciseDoc } from "../models/WorkoutTemplate";
import { ExerciseProgress, type ExerciseProgressDoc } from "../models/ExerciseProgress";
import { TrainingSession } from "../models/TrainingSession";
import { Attendance } from "../models/Attendance";
import { dayRange } from "./dashboard";
import type { SessionSlot } from "../models/TrainingSession";

export class WorkoutAssignmentError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Snapshot-creates an assignment from a template — copies exercises +
 * version at THIS moment. Editing the template afterward never touches this
 * row (see WorkoutAssignment.ts doc comment). Enforces the one-slot-per-day
 * invariant via the model's own partial unique index; a collision surfaces
 * as a WorkoutAssignmentError so the route can return a clean 409.
 */
export async function assignTemplateToAthlete(params: {
  template: WorkoutTemplateDoc;
  assignedTo: Types.ObjectId;
  assignedBy: Types.ObjectId;
  assignedByRole: "coach" | "athlete";
  scheduledDate: Date;
  slot?: SessionSlot | null;
}): Promise<HydratedDocument<WorkoutAssignmentDoc>> {
  try {
    return await WorkoutAssignment.create({
      templateId: params.template._id,
      templateVersionSnapshot: params.template.version,
      nameSnapshot: params.template.name,
      exercisesSnapshot: params.template.exercises,
      assignedTo: params.assignedTo,
      assignedBy: params.assignedBy,
      assignedByRole: params.assignedByRole,
      scheduledDate: params.scheduledDate,
      slot: params.slot ?? null,
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      throw new WorkoutAssignmentError("slot_already_assigned", 409);
    }
    throw err;
  }
}

function exercisesOf(assignment: WorkoutAssignmentDoc): WorkoutExerciseDoc[] {
  return (assignment.exercisesSnapshot ?? []) as unknown as WorkoutExerciseDoc[];
}

/**
 * Marks the linked TrainingSession (if any) completed and, matching the
 * existing athlete-training-route behavior (routes/athlete.ts), auto-upserts
 * that day's Attendance to "present" — deliberately re-implemented here
 * rather than imported from that route handler so the existing, heavily
 * tested athlete.ts code path is never touched by this new system.
 */
async function completeLinkedTrainingSession(
  assignment: HydratedDocument<WorkoutAssignmentDoc>
): Promise<void> {
  if (!assignment.trainingSessionId) return;
  await TrainingSession.updateOne(
    { _id: assignment.trainingSessionId },
    { $set: { status: "completed" } }
  );
  await Attendance.updateOne(
    { athleteId: assignment.assignedTo, date: assignment.scheduledDate },
    { $set: { status: "present" } },
    { upsert: true }
  );
}

/**
 * Starts an assignment: scheduled -> in_progress. Idempotent — starting an
 * already-started/completed assignment is a no-op returning current state
 * (retry-safe, matches the project's existing idempotency conventions rather
 * than erroring on a benign double-tap/retry).
 *
 * When the assignment has a slot, links (or creates) the corresponding
 * TrainingSession row for (athleteId, date, slot) via upsert — this is what
 * keeps AM/AFT/PM continuity with the existing dashboard/RPE/analytics
 * system: starting a slot-linked assignment claims whatever TrainingSession
 * exists for that slot (or creates one) without touching any coach-set plan
 * text already on it.
 */
export async function startAssignment(
  assignment: HydratedDocument<WorkoutAssignmentDoc>
): Promise<HydratedDocument<WorkoutAssignmentDoc>> {
  if (assignment.status !== "scheduled") return assignment;

  assignment.status = "in_progress";
  assignment.startedAt = assignment.startedAt ?? new Date();

  if (assignment.slot) {
    const session = await TrainingSession.findOneAndUpdate(
      { athleteId: assignment.assignedTo, date: assignment.scheduledDate, slot: assignment.slot },
      {
        $set: { workoutAssignmentId: assignment._id },
        $setOnInsert: {
          athleteId: assignment.assignedTo,
          date: assignment.scheduledDate,
          slot: assignment.slot,
          status: "in_progress",
        },
      },
      { upsert: true, new: true }
    );
    assignment.trainingSessionId = session!._id;
  }

  await assignment.save();
  return assignment;
}

export type ExerciseProgressUpdate = {
  status?: "not_started" | "in_progress" | "completed" | "skipped";
  setsCompleted?: Array<{ setNumber: number; reps?: number; weightKg?: number; durationSec?: number }>;
  notes?: string;
};

/**
 * Updates one exercise's progress within an assignment. Auto-starts the
 * assignment on its first progress update (so a client can go straight to
 * tapping checklist items without a separate explicit /start call), and
 * auto-completes the assignment — and its linked TrainingSession/Attendance,
 * if any — the moment every exercise reaches a terminal state
 * (completed/skipped), matching the 0/4 -> 1/4 -> ... -> 4/4 -> Completed
 * flow. Returns the updated assignment + progress row.
 */
export async function updateExerciseProgress(
  assignment: HydratedDocument<WorkoutAssignmentDoc>,
  exerciseIndex: number,
  update: ExerciseProgressUpdate
): Promise<{ assignment: HydratedDocument<WorkoutAssignmentDoc>; progress: HydratedDocument<ExerciseProgressDoc> }> {
  const exercises = exercisesOf(assignment);
  if (exerciseIndex < 0 || exerciseIndex >= exercises.length) {
    throw new WorkoutAssignmentError("invalid_exercise_index", 400);
  }
  if (assignment.status === "completed" || assignment.status === "skipped") {
    throw new WorkoutAssignmentError("assignment_already_finished", 409);
  }

  if (assignment.status === "scheduled") {
    await startAssignment(assignment);
  }

  const $set: Record<string, unknown> = {};
  if (update.status !== undefined) {
    $set.status = update.status;
    $set.completedAt = update.status === "completed" || update.status === "skipped" ? new Date() : null;
  }
  if (update.setsCompleted !== undefined) {
    $set.setsCompleted = update.setsCompleted.map((s) => ({
      setNumber: s.setNumber,
      reps: s.reps,
      weightKg: s.weightKg,
      durationSec: s.durationSec,
      completedAt: new Date(),
    }));
  }
  if (update.notes !== undefined) $set.notes = update.notes;

  const progress = await ExerciseProgress.findOneAndUpdate(
    { assignmentId: assignment._id, exerciseIndex },
    { $set, $setOnInsert: { assignmentId: assignment._id, exerciseIndex } },
    { upsert: true, new: true, runValidators: true }
  );

  const allProgress = await ExerciseProgress.find({ assignmentId: assignment._id }).lean();
  const terminalCount = allProgress.filter((p) => p.status === "completed" || p.status === "skipped").length;
  if (exercises.length > 0 && terminalCount >= exercises.length) {
    assignment.status = "completed";
    assignment.completedAt = new Date();
    await assignment.save();
    await completeLinkedTrainingSession(assignment);
  }

  return { assignment, progress: progress! };
}

export async function skipAssignment(
  assignment: HydratedDocument<WorkoutAssignmentDoc>
): Promise<HydratedDocument<WorkoutAssignmentDoc>> {
  if (assignment.status === "completed" || assignment.status === "skipped") return assignment;
  assignment.status = "skipped";
  assignment.completedAt = new Date();
  await assignment.save();
  if (assignment.trainingSessionId) {
    await TrainingSession.updateOne({ _id: assignment.trainingSessionId }, { $set: { status: "skipped" } });
  }
  return assignment;
}

export type WorkoutAssignmentSummary = {
  id: string;
  templateId: string;
  name: string;
  scheduledDate: string;
  slot: SessionSlot | null;
  status: string;
  exerciseCount: number;
  completedCount: number;
  progressPercent: number;
};

/**
 * The single source of "what workouts are scheduled for this User on this
 * date" — used by both the athlete's own /workout/assignments listing and
 * (merged in at the route level) the existing daily-card endpoints, so there
 * is exactly one place that answers "today's workout" rather than two
 * competing aggregations.
 */
export async function buildWorkoutAssignmentsForDate(
  athleteId: Types.ObjectId,
  date: Date
): Promise<WorkoutAssignmentSummary[]> {
  const { start, end } = dayRange(date);
  const assignments = await WorkoutAssignment.find({
    assignedTo: athleteId,
    scheduledDate: { $gte: start, $lt: end },
  })
    .sort({ createdAt: 1 })
    .lean();
  if (assignments.length === 0) return [];

  const progressRows = await ExerciseProgress.find({
    assignmentId: { $in: assignments.map((a) => a._id) },
  })
    .select("assignmentId status")
    .lean();
  const completedByAssignment = new Map<string, number>();
  for (const p of progressRows) {
    if (p.status !== "completed" && p.status !== "skipped") continue;
    const key = (p.assignmentId as Types.ObjectId).toString();
    completedByAssignment.set(key, (completedByAssignment.get(key) ?? 0) + 1);
  }

  return assignments.map((a) => {
    const total = (a.exercisesSnapshot as unknown[] | undefined)?.length ?? 0;
    const done = completedByAssignment.get(a._id.toString()) ?? 0;
    return {
      id: a._id.toString(),
      templateId: (a.templateId as Types.ObjectId).toString(),
      name: a.nameSnapshot as string,
      scheduledDate: start.toISOString().slice(0, 10),
      slot: (a.slot as SessionSlot | null) ?? null,
      status: a.status as string,
      exerciseCount: total,
      completedCount: done,
      progressPercent: total > 0 ? Math.round((done / total) * 100) : 0,
    };
  });
}

export async function loadTemplateOwnedBy(
  templateId: string,
  ownerId: Types.ObjectId
): Promise<HydratedDocument<WorkoutTemplateDoc> | null> {
  if (!Types.ObjectId.isValid(templateId)) return null;
  const template = await WorkoutTemplate.findById(templateId);
  if (!template || !template.ownerId.equals(ownerId)) return null;
  return template;
}

export type ExerciseProgressView = {
  exerciseIndex: number;
  status: string;
  setsCompleted: Array<{ setNumber: number; reps: number | null; weightKg: number | null; durationSec: number | null; completedAt: string }>;
  notes: string | null;
  completedAt: string | null;
};

function serializeProgress(p: ExerciseProgressDoc): ExerciseProgressView {
  return {
    exerciseIndex: p.exerciseIndex,
    status: p.status as string,
    setsCompleted: ((p.setsCompleted ?? []) as unknown as Array<{
      setNumber: number;
      reps?: number;
      weightKg?: number;
      durationSec?: number;
      completedAt: Date;
    }>).map((s) => ({
      setNumber: s.setNumber,
      reps: s.reps ?? null,
      weightKg: s.weightKg ?? null,
      durationSec: s.durationSec ?? null,
      completedAt: (s.completedAt ?? new Date()).toISOString(),
    })),
    notes: (p.notes as string | undefined) ?? null,
    completedAt: p.completedAt ? (p.completedAt as Date).toISOString() : null,
  };
}

export type WorkoutAssignmentView = {
  id: string;
  templateId: string;
  templateVersionSnapshot: number;
  name: string;
  assignedTo: string;
  assignedBy: string;
  assignedByRole: string;
  scheduledDate: string;
  slot: SessionSlot | null;
  status: string;
  trainingSessionId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  exercises: Array<{
    title: string;
    type: string;
    sets: number | null;
    reps: string | null;
    durationSec: number | null;
    restSec: number | null;
    instructions: string | null;
    mediaId: string | null;
    notes: string | null;
    order: number;
  }>;
  progress: ExerciseProgressView[];
};

/**
 * Full view of one assignment for a detail screen — snapshot exercises plus
 * (if loaded) per-exercise progress. `progress` is fetched by the caller and
 * passed in explicitly (rather than queried here) so list endpoints that
 * only need summaries (buildWorkoutAssignmentsForDate) never pay for it.
 */
export function serializeAssignment(
  assignment: WorkoutAssignmentDoc | HydratedDocument<WorkoutAssignmentDoc>,
  progress: ExerciseProgressDoc[] = []
): WorkoutAssignmentView {
  const exercises = exercisesOf(assignment as WorkoutAssignmentDoc);
  return {
    id: assignment._id.toString(),
    templateId: (assignment.templateId as Types.ObjectId).toString(),
    templateVersionSnapshot: assignment.templateVersionSnapshot,
    name: assignment.nameSnapshot as string,
    assignedTo: (assignment.assignedTo as Types.ObjectId).toString(),
    assignedBy: (assignment.assignedBy as Types.ObjectId).toString(),
    assignedByRole: assignment.assignedByRole as string,
    scheduledDate: (assignment.scheduledDate as Date).toISOString().slice(0, 10),
    slot: (assignment.slot as SessionSlot | null) ?? null,
    status: assignment.status as string,
    trainingSessionId: assignment.trainingSessionId
      ? (assignment.trainingSessionId as Types.ObjectId).toString()
      : null,
    startedAt: assignment.startedAt ? (assignment.startedAt as Date).toISOString() : null,
    completedAt: assignment.completedAt ? (assignment.completedAt as Date).toISOString() : null,
    exercises: exercises
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((e) => ({
        title: e.title,
        type: e.type,
        sets: e.sets ?? null,
        reps: e.reps ?? null,
        durationSec: e.durationSec ?? null,
        restSec: e.restSec ?? null,
        instructions: e.instructions ?? null,
        mediaId: e.mediaId ? (e.mediaId as unknown as Types.ObjectId).toString() : null,
        notes: e.notes ?? null,
        order: e.order,
      })),
    progress: progress.map(serializeProgress),
  };
}

export async function loadProgressFor(assignmentId: Types.ObjectId): Promise<ExerciseProgressDoc[]> {
  return ExerciseProgress.find({ assignmentId }).sort({ exerciseIndex: 1 }).lean();
}
