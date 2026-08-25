/**
 * Object-storage abstraction for coach-uploaded media (Phase 12 §18-19).
 *
 * Audit finding this exists to address: WorkoutMedia, ExerciseMedia, and
 * CoachVideo all currently write directly to local disk via `multer.diskStorage`
 * under `env.upload.dir` (see services/media.ts, exerciseMedia.ts,
 * coachVideo.ts), with NO storage abstraction in front of them. On the actual
 * Cloud Run deployment path (CLAUDE.md's "API-only, Google Cloud Run"),
 * `env.upload.dir` resolves inside the container's writable layer, which
 * Cloud Run does NOT persist across restarts/redeploys/scale-to-zero — every
 * uploaded avatar, workout photo, exercise-demo clip, and paid content-library
 * video is silently lost on the next deploy. This was previously undocumented
 * anywhere in the codebase.
 *
 * `ObjectStorageProvider` is the swappable interface a real migration would
 * target. `LocalDiskObjectStorageProvider` below formalizes the CURRENT
 * behavior (still local-disk) behind that interface so it's the visible
 * "development adapter" the interface docs ask for — it does not, by itself,
 * fix the Cloud Run durability gap. `getObjectStorageProvider()` logs a loud,
 * one-time warning whenever the deployment looks production-bound (same
 * `strictSecrets`-style heuristic env.ts already uses for JWT secrets) and no
 * durable provider is configured, so the risk is surfaced rather than silent.
 *
 * NOT wired into services/media.ts / exerciseMedia.ts / coachVideo.ts yet —
 * migrating those three call sites to this interface (and implementing a real
 * S3/GCS-backed provider) is flagged as the next step, not completed here;
 * see the Phase 12 final report for why a full swap was out of scope for this
 * pass (regression risk on three already-tested, heavily-used upload paths
 * with no live cloud credentials available to verify against).
 */

import fsSync from "fs";
import fs from "fs/promises";
import path from "path";
import type { Response } from "express";
import { env } from "../config/env";

// Same lazy-directory-creation convention as media.ts/exerciseMedia.ts/coachVideo.ts.
fsSync.mkdirSync(env.upload.dir, { recursive: true });

export interface ObjectStorageProvider {
  /** Human-readable id for logging/diagnostics (e.g. "local-disk", "gcs"). */
  readonly name: string;
  /** Whether this adapter durably survives a container restart/redeploy. */
  readonly durable: boolean;
  /** Moves/copies a just-received local temp file (e.g. from multer) into durable storage under `key`. */
  putFromLocalPath(localPath: string, key: string): Promise<void>;
  /** Streams the object back to an Express response — must support the same Range-request behavior res.sendFile already provides for video scrubbing. */
  serveObject(key: string, res: Response, contentType: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
}

/**
 * Formalizes the existing local-disk pattern (multer already wrote the file
 * to `env.upload.dir` under `key`==storedFilename — see media.ts/
 * exerciseMedia.ts/coachVideo.ts) behind the ObjectStorageProvider interface.
 * Safe for local dev and CI. NOT durable on Cloud Run — see file doc comment.
 */
export class LocalDiskObjectStorageProvider implements ObjectStorageProvider {
  readonly name = "local-disk";
  readonly durable = false;

  private resolve(key: string): string {
    const resolved = path.join(env.upload.dir, key);
    if (path.dirname(resolved) !== env.upload.dir) {
      throw new Error("invalid_object_key");
    }
    return resolved;
  }

  async putFromLocalPath(localPath: string, key: string): Promise<void> {
    const dest = this.resolve(key);
    if (path.resolve(localPath) === dest) return; // multer already wrote it directly here — no-op
    await fs.copyFile(localPath, dest);
  }

  async serveObject(key: string, res: Response, contentType: string): Promise<void> {
    const filePath = this.resolve(key);
    res.type(contentType);
    res.setHeader("Cache-Control", "private, max-age=0, no-store");
    await new Promise<void>((resolve, reject) => {
      res.sendFile(filePath, (err) => (err ? reject(err) : resolve()));
    });
  }

  async deleteObject(key: string): Promise<void> {
    await fs.unlink(this.resolve(key)).catch(() => undefined);
  }
}

let provider: ObjectStorageProvider | null = null;
let warned = false;

/**
 * Single choke point for resolving the active object-storage provider —
 * mirrors the getPaymentProvider()/getVideoProvider() pattern. Currently
 * always resolves to LocalDiskObjectStorageProvider (no cloud adapter exists
 * yet — see file doc comment); the env-var check below is future-proofing so
 * a real adapter can be dropped in later without callers changing.
 */
export function getObjectStorageProvider(): ObjectStorageProvider {
  if (!provider) {
    // No cloud provider is implemented yet (OBJECT_STORAGE_* is reserved for
    // when one is). This block exists to make the gap loud, not silent.
    const hasCloudConfig = Boolean(process.env.OBJECT_STORAGE_BUCKET);
    if (env.strictSecrets && !hasCloudConfig && !warned) {
      warned = true;
      console.warn(
        "[objectStorage] WARNING: running against a remote/production database with no durable object storage configured. " +
          "Coach-uploaded media (avatars, workout photos, exercise clips, content-library videos) is being written to " +
          "local disk, which is NOT persisted across a Cloud Run restart/redeploy/scale-to-zero. This is a known, " +
          "unresolved production gap — see services/objectStorage.ts."
      );
    }
    provider = new LocalDiskObjectStorageProvider();
  }
  return provider;
}

/** Test-only seam for injecting a fake provider. */
export function setObjectStorageProviderForTests(impl: ObjectStorageProvider | null): void {
  provider = impl;
  warned = false;
}
