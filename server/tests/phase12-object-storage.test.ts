import fs from "fs/promises";
import fsSync from "fs";
import os from "os";
import path from "path";
import express from "express";
import request from "supertest";
import { env } from "../src/config/env";
import {
  GcsObjectStorageProvider,
  LocalDiskObjectStorageProvider,
  sendStoredObject,
  setObjectStorageProviderForTests,
  withLocalObjectCopy,
} from "../src/services/objectStorage";

function appServing(key: string, contentType = "text/plain") {
  const app = express();
  app.get("/file", (_req, res) => void sendStoredObject(res, key, contentType));
  return app;
}

describe("LocalDiskObjectStorageProvider", () => {
  afterEach(() => setObjectStorageProviderForTests(null));

  test("put -> serve -> delete round trip, with a 404 once deleted", async () => {
    const provider = new LocalDiskObjectStorageProvider();
    setObjectStorageProviderForTests(provider);
    const tmpFile = path.join(os.tmpdir(), `obj-src-${Date.now()}.txt`);
    await fs.writeFile(tmpFile, "hello object storage");

    const key = `obj-${Date.now()}.txt`;
    await provider.putFromLocalPath(tmpFile, key);

    const res = await request(appServing(key)).get("/file");
    expect(res.status).toBe(200);
    expect(res.text).toBe("hello object storage");

    const ranged = await request(appServing(key)).get("/file").set("Range", "bytes=0-4");
    expect(ranged.status).toBe(206);
    expect(ranged.text).toBe("hello");

    await provider.deleteObject(key);
    const afterDelete = await request(appServing(key)).get("/file");
    expect(afterDelete.status).toBe(404);
    expect(afterDelete.body).toEqual({ error: "file_missing" });

    await fs.unlink(tmpFile).catch(() => undefined);
  });

  test("rejects a key that would escape the upload directory (path traversal)", async () => {
    const provider = new LocalDiskObjectStorageProvider();
    await expect(provider.deleteObject("../../etc/passwd")).rejects.toThrow();
    await expect(provider.readObject("a/b.txt")).rejects.toThrow("invalid_object_key");
  });
});

type FakeCall = { url: string; init?: RequestInit };

/** Minimal in-memory GCS JSON API: token, media upload, ranged download, delete. */
function fakeGcs() {
  const objects = new Map<string, { body: Buffer; type: string }>();
  const calls: FakeCall[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.startsWith("http://metadata.google.internal/")) {
      return new Response(JSON.stringify({ access_token: "meta-token", expires_in: 3600 }), { status: 200 });
    }
    const headers = new Headers(init?.headers);
    if (headers.get("authorization") !== "Bearer meta-token") return new Response("no auth", { status: 401 });

    const upload = url.match(/\/upload\/storage\/v1\/b\/([^/]+)\/o\?uploadType=media&name=(.+)$/);
    if (upload && init?.method === "POST") {
      const body = Buffer.from(await new Response(init.body as BodyInit).arrayBuffer());
      objects.set(decodeURIComponent(upload[2]), { body, type: headers.get("content-type") ?? "" });
      return new Response("{}", { status: 200 });
    }
    const obj = url.match(/\/storage\/v1\/b\/([^/]+)\/o\/([^?]+)(\?alt=media)?$/);
    if (obj) {
      const name = decodeURIComponent(obj[2]);
      const stored = objects.get(name);
      if (init?.method === "DELETE") {
        objects.delete(name);
        return new Response(null, { status: stored ? 204 : 404 });
      }
      if (!stored) return new Response("not found", { status: 404 });
      const range = headers.get("range")?.match(/^bytes=(\d+)-(\d+)$/);
      if (range) {
        const start = Number(range[1]);
        const end = Math.min(Number(range[2]), stored.body.length - 1);
        return new Response(stored.body.subarray(start, end + 1), {
          status: 206,
          headers: { "Content-Range": `bytes ${start}-${end}/${stored.body.length}`, "Content-Length": String(end - start + 1) },
        });
      }
      return new Response(stored.body, { status: 200, headers: { "Content-Length": String(stored.body.length) } });
    }
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;
  return { objects, calls, fetchImpl };
}

describe("GcsObjectStorageProvider", () => {
  afterEach(() => setObjectStorageProviderForTests(null));

  async function tempUpload(content: string) {
    const key = `gcs-${Date.now()}-${Math.round(Math.random() * 1e6)}.mp4`;
    const localPath = path.join(env.upload.dir, key);
    await fs.writeFile(localPath, content);
    return { key, localPath };
  }

  test("uploads under the prefix and removes the temp file", async () => {
    const gcs = fakeGcs();
    const provider = new GcsObjectStorageProvider("my-bucket", "uploads/", null, gcs.fetchImpl);
    const { key, localPath } = await tempUpload("video bytes");

    await provider.putFromLocalPath(localPath, key, "video/mp4");

    expect(gcs.objects.get(`uploads/${key}`)?.body.toString()).toBe("video bytes");
    expect(gcs.objects.get(`uploads/${key}`)?.type).toBe("video/mp4");
    expect(fsSync.existsSync(localPath)).toBe(false);
    expect(gcs.calls[0].url).toContain("metadata.google.internal");
  });

  test("serves full and ranged reads, and 404s a missing object", async () => {
    const gcs = fakeGcs();
    const provider = new GcsObjectStorageProvider("my-bucket", "uploads/", null, gcs.fetchImpl);
    setObjectStorageProviderForTests(provider);
    const { key, localPath } = await tempUpload("0123456789");
    await provider.putFromLocalPath(localPath, key, "video/mp4");

    const full = await request(appServing(key, "video/mp4")).get("/file").buffer(true);
    expect(full.status).toBe(200);
    expect(full.headers["accept-ranges"]).toBe("bytes");
    expect(full.body.toString()).toBe("0123456789");

    const ranged = await request(appServing(key, "video/mp4")).get("/file").set("Range", "bytes=2-5").buffer(true);
    expect(ranged.status).toBe(206);
    expect(ranged.headers["content-range"]).toBe("bytes 2-5/10");
    expect(ranged.body.toString()).toBe("2345");

    const missing = await request(appServing("does-not-exist.mp4", "video/mp4")).get("/file");
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: "file_missing" });
  });

  test("falls back to a local file uploaded before the bucket was enabled", async () => {
    const gcs = fakeGcs();
    const provider = new GcsObjectStorageProvider("my-bucket", "uploads/", null, gcs.fetchImpl);
    setObjectStorageProviderForTests(provider);
    const { key, localPath } = await tempUpload("legacy local bytes");

    const res = await request(appServing(key)).get("/file");
    expect(res.status).toBe(200);
    expect(res.text).toBe("legacy local bytes");
    await fs.unlink(localPath).catch(() => undefined);
  });

  test("delete removes the object; withLocalObjectCopy downloads and cleans up", async () => {
    const gcs = fakeGcs();
    const provider = new GcsObjectStorageProvider("my-bucket", "uploads/", null, gcs.fetchImpl);
    setObjectStorageProviderForTests(provider);
    const { key, localPath } = await tempUpload("image bytes");
    await provider.putFromLocalPath(localPath, key, "image/jpeg");

    let seenPath = "";
    const text = await withLocalObjectCopy(key, async (filePath) => {
      seenPath = filePath;
      return fs.readFile(filePath, "utf8");
    });
    expect(text).toBe("image bytes");
    expect(fsSync.existsSync(seenPath)).toBe(false);

    await provider.deleteObject(key);
    expect(gcs.objects.has(`uploads/${key}`)).toBe(false);
  });

  test("refuses keys that are not plain generated filenames", async () => {
    const gcs = fakeGcs();
    const provider = new GcsObjectStorageProvider("my-bucket", "uploads/", null, gcs.fetchImpl);
    await expect(provider.readObject("../secrets.json")).rejects.toThrow("invalid_object_key");
    await expect(provider.readObject("other/prefix.jpg")).rejects.toThrow("invalid_object_key");
  });
});
