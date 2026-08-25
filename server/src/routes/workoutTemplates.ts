import { Router, type Request, type Response } from "express";
import { Types } from "mongoose";
import { requireAuth } from "../middleware/auth";
import { writeRateLimit } from "../middleware/rateLimit";
import {
  WorkoutTemplate,
  EXERCISE_TYPES,
  type ExerciseType,
  type WorkoutExerciseDoc,
  type WorkoutTemplateDoc,
} from "../models/WorkoutTemplate";
import { ExerciseMedia } from "../models/ExerciseMedia";
import { notifyWorkoutTemplateUpdated } from "../services/workoutAssignment";
import type { HydratedDocument } from "mongoose";

// Shared across coach and athlete (self-authored templates) — same pattern
// as routes/avatar.ts: one router gated only by requireAuth, with ownership
// derived server-side from req.actor rather than duplicated per-role logic.
const router = Router();
router.use(requireAuth);

function reqStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

type ExerciseInput = {
  title: string;
  type: ExerciseType;
  sets?: number;
  reps?: string;
  durationSec?: number;
  restSec?: number;
  instructions?: string;
  mediaId?: string | null;
  notes?: string;
};

async function validateExercises(
  raw: unknown,
  ownerId: Types.ObjectId
): Promise<{ ok: true; exercises: ExerciseInput[] } | { ok: false; error: string }> {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: "exercises_required" };
  }
  if (raw.length > 60) {
    return { ok: false, error: "too_many_exercises" };
  }

  const mediaIds = new Set<string>();
  const exercises: ExerciseInput[] = [];
  for (const item of raw) {
    const title = reqStr((item as Record<string, unknown>)?.title);
    const type = (item as Record<string, unknown>)?.type as ExerciseType;
    if (!title || title.length > 160) return { ok: false, error: "invalid_exercise_title" };
    if (!EXERCISE_TYPES.includes(type)) return { ok: false, error: "invalid_exercise_type" };

    const rec = item as Record<string, unknown>;
    const exercise: ExerciseInput = { title, type };

    if (rec.sets !== undefined) {
      const sets = Number(rec.sets);
      if (!Number.isFinite(sets) || sets < 0 || sets > 50) return { ok: false, error: "invalid_sets" };
      exercise.sets = sets;
    }
    if (rec.reps !== undefined) {
      const reps = reqStr(rec.reps);
      if (reps.length > 40) return { ok: false, error: "invalid_reps" };
      exercise.reps = reps || undefined;
    }
    if (rec.durationSec !== undefined) {
      const d = Number(rec.durationSec);
      if (!Number.isFinite(d) || d < 0 || d > 36000) return { ok: false, error: "invalid_durationSec" };
      exercise.durationSec = d;
    }
    if (rec.restSec !== undefined) {
      const r = Number(rec.restSec);
      if (!Number.isFinite(r) || r < 0 || r > 3600) return { ok: false, error: "invalid_restSec" };
      exercise.restSec = r;
    }
    if (rec.instructions !== undefined) {
      const instructions = reqStr(rec.instructions);
      if (instructions.length > 2000) return { ok: false, error: "invalid_instructions" };
      exercise.instructions = instructions || undefined;
    }
    if (rec.notes !== undefined) {
      const notes = reqStr(rec.notes);
      if (notes.length > 500) return { ok: false, error: "invalid_notes" };
      exercise.notes = notes || undefined;
    }
    if (rec.mediaId !== undefined && rec.mediaId !== null) {
      const mediaId = reqStr(rec.mediaId);
      if (!Types.ObjectId.isValid(mediaId)) return { ok: false, error: "invalid_media_id" };
      exercise.mediaId = mediaId;
      mediaIds.add(mediaId);
    }

    exercises.push(exercise);
  }

  if (mediaIds.size > 0) {
    // Exercise media is coach-owned and reusable — an athlete self-authoring
    // a template can only ever reference media they themselves uploaded (they
    // have no upload route today, so in practice this just prevents anyone
    // from referencing another coach's media id).
    const owned = await ExerciseMedia.find({ _id: { $in: [...mediaIds] }, coachId: ownerId })
      .select("_id")
      .lean();
    if (owned.length !== mediaIds.size) {
      return { ok: false, error: "media_not_owned" };
    }
  }

  return { ok: true, exercises };
}

function toEmbedded(exercises: ExerciseInput[]) {
  return exercises.map((e, index) => ({ ...e, order: index }));
}

function serializeTemplate(t: WorkoutTemplateDoc | HydratedDocument<WorkoutTemplateDoc>) {
  return {
    id: t._id.toString(),
    ownerId: (t.ownerId as Types.ObjectId).toString(),
    ownerRole: t.ownerRole,
    name: t.name,
    description: t.description ?? null,
    version: t.version,
    isArchived: t.isArchived,
    exercises: ((t.exercises ?? []) as unknown as WorkoutExerciseDoc[])
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
    createdAt: (t.createdAt as Date).toISOString(),
    updatedAt: (t.updatedAt as Date).toISOString(),
  };
}

/** GET /workout-templates?includeArchived=1 — own templates only. */
router.get("/", async (req: Request, res: Response) => {
  if (!req.actor) return void res.status(401).json({ error: "unauthenticated" });
  const includeArchived = req.query.includeArchived === "1" || req.query.includeArchived === "true";
  const filter: Record<string, unknown> = { ownerId: req.actor.userId };
  if (!includeArchived) filter.isArchived = false;
  const templates = await WorkoutTemplate.find(filter).sort({ updatedAt: -1 }).lean();
  res.json({ templates: templates.map((t) => serializeTemplate(t as WorkoutTemplateDoc)) });
});

/** POST /workout-templates — body: { name, description?, exercises: [...] } */
router.post("/", writeRateLimit({ windowMs: 60_000, max: 30 }), async (req: Request, res: Response) => {
  if (!req.actor) return void res.status(401).json({ error: "unauthenticated" });
  if (req.actor.role !== "coach" && req.actor.role !== "athlete") {
    return void res.status(403).json({ error: "forbidden_role" });
  }
  const name = reqStr(req.body?.name);
  if (!name || name.length > 160) return void res.status(400).json({ error: "invalid_name" });
  const description = reqStr(req.body?.description);
  if (description.length > 2000) return void res.status(400).json({ error: "invalid_description" });

  const validated = await validateExercises(req.body?.exercises, req.actor.userId);
  if (!validated.ok) return void res.status(400).json({ error: validated.error });

  const template = await WorkoutTemplate.create({
    ownerId: req.actor.userId,
    ownerRole: req.actor.role,
    name,
    description: description || undefined,
    exercises: toEmbedded(validated.exercises),
    version: 1,
  });
  res.status(201).json({ template: serializeTemplate(template) });
});

async function loadOwnTemplate(req: Request, res: Response): Promise<HydratedDocument<WorkoutTemplateDoc> | null> {
  if (!req.actor) {
    res.status(401).json({ error: "unauthenticated" });
    return null;
  }
  const id = req.params.templateId;
  if (!Types.ObjectId.isValid(id)) {
    res.status(400).json({ error: "invalid_template_id" });
    return null;
  }
  const template = await WorkoutTemplate.findById(id);
  if (!template) {
    res.status(404).json({ error: "template_not_found" });
    return null;
  }
  if (!template.ownerId.equals(req.actor.userId)) {
    res.status(403).json({ error: "not_template_owner" });
    return null;
  }
  return template;
}

/** GET /workout-templates/:templateId */
router.get("/:templateId", async (req: Request, res: Response) => {
  const template = await loadOwnTemplate(req, res);
  if (!template) return;
  res.json({ template: serializeTemplate(template) });
});

/**
 * PATCH /workout-templates/:templateId — body: any of { name, description,
 * exercises }. Any exercises-list edit bumps `version` — this is the field
 * WorkoutAssignment snapshots at assign-time, so bumping it here is what
 * lets future assignments pick up the change while past ones stay frozen.
 */
router.patch(
  "/:templateId",
  writeRateLimit({ windowMs: 60_000, max: 40 }),
  async (req: Request, res: Response) => {
    const template = await loadOwnTemplate(req, res);
    if (!template) return;

    let exercisesChanged = false;
    if (req.body?.name !== undefined) {
      const name = reqStr(req.body.name);
      if (!name || name.length > 160) return void res.status(400).json({ error: "invalid_name" });
      template.name = name;
    }
    if (req.body?.description !== undefined) {
      const description = reqStr(req.body.description);
      if (description.length > 2000) return void res.status(400).json({ error: "invalid_description" });
      template.description = description || undefined;
    }
    if (req.body?.exercises !== undefined) {
      const validated = await validateExercises(req.body.exercises, template.ownerId as Types.ObjectId);
      if (!validated.ok) return void res.status(400).json({ error: validated.error });
      template.exercises = toEmbedded(validated.exercises) as unknown as typeof template.exercises;
      exercisesChanged = true;
    }
    if (exercisesChanged) template.version = (template.version ?? 1) + 1;

    await template.save();
    if (exercisesChanged) await notifyWorkoutTemplateUpdated(template);
    res.json({ template: serializeTemplate(template) });
  }
);

/** POST /workout-templates/:templateId/archive — soft-delete (history-safe). */
router.post("/:templateId/archive", writeRateLimit({ windowMs: 60_000, max: 40 }), async (req: Request, res: Response) => {
  const template = await loadOwnTemplate(req, res);
  if (!template) return;
  template.isArchived = true;
  await template.save();
  res.json({ template: serializeTemplate(template) });
});

/** POST /workout-templates/:templateId/unarchive */
router.post("/:templateId/unarchive", writeRateLimit({ windowMs: 60_000, max: 40 }), async (req: Request, res: Response) => {
  const template = await loadOwnTemplate(req, res);
  if (!template) return;
  template.isArchived = false;
  await template.save();
  res.json({ template: serializeTemplate(template) });
});

export default router;
export { serializeTemplate, loadOwnTemplate };
