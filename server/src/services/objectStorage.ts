/**
 * Object storage for user-uploaded media: avatars, coach workout photos,
 * training-session photos, exercise-demo clips, content-library videos and
 * meal-scan photos.
 *
 * Why this exists: on Cloud Run (and Vercel) the container disk is temporary,
 * so files kept only under `env.upload.dir` vanish on every redeploy, restart
 * or scale-to-zero. With OBJECT_STORAGE_BUCKET set, uploads go to Google Cloud
 * Storage and survive; without it (local dev, CI) the local-disk adapter keeps
 * the old behavior.
 *
 * Flow, same for every upload route:
 *   1. multer writes the request body to a temp file in env.upload.dir, named
 *      by a server-generated UUID (that name is the object key; never the
 *      client's filename).
 *   2. the route calls `persistUpload(req.file)`; the GCS adapter uploads it
 *      and deletes the temp file, the local adapter leaves it in place.
 *   3. reads go through authenticated routes into `sendStoredObject`, which
 *      supports HTTP Range requests (video scrubbing) on both adapters.
 *
 * Follows the external-provider adapter pattern (CLAUDE.md): an interface, a
 * real fetch/JWT adapter with no vendor SDK, and an offline adapter, resolved
 * once by `getObjectStorageProvider()`.
 */

import fsSync from "fs";
import fs from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import type { ReadableStream as WebReadableStream } from "stream/web";
import type { Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

fsSync.mkdirSync(env.upload.dir, { recursive: true });

export class ObjectNotFoundError extends Error {
  constructor(key: string) {
    super(`object_not_found:${key}`);
    this.name = "ObjectNotFoundError";
  }
}

export interface ObjectStorageProvider {
  /** Human-readable id for logging/diagnostics ("local-disk", "gcs"). */
  readonly name: string;
  /** Whether stored objects survive a container restart/redeploy. */
  readonly durable: boolean;
  /** Takes ownership of a just-received temp file (from multer) and stores it under `key`. */
  putFromLocalPath(localPath: string, key: string, contentType: string): Promise<void>;
  /**
   * Streams the object to the response, honoring the request's Range header.
   * The caller sets Content-Type/Cache-Control first. Throws ObjectNotFoundError
   * before writing anything when the object doesn't exist.
   */
  serveObject(key: string, res: Response): Promise<void>;
  /** Whole object as bytes (AI conversions). Throws ObjectNotFoundError. */
  readObject(key: string): Promise<Buffer>;
  /** Best-effort delete; a missing object is not an error. */
  deleteObject(key: string): Promise<void>;
}

// Keys are server-generated (`${uuid}${ext}`, or test fixtures); anything else
// is refused so a key can never address a path or another prefix.
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

export function assertValidObjectKey(key: string): void {
  if (!KEY_PATTERN.test(key) || key.includes("..")) throw new Error("invalid_object_key");
}

function localPathFor(key: string): string {
  assertValidObjectKey(key);
  const resolved = path.join(env.upload.dir, key);
  if (path.dirname(resolved) !== env.upload.dir) throw new Error("invalid_object_key");
  return resolved;
}

function isMissingFileError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  const status = (err as { status?: number; statusCode?: number } | undefined)?.status ?? (err as { statusCode?: number } | undefined)?.statusCode;
  return code === "ENOENT" || code === "ENOTDIR" || status === 404;
}

/** Current behavior, for local dev and tests. Not durable on Cloud Run/Vercel. */
export class LocalDiskObjectStorageProvider implements ObjectStorageProvider {
  readonly name = "local-disk";
  readonly durable = false;

  async putFromLocalPath(localPath: string, key: string): Promise<void> {
    const dest = localPathFor(key);
    if (path.resolve(localPath) === dest) return; // multer already wrote it here
    await fs.copyFile(localPath, dest);
  }

  async serveObject(key: string, res: Response): Promise<void> {
    const filePath = localPathFor(key);
    await new Promise<void>((resolve, reject) => {
      res.sendFile(filePath, (err) => {
        if (!err) return resolve();
        reject(isMissingFileError(err) && !res.headersSent ? new ObjectNotFoundError(key) : err);
      });
    });
  }

  async readObject(key: string): Promise<Buffer> {
    try {
      return await fs.readFile(localPathFor(key));
    } catch (err) {
      if (isMissingFileError(err)) throw new ObjectNotFoundError(key);
      throw err;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await fs.unlink(localPathFor(key)).catch(() => undefined);
  }
}

type ServiceAccount = { client_email: string; private_key: string };
type FetchLike = typeof fetch;

export function parseGcsServiceAccount(raw: string): ServiceAccount | null {
  if (!raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
    if (typeof parsed.client_email === "string" && typeof parsed.private_key === "string") {
      return { client_email: parsed.client_email, private_key: parsed.private_key };
    }
  } catch {
    // fall through
  }
  console.warn("[objectStorage] GCS_SERVICE_ACCOUNT_JSON is set but unusable; falling back to the metadata server");
  return null;
}

const GCS_SCOPE = "https://www.googleapis.com/auth/devstorage.read_write";
const METADATA_TOKEN_URL = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";
// Headers worth forwarding from GCS to the client for ranged playback.
const PASSTHROUGH_HEADERS = ["content-length", "content-range", "accept-ranges", "etag", "last-modified"];

/**
 * Google Cloud Storage via the JSON API (no SDK). Objects live at
 * `gs://<bucket>/<prefix><key>`. Files uploaded before the bucket was turned
 * on are still served from local disk if they happen to exist there.
 */
export class GcsObjectStorageProvider implements ObjectStorageProvider {
  readonly name = "gcs";
  readonly durable = true;
  private cachedToken: { value: string; expiresAt: number } | null = null;
  private readonly local = new LocalDiskObjectStorageProvider();

  constructor(
    private readonly bucket: string,
    private readonly prefix: string,
    private readonly serviceAccount: ServiceAccount | null,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  private objectName(key: string): string {
    assertValidObjectKey(key);
    return `${this.prefix}${key}`;
  }

  private objectUrl(key: string): string {
    return `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(this.bucket)}/o/${encodeURIComponent(this.objectName(key))}`;
  }

  private async accessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAt - 5 * 60_000 > now) return this.cachedToken.value;

    let res: globalThis.Response;
    if (this.serviceAccount) {
      const iat = Math.floor(now / 1000);
      const assertion = jwt.sign(
        { iss: this.serviceAccount.client_email, scope: GCS_SCOPE, aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 3600 },
        this.serviceAccount.private_key,
        { algorithm: "RS256" }
      );
      res = await this.fetchImpl("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
      });
    } else {
      // Cloud Run / GCE: the runtime service account's token, no key file needed.
      res = await this.fetchImpl(METADATA_TOKEN_URL, { headers: { "Metadata-Flavor": "Google" } });
    }
    if (!res.ok) throw new Error(`gcs_auth_http_${res.status}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.cachedToken = { value: json.access_token, expiresAt: now + json.expires_in * 1000 };
    return json.access_token;
  }

  async putFromLocalPath(localPath: string, key: string, contentType: string): Promise<void> {
    const { size } = await fs.stat(localPath);
    const token = await this.accessToken();
    const url =
      `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(this.bucket)}/o` +
      `?uploadType=media&name=${encodeURIComponent(this.objectName(key))}`;
    const body = Readable.toWeb(fsSync.createReadStream(localPath)) as unknown as BodyInit;
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType || "application/octet-stream", "Content-Length": String(size) },
      body,
      // Required by Node's fetch for a streamed request body.
      duplex: "half",
    } as RequestInit);
    if (!res.ok) throw new Error(`gcs_upload_http_${res.status}`);
    // The container disk is memory-backed on Cloud Run: free it now.
    await fs.unlink(localPath).catch(() => undefined);
  }

  private async getMedia(key: string, range?: string): Promise<globalThis.Response> {
    const token = await this.accessToken();
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (range) headers.Range = range;
    return this.fetchImpl(`${this.objectUrl(key)}?alt=media`, { headers });
  }

  private localCopyExists(key: string): boolean {
    try {
      return fsSync.existsSync(localPathFor(key));
    } catch {
      return false;
    }
  }

  async serveObject(key: string, res: Response): Promise<void> {
    const rangeHeader = res.req?.headers?.range;
    const upstream = await this.getMedia(key, typeof rangeHeader === "string" ? rangeHeader : undefined);
    if (upstream.status === 404) {
      if (this.localCopyExists(key)) return this.local.serveObject(key, res);
      throw new ObjectNotFoundError(key);
    }
    if (upstream.status === 416) {
      res.status(416).end();
      return;
    }
    if (!upstream.ok || !upstream.body) throw new Error(`gcs_download_http_${upstream.status}`);
    res.status(upstream.status); // 200, or 206 for a Range request
    for (const name of PASSTHROUGH_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    if (!res.getHeader("accept-ranges")) res.setHeader("Accept-Ranges", "bytes");
    await pipeline(Readable.fromWeb(upstream.body as unknown as WebReadableStream), res);
  }

  async readObject(key: string): Promise<Buffer> {
    const res = await this.getMedia(key);
    if (res.status === 404) {
      if (this.localCopyExists(key)) return this.local.readObject(key);
      throw new ObjectNotFoundError(key);
    }
    if (!res.ok) throw new Error(`gcs_download_http_${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async deleteObject(key: string): Promise<void> {
    await this.local.deleteObject(key);
    try {
      const token = await this.accessToken();
      const res = await this.fetchImpl(this.objectUrl(key), { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok && res.status !== 404) console.warn(`[objectStorage] delete ${key} failed: http ${res.status}`);
    } catch (err) {
      console.warn(`[objectStorage] delete ${key} failed:`, (err as Error).message);
    }
  }
}

let provider: ObjectStorageProvider | null = null;

/** Resolves the active provider once: GCS when OBJECT_STORAGE_BUCKET is set, else local disk. */
export function getObjectStorageProvider(): ObjectStorageProvider {
  if (provider) return provider;
  const { bucket, prefix, serviceAccountJson } = env.objectStorage;
  if (bucket) {
    provider = new GcsObjectStorageProvider(bucket, prefix, parseGcsServiceAccount(serviceAccountJson));
  } else {
    if (env.strictSecrets) {
      console.warn(
        "[objectStorage] WARNING: production-like deployment with no OBJECT_STORAGE_BUCKET. Uploaded media is kept on " +
          "local disk and will be lost on the next Cloud Run/Vercel restart or redeploy."
      );
    }
    provider = new LocalDiskObjectStorageProvider();
  }
  return provider;
}

/** Test-only seam for injecting a fake provider. */
export function setObjectStorageProviderForTests(impl: ObjectStorageProvider | null): void {
  provider = impl;
}

type UploadedFile = { path: string; filename: string; mimetype: string };

/** Step 2 of the flow above: hand a multer temp file to the active provider. */
export async function persistUpload(file: UploadedFile): Promise<void> {
  await getObjectStorageProvider().putFromLocalPath(file.path, file.filename, file.mimetype);
}

/**
 * Route helper: persists the upload, or answers 502 and drops the temp file.
 * Call it after validation and before writing the database row, so a row
 * never points at an object that was never stored.
 */
export async function persistUploadOrRespond(file: UploadedFile, res: Response): Promise<boolean> {
  try {
    await persistUpload(file);
    return true;
  } catch (err) {
    console.error(`[objectStorage] store ${file.filename} failed:`, (err as Error).message);
    await discardUpload(file);
    if (!res.headersSent) res.status(502).json({ error: "storage_unavailable" });
    return false;
  }
}

/** Drops a temp upload that was rejected before being persisted. */
export async function discardUpload(file: Pick<UploadedFile, "path"> | undefined): Promise<void> {
  if (file?.path) await fs.unlink(file.path).catch(() => undefined);
}

/**
 * Serves a stored object from an authenticated route: sets the content type
 * and no-store caching, streams with Range support, and turns a missing
 * object into the same 404 `file_missing` the routes always returned.
 */
export async function sendStoredObject(res: Response, key: string, contentType: string): Promise<void> {
  res.type(contentType);
  res.setHeader("Cache-Control", "private, max-age=0, no-store");
  try {
    await getObjectStorageProvider().serveObject(key, res);
  } catch (err) {
    if (res.headersSent) {
      res.destroy(err as Error);
      return;
    }
    res.removeHeader("Content-Type"); // the error body is JSON, not the media type
    if (err instanceof ObjectNotFoundError || isMissingFileError(err)) {
      res.status(404).json({ error: "file_missing" });
      return;
    }
    console.error(`[objectStorage] serve ${key} failed:`, (err as Error).message);
    res.status(502).json({ error: "storage_unavailable" });
  }
}

export function readStoredObject(key: string): Promise<Buffer> {
  return getObjectStorageProvider().readObject(key);
}

/** Best-effort; never throws (cleanup paths must not fail the request). */
export async function deleteStoredObject(key: string | null | undefined): Promise<void> {
  if (!key) return;
  await getObjectStorageProvider().deleteObject(key).catch(() => undefined);
}

/**
 * Runs `fn` with a local file path for an object (the AI converters read a
 * path). Uses the temp upload if it's still on disk, else downloads to a temp
 * file and removes it afterwards.
 */
export async function withLocalObjectCopy<T>(key: string, fn: (filePath: string) => Promise<T>): Promise<T> {
  const existing = localPathFor(key);
  if (fsSync.existsSync(existing)) return fn(existing);
  const tmp = path.join(env.upload.dir, `tmp-${process.pid}-${Date.now()}-${key}`);
  await fs.writeFile(tmp, await readStoredObject(key));
  try {
    return await fn(tmp);
  } finally {
    await fs.unlink(tmp).catch(() => undefined);
  }
}
