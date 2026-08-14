import fs from "fs";
import os from "os";
import path from "path";

// Removes the temp upload dir created by tests/env-setup.ts once the whole
// suite finishes, so repeated `npm test` runs don't accumulate files.
export default async function globalTeardown(): Promise<void> {
  const dir = path.join(os.tmpdir(), "scp-test-uploads");
  await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined);
}
