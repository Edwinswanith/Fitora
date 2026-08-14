import os from "os";
import path from "path";

// Multer writes real files to disk (mongodb-memory-server only fakes the DB).
// Without this, tests write into the same UPLOAD_DIR the live dev server uses
// and never clean up, leaking files on every run. Must run before any test
// file imports config/env.ts (which reads UPLOAD_DIR at import time) — hence
// a Jest `setupFiles` entry, not a beforeAll in the test file itself.
process.env.UPLOAD_DIR = path.join(os.tmpdir(), "scp-test-uploads");
