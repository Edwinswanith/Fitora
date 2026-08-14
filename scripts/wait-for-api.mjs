const url = process.env.DEV_API_HEALTH_URL ?? "http://127.0.0.1:4000/api/health";
const timeoutMs = Number(process.env.DEV_API_WAIT_TIMEOUT_MS ?? 60000);
const intervalMs = 500;
const startedAt = Date.now();

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

while (Date.now() - startedAt < timeoutMs) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (res.ok) {
      console.log(`[wait-for-api] ready: ${url}`);
      process.exit(0);
    }
  } catch {
    // Server is still starting.
  }
  await sleep(intervalMs);
}

console.error(`[wait-for-api] timed out after ${timeoutMs}ms waiting for ${url}`);
process.exit(1);
