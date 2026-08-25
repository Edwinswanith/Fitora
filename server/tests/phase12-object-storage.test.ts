import fs from "fs/promises";
import os from "os";
import path from "path";
import express from "express";
import request from "supertest";
import {
  LocalDiskObjectStorageProvider,
  setObjectStorageProviderForTests,
} from "../src/services/objectStorage";

// Phase 12 §18-19: formalizes the existing local-disk upload pattern behind
// a swappable ObjectStorageProvider interface. This suite covers the adapter
// itself — it is NOT yet wired into media.ts/exerciseMedia.ts/coachVideo.ts
// (see objectStorage.ts's file doc comment for why that migration is out of
// scope for this pass).
describe("LocalDiskObjectStorageProvider", () => {
  afterEach(() => setObjectStorageProviderForTests(null));

  test("put -> serve -> delete round trip", async () => {
    const provider = new LocalDiskObjectStorageProvider();
    const tmpFile = path.join(os.tmpdir(), `phase12-obj-src-${Date.now()}.txt`);
    await fs.writeFile(tmpFile, "hello object storage");

    const key = `phase12-obj-${Date.now()}.txt`;
    await provider.putFromLocalPath(tmpFile, key);

    const app = express();
    app.get("/file", async (_req, res) => {
      await provider.serveObject(key, res, "text/plain");
    });
    const res = await request(app).get("/file");
    expect(res.status).toBe(200);
    expect(res.text).toBe("hello object storage");

    await provider.deleteObject(key);
    const appAfterDelete = express();
    appAfterDelete.get("/file", async (_req, res) => {
      try {
        await provider.serveObject(key, res, "text/plain");
      } catch {
        res.status(404).end();
      }
    });
    const afterDelete = await request(appAfterDelete).get("/file");
    expect(afterDelete.status).toBe(404);

    await fs.unlink(tmpFile).catch(() => undefined);
  });

  test("rejects a key that would escape the upload directory (path traversal)", async () => {
    const provider = new LocalDiskObjectStorageProvider();
    await expect(provider.deleteObject("../../etc/passwd")).rejects.toThrow();
  });
});
