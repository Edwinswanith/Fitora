import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import multer from "multer";
import { Types, type HydratedDocument } from "mongoose";
import { env } from "../config/env";
import {
  WorkoutMedia,
  type WorkoutMediaDoc,
  type MediaContext,
  ALLOWED_MEDIA_MIME_TYPES,
  type AllowedMediaMimeType,
} from "../models/WorkoutMedia";
import { getWorkoutImageConverter, sanitizeWorkoutTableRows, type WorkoutTableRow } from "./workoutImageConverter";

const EXT_BY_MIME: Record<AllowedMediaMimeType, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

fs.mkdirSync(env.upload.dir, { recursive: true });

/**
 * Multer instance for coach media uploads. Storage is local disk under
 * env.upload.dir — never a statically-served directory (see index.ts). The
 * stored filename is a generated UUID, never derived from the client-supplied
 * originalname, so there is no path-traversal or filename-collision surface.
 */
export const mediaUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, env.upload.dir),
    filename: (_req, file, cb) => {
      const ext = EXT_BY_MIME[file.mimetype as AllowedMediaMimeType] ?? "";
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: env.upload.maxSizeBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MEDIA_MIME_TYPES.includes(file.mimetype as AllowedMediaMimeType)) {
      cb(new Error("unsupported_file_type"));
      return;
    }
    cb(null, true);
  },
});

/** Absolute path of the stored file, guaranteed to stay within the upload dir. */
export function mediaFilePath(doc: Pick<WorkoutMediaDoc, "storedFilename">): string {
  const resolved = path.join(env.upload.dir, doc.storedFilename);
  if (path.dirname(resolved) !== env.upload.dir) {
    // Defense in depth — storedFilename is always a server-generated UUID, so
    // this should be unreachable, but never stream a path outside the dir.
    throw new Error("invalid_stored_filename");
  }
  return resolved;
}

export type MediaView = {
  id: string;
  athleteId: string;
  coachId: string;
  context: MediaContext;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sent: boolean;
  sentAt: string | null;
  conversion: {
    status: string;
    table: WorkoutTableRow[];
    convertedAt: string | null;
    error: string | null;
  };
  createdAt: string;
};

export function serializeMedia(m: WorkoutMediaDoc): MediaView {
  return {
    id: m._id.toString(),
    athleteId: (m.athleteId as Types.ObjectId).toString(),
    coachId: (m.coachId as Types.ObjectId).toString(),
    context: m.context as MediaContext,
    originalName: m.originalName,
    mimeType: m.mimeType,
    sizeBytes: m.sizeBytes,
    sent: m.sentAt != null,
    sentAt: m.sentAt ? (m.sentAt as Date).toISOString() : null,
    conversion: {
      status: m.conversion?.status ?? "none",
      table: (m.conversion?.table ?? []) as WorkoutTableRow[],
      convertedAt: m.conversion?.convertedAt ? (m.conversion.convertedAt as Date).toISOString() : null,
      error: m.conversion?.error ?? null,
    },
    createdAt: (m.createdAt as Date).toISOString(),
  };
}

/**
 * Marks the media as sent (visible to the athlete via the file-download
 * routes). Does NOT fire a notification — the caller is expected to also post
 * this media into the coach⇄athlete chat via `sendMessage({ mediaId })`,
 * which fires the (single) notification for the delivery.
 */
export async function markMediaSent(
  media: HydratedDocument<WorkoutMediaDoc>
): Promise<HydratedDocument<WorkoutMediaDoc>> {
  if (!media.sentAt) {
    media.sentAt = new Date();
    await media.save();
  }
  return media;
}

/**
 * Runs the (currently mock) workout-image converter and persists the result.
 * Never throws — a conversion failure is recorded on the document, not
 * propagated, so it can't take down the request that triggered it.
 */
export async function convertMediaToTable(
  media: HydratedDocument<WorkoutMediaDoc>
): Promise<HydratedDocument<WorkoutMediaDoc>> {
  // Mongoose always initializes this nested path to its schema defaults, so it
  // is never actually undefined at runtime — but InferSchemaType can't know
  // that, hence the non-null assertions below.
  media.conversion!.status = "pending";
  await media.save();

  try {
    const rows = await getWorkoutImageConverter().convert({
      filePath: mediaFilePath(media),
      mimeType: media.mimeType,
      originalName: media.originalName,
    });
    media.conversion!.status = "completed";
    media.conversion!.table = rows as unknown as NonNullable<WorkoutMediaDoc["conversion"]>["table"];
    media.conversion!.convertedAt = new Date();
    media.conversion!.error = null;
  } catch (err) {
    media.conversion!.status = "failed";
    media.conversion!.error = (err as Error).message || "conversion_failed";
  }
  await media.save();
  return media;
}

/**
 * Lets the coach correct/fill in the extracted table (e.g. the source image
 * had no explicit sets/reps for some rows) before sending it on to the
 * athlete. Only allowed pre-send — once `sentAt` is set the athlete has
 * already seen the table, so it becomes immutable, same as the raw image.
 * Rejects with "already_sent" instead of silently no-op'ing.
 */
export async function updateMediaTable(
  media: HydratedDocument<WorkoutMediaDoc>,
  rows: unknown
): Promise<HydratedDocument<WorkoutMediaDoc>> {
  if (media.sentAt) {
    throw new Error("already_sent");
  }
  const sanitized = sanitizeWorkoutTableRows(rows);
  media.conversion!.status = "completed";
  media.conversion!.table = sanitized as unknown as NonNullable<WorkoutMediaDoc["conversion"]>["table"];
  media.conversion!.convertedAt = new Date();
  media.conversion!.error = null;
  await media.save();
  return media;
}
