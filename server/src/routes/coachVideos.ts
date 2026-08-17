import { Router, type Request, type Response } from "express";
import { Types } from "mongoose";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/role";
import { writeRateLimit } from "../middleware/rateLimit";
import { CoachVideo, COACH_VIDEO_CATEGORIES, COACH_VIDEO_VISIBILITIES } from "../models/CoachVideo";
import { CoachVideoProgress } from "../models/CoachVideoProgress";
import { coachVideoUpload, coachVideoFilePath, deleteCoachVideoFile, serializeCoachVideo } from "../services/coachVideo";

const router = Router();
router.use(requireAuth, requireRole("coach"));

function reqStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

async function loadOwnVideo(req: Request, res: Response) {
  const id = req.params.videoId;
  if (!Types.ObjectId.isValid(id)) {
    res.status(400).json({ error: "invalid_video_id" });
    return null;
  }
  const video = await CoachVideo.findById(id);
  if (!video || !video.coachId.equals(req.actor!.userId)) {
    res.status(404).json({ error: "video_not_found" });
    return null;
  }
  return video;
}

/** GET /videos?includeArchived=1 — this coach's full library. */
router.get("/videos", async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = { coachId: req.actor!.userId };
  if (req.query.includeArchived !== "1") filter.isArchived = false;
  const videos = await CoachVideo.find(filter).sort({ createdAt: -1 }).lean();
  res.json({ videos: videos.map((v) => serializeCoachVideo(v as never)) });
});

/**
 * POST /videos — multipart upload, field "file", plus title/category (required)
 * and description/visibility/selectedClientIds (optional). Defaults to
 * visibility: "private" (draft) — the coach publishes explicitly via PATCH.
 */
router.post(
  "/videos",
  writeRateLimit({ windowMs: 60_000, max: 20 }),
  (req: Request, res: Response, next) => {
    coachVideoUpload.single("file")(req, res, (err: unknown) => {
      if (!err) return next();
      const message = err instanceof Error ? err.message : "upload_failed";
      res.status(400).json({ error: message === "unsupported_file_type" ? message : "upload_failed" });
    });
  },
  async (req: Request, res: Response) => {
    if (!req.file) return void res.status(400).json({ error: "file_required" });

    const title = reqStr(req.body?.title);
    if (!title || title.length > 160) return void res.status(400).json({ error: "invalid_title" });
    const category = req.body?.category;
    if (!COACH_VIDEO_CATEGORIES.includes(category)) return void res.status(400).json({ error: "invalid_category" });
    const description = reqStr(req.body?.description);
    if (description.length > 2000) return void res.status(400).json({ error: "invalid_description" });

    const video = await CoachVideo.create({
      coachId: req.actor!.userId,
      title,
      category,
      description: description || undefined,
      originalName: req.file.originalname,
      storedFilename: req.file.filename,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
    });
    res.status(201).json({ video: serializeCoachVideo(video) });
  }
);

/** PATCH /videos/:id — body: any of { title, description, category, visibility, selectedClientIds }. */
router.patch("/videos/:videoId", writeRateLimit({ windowMs: 60_000, max: 40 }), async (req: Request, res: Response) => {
  const video = await loadOwnVideo(req, res);
  if (!video) return;

  if (req.body?.title !== undefined) {
    const title = reqStr(req.body.title);
    if (!title || title.length > 160) return void res.status(400).json({ error: "invalid_title" });
    video.title = title;
  }
  if (req.body?.description !== undefined) {
    const description = reqStr(req.body.description);
    if (description.length > 2000) return void res.status(400).json({ error: "invalid_description" });
    video.description = description || undefined;
  }
  if (req.body?.category !== undefined) {
    if (!COACH_VIDEO_CATEGORIES.includes(req.body.category)) return void res.status(400).json({ error: "invalid_category" });
    video.category = req.body.category;
  }
  if (req.body?.visibility !== undefined) {
    if (!COACH_VIDEO_VISIBILITIES.includes(req.body.visibility)) return void res.status(400).json({ error: "invalid_visibility" });
    video.visibility = req.body.visibility;
  }
  if (req.body?.selectedClientIds !== undefined) {
    const raw = req.body.selectedClientIds;
    if (!Array.isArray(raw) || raw.length > 500 || raw.some((id: unknown) => typeof id !== "string" || !Types.ObjectId.isValid(id))) {
      return void res.status(400).json({ error: "invalid_selectedClientIds" });
    }
    video.selectedClientIds = raw.map((id: string) => new Types.ObjectId(id)) as never;
  }

  await video.save();
  res.json({ video: serializeCoachVideo(video) });
});

router.post("/videos/:videoId/archive", writeRateLimit({ windowMs: 60_000, max: 40 }), async (req: Request, res: Response) => {
  const video = await loadOwnVideo(req, res);
  if (!video) return;
  video.isArchived = true;
  await video.save();
  res.json({ video: serializeCoachVideo(video) });
});

router.post("/videos/:videoId/unarchive", writeRateLimit({ windowMs: 60_000, max: 40 }), async (req: Request, res: Response) => {
  const video = await loadOwnVideo(req, res);
  if (!video) return;
  video.isArchived = false;
  await video.save();
  res.json({ video: serializeCoachVideo(video) });
});

/** DELETE /videos/:id — hard delete (unlike WorkoutTemplate/MealPlan, a content-library upload has no downstream snapshot referencing it, so nothing else breaks). */
router.delete("/videos/:videoId", writeRateLimit({ windowMs: 60_000, max: 20 }), async (req: Request, res: Response) => {
  const video = await loadOwnVideo(req, res);
  if (!video) return;
  await deleteCoachVideoFile(video);
  await Promise.all([CoachVideo.deleteOne({ _id: video._id }), CoachVideoProgress.deleteMany({ videoId: video._id })]);
  res.json({ ok: true });
});

/** GET /videos/:id/stream — coach's own preview playback (range-request capable via res.sendFile, same as other media routes). */
router.get("/videos/:videoId/stream", async (req: Request, res: Response) => {
  const id = req.params.videoId;
  if (!Types.ObjectId.isValid(id)) return void res.status(400).json({ error: "invalid_video_id" });
  const video = await CoachVideo.findOne({ _id: id, coachId: req.actor!.userId }).lean();
  if (!video) return void res.status(404).json({ error: "video_not_found" });

  const filePath = coachVideoFilePath(video as never);
  res.type(video.mimeType);
  res.setHeader("Cache-Control", "private, max-age=0, no-store");
  res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: "file_missing" });
  });
});

export default router;
