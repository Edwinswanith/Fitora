import { Router, type Request, type Response } from "express";
import multer from "multer";
import { requireAuth } from "../middleware/auth";
import { writeRateLimit } from "../middleware/rateLimit";
import { User } from "../models/User";
import {
  avatarUpload,
  avatarFilePath,
  deletePriorAvatarFile,
  avatarSummary,
  isValidAvatarDefaultId,
} from "../services/avatar";

/**
 * Self-service profile-avatar management — available to every role (coach,
 * athlete, guardian) identically, so it lives in its own router gated only by
 * `requireAuth` rather than being duplicated across the three role routers.
 */
const router = Router();
router.use(requireAuth);

/** POST /api/me/avatar — multipart upload, field "file". Replaces any existing photo/default. */
router.post(
  "/avatar",
  writeRateLimit({ windowMs: 60_000, max: 10 }),
  (req: Request, res: Response, next) => {
    avatarUpload.single("file")(req, res, (err: unknown) => {
      if (!err) {
        next();
        return;
      }
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        res.status(400).json({ error: "file_too_large" });
        return;
      }
      res.status(400).json({ error: "unsupported_file_type" });
    });
  },
  async (req: Request, res: Response) => {
    if (!req.actor) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "file_required" });
      return;
    }
    const user = await User.findById(req.actor.userId);
    if (!user) {
      res.status(404).json({ error: "user_not_found" });
      return;
    }
    await deletePriorAvatarFile(user);
    user.avatarKind = "photo";
    user.avatarStoredFilename = file.filename;
    user.avatarMimeType = file.mimetype;
    user.avatarDefaultId = null;
    await user.save();
    res.status(201).json({ avatar: avatarSummary(user) });
  }
);

/** POST /api/me/avatar/default  body: { defaultId } — picks a bundled badge icon. */
router.post("/avatar/default", writeRateLimit({ windowMs: 60_000, max: 20 }), async (req: Request, res: Response) => {
  if (!req.actor) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  const defaultId = req.body?.defaultId;
  if (!isValidAvatarDefaultId(defaultId)) {
    res.status(400).json({ error: "invalid_default_id" });
    return;
  }
  const user = await User.findById(req.actor.userId);
  if (!user) {
    res.status(404).json({ error: "user_not_found" });
    return;
  }
  await deletePriorAvatarFile(user);
  user.avatarKind = "default";
  user.avatarStoredFilename = null;
  user.avatarMimeType = null;
  user.avatarDefaultId = defaultId;
  await user.save();
  res.json({ avatar: avatarSummary(user) });
});

/** DELETE /api/me/avatar — reverts to initials (no photo, no default badge). */
router.delete("/avatar", async (req: Request, res: Response) => {
  if (!req.actor) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  const user = await User.findById(req.actor.userId);
  if (!user) {
    res.status(404).json({ error: "user_not_found" });
    return;
  }
  await deletePriorAvatarFile(user);
  user.avatarKind = null;
  user.avatarStoredFilename = null;
  user.avatarMimeType = null;
  user.avatarDefaultId = null;
  await user.save();
  res.json({ avatar: avatarSummary(user) });
});

/** GET /api/me/avatar/file — streams the caller's own uploaded avatar photo. */
router.get("/avatar/file", async (req: Request, res: Response) => {
  if (!req.actor) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  const user = await User.findById(req.actor.userId).select("avatarKind avatarStoredFilename avatarMimeType").lean();
  if (!user || user.avatarKind !== "photo" || !user.avatarStoredFilename) {
    res.status(404).json({ error: "no_avatar_photo" });
    return;
  }
  const filePath = avatarFilePath(user);
  res.type(user.avatarMimeType ?? "image/jpeg");
  res.setHeader("Cache-Control", "private, max-age=0, no-store");
  res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: "file_missing" });
    }
  });
});

export default router;
