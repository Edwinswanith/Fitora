const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { athleteUser, coachUser } = require("./fitora-visual-qa.spec.js");

const baseUrl = process.env.FITORA_EMULATOR_WEB_URL || "http://10.0.2.2:8082";
const cdpBase = process.env.FITORA_CDP_URL || "http://localhost:9222";
const adbPath =
  process.env.ADB_PATH ||
  path.join(process.env.LOCALAPPDATA || "", "Android", "Sdk", "platform-tools", "adb.exe");
const outDir = path.resolve("qa-artifacts", "fitora-emulator");

fs.mkdirSync(outDir, { recursive: true });

const routes = [
  { name: "athlete-today", role: "athlete", path: "/athlete/dashboard", text: "Today's Plan" },
  { name: "athlete-workouts", role: "athlete", path: "/athlete/dashboard?section=workouts", text: "Exercise Preview" },
  { name: "athlete-nutrition", role: "athlete", path: "/athlete/dashboard?section=nutrition", text: "Coach Meal Plan" },
  { name: "athlete-coach", role: "athlete", path: "/athlete/dashboard?section=coach", text: "My Coach" },
  { name: "athlete-progress", role: "athlete", path: "/athlete/dashboard?section=progress", text: "Goal Progress" },
  { name: "athlete-profile", role: "athlete", path: "/account", text: "Your Goal" },
  { name: "coach-home", role: "coach", path: "/coach/dashboard", text: "Needs Attention" },
  { name: "coach-clients", role: "coach", path: "/coach/athletes", text: "Search clients" },
  { name: "coach-plan", role: "coach", path: "/coach/plan", text: "Assignments" },
  { name: "coach-content", role: "coach", path: "/coach/content", text: "Video Library" },
  { name: "coach-profile", role: "coach", path: "/coach/profile", text: "Coaching Plans" },
  { name: "coach-account", role: "coach", path: "/account", text: "Coaching" },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function json(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${url}`);
  return res.json();
}

async function createTarget() {
  const url = `${cdpBase}/json/new?${encodeURIComponent(`${baseUrl}/`)}`;
  try {
    return await json(url, { method: "PUT" });
  } catch {
    const list = await json(`${cdpBase}/json/list`);
    const page = list.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
    if (!page) throw new Error("No debuggable Chrome page target found.");
    return page;
  }
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 0;
    this.pending = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result || {});
      }
    });
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 20000);
    });
  }

  close() {
    this.ws.close();
  }
}

async function waitForText(client, text, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await client.send("Runtime.evaluate", {
      expression: `document.body && document.body.innerText.includes(${JSON.stringify(text)})`,
      returnByValue: true,
    });
    if (result.result?.value) return true;
    await sleep(350);
  }
  return false;
}

async function setSession(client, role) {
  const user = role === "coach" ? coachUser : athleteUser;
  const expression = `
    localStorage.setItem("scp.accessToken", ${JSON.stringify(`mock-${role}-access`)});
    localStorage.setItem("scp.refreshToken", ${JSON.stringify(`mock-${role}-refresh`)});
    localStorage.setItem("scp.user", ${JSON.stringify(JSON.stringify(user))});
  `;
  await client.send("Runtime.evaluate", { expression, returnByValue: true });
}

function adbScreencap(name) {
  const remote = `/sdcard/fitora-${name}.png`;
  const file = path.join(outDir, `device-${name}.png`);
  execFileSync(adbPath, ["shell", "screencap", "-p", remote], { stdio: "ignore" });
  execFileSync(adbPath, ["pull", remote, file], { stdio: "ignore" });
  execFileSync(adbPath, ["shell", "rm", remote], { stdio: "ignore" });
  return file;
}

async function captureRoute(client, route) {
  await client.send("Page.navigate", { url: `${baseUrl}/` });
  await sleep(700);
  await setSession(client, route.role);
  await client.send("Page.navigate", { url: `${baseUrl}${route.path}` });
  const found = await waitForText(client, route.text);
  await sleep(1200);

  const screenshot = await client.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  const browserFile = path.join(outDir, `browser-${route.name}.png`);
  fs.writeFileSync(browserFile, Buffer.from(screenshot.data, "base64"));
  const deviceFile = adbScreencap(route.name);
  console.log(`${found ? "captured" : "captured without expected text"} ${route.name}`);
  return {
    ...route,
    url: `${baseUrl}${route.path}`,
    expectedTextFound: found,
    browserFile,
    deviceFile,
  };
}

async function main() {
  const target = await createTarget();
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  await client.send("Page.enable");
  await client.send("Runtime.enable");

  const results = [];
  try {
    for (const route of routes) {
      results.push(await captureRoute(client, route));
    }
  } finally {
    client.close();
  }

  const report = {
    baseUrl,
    cdpBase,
    routes: results,
  };
  const reportPath = path.join(outDir, "emulator-capture-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
