const http = require("http");

const { payloadFor } = require("./fitora-visual-qa.spec.js");

const port = Number(process.env.FITORA_MOCK_PORT || process.argv[2] || 4100);

function roleFor(req) {
  const auth = String(req.headers.authorization || "").toLowerCase();
  if (auth.includes("coach")) return "coach";
  if (auth.includes("athlete")) return "athlete";

  const pathname = new URL(req.url || "/", `http://localhost:${port}`).pathname;
  if (pathname.startsWith("/api/coach") || pathname === "/api/workout-templates") {
    return "coach";
  }
  return "athlete";
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type,X-Client-Type",
    "Content-Type": "application/json",
  });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (!req.url || !req.url.startsWith("/api/")) {
    sendJson(res, 404, { error: "not_found" });
    return;
  }

  const role = roleFor(req);
  const url = `http://localhost:${port}${req.url}`;
  sendJson(res, 200, payloadFor(url, role));
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Fitora emulator mock API listening on http://0.0.0.0:${port}`);
});

process.on("SIGINT", () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
