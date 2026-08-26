import os from "os";
import path from "path";

// Multer writes real files to disk (mongodb-memory-server only fakes the DB).
// Without this, tests write into the same UPLOAD_DIR the live dev server uses
// and never clean up, leaking files on every run. Must run before any test
// file imports config/env.ts (which reads UPLOAD_DIR at import time) — hence
// a Jest `setupFiles` entry, not a beforeAll in the test file itself.
process.env.UPLOAD_DIR = path.join(os.tmpdir(), "scp-test-uploads");

// Tests must stay hermetic/deterministic regardless of what real third-party
// credentials happen to be configured in the local .env for dev/production use
// (see services/mealVisionConverter.ts, workoutImageConverter.ts, etc. — each
// falls back to a real API call whenever its key env var is non-empty). Set
// (not delete!) to an empty string here, before config/env.ts's dotenv.config()
// ever runs — dotenv only skips keys that already exist in process.env, so an
// empty string blocks it from loading the real value out of .env, while a
// deleted/absent key would just let dotenv populate it as normal. This must
// run before config/env.ts is imported by any test, so `setXForTests(null)`-
// style resets always land on the deterministic mock adapter, never a live call.
process.env.GEMINI_API_KEY = "";
