// Local dev database for the sports-coaching-platform.
//
// This machine has no installed `mongod` and the Atlas cluster needs IP
// whitelisting, so for local dev we run an in-memory MongoDB pinned to the
// port `server/.env` expects: mongodb://127.0.0.1:27017/athletes.
//
// Usage:  node server/scripts/dev-db.cjs   (leave running in its own terminal)
// Then:   npm run seed --workspace server
//
// NOTE: storage is in-memory — data is wiped when this process exits, so
// re-run the seed after each restart. For a persistent DB, install MongoDB
// Community as a service or point MONGODB_URI at Atlas (whitelist your IP).

const { MongoMemoryServer } = require("mongodb-memory-server");

const PORT = Number(process.env.DEV_DB_PORT || 27017);

(async () => {
  try {
    const mem = await MongoMemoryServer.create({
      instance: { port: PORT, dbName: "athletes" },
    });
    console.log(`[dev-db] in-memory MongoDB ready at ${mem.getUri()}`);
    console.log("[dev-db] leave this running. Seed with: npm run seed --workspace server");

    const shutdown = async () => {
      console.log("\n[dev-db] stopping…");
      await mem.stop();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    setInterval(() => {}, 1 << 30); // keep alive
  } catch (err) {
    console.error("[dev-db] failed to start:", err.message);
    if (String(err.message).includes("EADDRINUSE") || String(err.message).includes("already")) {
      console.error("[dev-db] port " + PORT + " is busy. Stop the other mongod, or run with DEV_DB_PORT=<free port> and set MONGODB_URI to match.");
    }
    process.exit(1);
  }
})();
