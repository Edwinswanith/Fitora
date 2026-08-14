import { createServer } from "http";
import { env } from "./config/env";
import { connectMongo } from "./db/mongoose";
import { attachVoiceStreamProxy } from "./routes/voiceStream";
import { createApp } from "./app";

async function main() {
  // Last-resort process guards — keep the server alive on stray rejections.
  process.on("unhandledRejection", (reason) => {
    console.error("[unhandledRejection]", reason);
  });
  process.on("uncaughtException", (err) => {
    console.error("[uncaughtException]", err);
  });

  const app = createApp();
  const server = createServer(app);
  attachVoiceStreamProxy(server);

  await connectMongo();

  server.listen(env.port, () => {
    console.log(`[server] listening on http://localhost:${env.port}`);
  });
}

main().catch((err) => {
  console.error("[server] fatal startup error:", err);
  process.exit(1);
});
