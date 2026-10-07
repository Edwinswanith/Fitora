import { Router, type Request, type Response } from "express";
import { Types } from "mongoose";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/role";
import { loadScope } from "../middleware/coachAthleteAccess";
import { writeRateLimit } from "../middleware/rateLimit";
import { CoachVideo } from "../models/CoachVideo";
import { CoachVideoProgress } from "../models/CoachVideoProgress";
import {
  serializeCoachVideo,
  loadAthleteVideoAccessContext,
  isVideoVisible,
  canAthleteAccessVideo,
} from "../services/coachVideo";
import { sendStoredObject } from "../services/objectStorage";

const router = Router();
router.use(requireAuth, requireRole("athlete"), loadScope);

function selfAthleteId(req: Request): Types.ObjectId | null {
  return req.actor?.athleteProfileId ?? null;
}

/** GET /coach-videos?coachId= — this coach's library, filtered to what this athlete may actually see. */
router.get("/coach-videos", async (req: Request, res: Response) => {
  const athleteId = selfAthleteId(req);
  if (!athleteId) return void res.status(404).json({ error: "athlete_profile_not_found" });

  const coachId = req.query.coachId;
  if (typeof coachId !== "string" || !Types.ObjectId.isValid(coachId)) {
    return void res.status(400).json({ error: "invalid_coach_id" });
  }

  const context = await loadAthleteVideoAccessContext(new Types.ObjectId(coachId), athleteId);
  const videos = await CoachVideo.find({ coachId, isArchived: false, visibility: { $ne: "private" } })
    .sort({ createdAt: -1 })
    .lean();
  const visible = videos.filter((v) => isVideoVisible(v as never, athleteId, context));
  res.json({ videos: visible.map((v) => serializeCoachVideo(v as never)) });
});

/** GET /coach-videos/:id — video detail + this athlete's own progress. */
router.get("/coach-videos/:videoId", async (req: Request, res: Response) => {
  const athleteId = selfAthleteId(req);
  if (!athleteId) return void res.status(404).json({ error: "athlete_profile_not_found" });

  const id = req.params.videoId;
  if (!Types.ObjectId.isValid(id)) return void res.status(400).json({ error: "invalid_video_id" });
  const video = await CoachVideo.findOne({ _id: id, isArchived: false }).lean();
  if (!video || !(await canAthleteAccessVideo(video as never, athleteId))) {
    return void res.status(404).json({ error: "video_not_found" });
  }

  const progress = await CoachVideoProgress.findOne({ videoId: id, athleteId }).lean();
  res.json({
    video: serializeCoachVideo(video as never),
    progress: progress
      ? { status: progress.status, progressPercent: progress.progressPercent, lastPositionSec: progress.lastPositionSec }
      : { status: "not_started", progressPercent: 0, lastPositionSec: 0 },
  });
});

/** GET /coach-videos/:id/stream — visibility-checked, range-request capable playback. Never a bare/public URL. */
router.get("/coach-videos/:videoId/stream", async (req: Request, res: Response) => {
  const athleteId = selfAthleteId(req);
  if (!athleteId) return void res.status(404).json({ error: "athlete_profile_not_found" });

  const id = req.params.videoId;
  if (!Types.ObjectId.isValid(id)) return void res.status(400).json({ error: "invalid_video_id" });
  const video = await CoachVideo.findOne({ _id: id, isArchived: false }).lean();
  if (!video || !(await canAthleteAccessVideo(video as never, athleteId))) {
    return void res.status(404).json({ error: "video_not_found" });
  }

  await sendStoredObject(res, video.storedFilename, video.mimeType);
});

/**
 * POST /coach-videos/:id/progress — body: { positionSec, completed? }. A
 * checkpoint write, not a per-tick one — the client is expected to throttle
 * calls (pause / every N seconds / app-background), same discipline as any
 * other high-frequency-candidate write in this codebase.
 */
router.post("/coach-videos/:videoId/progress", writeRateLimit({ windowMs: 60_000, max: 30 }), async (req: Request, res: Response) => {
  const athleteId = selfAthleteId(req);
  if (!athleteId) return void res.status(404).json({ error: "athlete_profile_not_found" });

  const id = req.params.videoId;
  if (!Types.ObjectId.isValid(id)) return void res.status(400).json({ error: "invalid_video_id" });
  const video = await CoachVideo.findOne({ _id: id, isArchived: false }).lean();
  if (!video || !(await canAthleteAccessVideo(video as never, athleteId))) {
    return void res.status(404).json({ error: "video_not_found" });
  }

  const positionSec = Number(req.body?.positionSec);
  if (!Number.isFinite(positionSec) || positionSec < 0) return void res.status(400).json({ error: "invalid_positionSec" });
  const explicitCompleted = req.body?.completed === true;

  const durationSec = (video.durationSec as number | null) ?? null;
  const progressPercent = durationSec && durationSec > 0 ? Math.min(100, Math.round((positionSec / durationSec) * 100)) : 0;
  const status = explicitCompleted || progressPercent >= 95 ? "completed" : progressPercent > 0 || positionSec > 0 ? "viewed" : "not_started";

  const updated = await CoachVideoProgress.findOneAndUpdate(
    { videoId: id, athleteId },
    { $set: { status, progressPercent, lastPositionSec: positionSec } },
    { upsert: true, new: true, runValidators: true }
  );
  res.json({ progress: { status: updated!.status, progressPercent: updated!.progressPercent, lastPositionSec: updated!.lastPositionSec } });
});

export default router;
