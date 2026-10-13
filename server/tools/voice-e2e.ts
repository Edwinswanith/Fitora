// End-to-end voice check against a RUNNING API with a real Gemini key and a
// real database. It talks to the API exactly like the mobile app does:
// interpret-v2 per sentence, the app's own buildVoiceAction / planFollowUp for
// saves, corrections and undos, then reads the athlete's data back.
//
// Usage (from server/, API already running on VOICE_E2E_BASE, default :4100):
//   npx ts-node --transpile-only tools/voice-e2e.ts
//   ONLY="Water,Check-in" npx ts-node --transpile-only tools/voice-e2e.ts
// It registers a throwaway athlete each run, so point it at a dev database,
// never production. Outside src/ on purpose: it imports mobile code.
import { buildVoiceAction } from "../../mobile/src/lib/voiceAssistant/actionMapping";
import { planFollowUp, recentActionPayload, type LastSaved } from "../../mobile/src/lib/voiceAssistant/lastSaved";
let lastSaved: LastSaved | null = null;

const BASE = process.env.VOICE_E2E_BASE ?? "http://localhost:4100";
let token = "";

async function call(method: string, path: string, body?: unknown) {
  const started = Date.now();
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as any;
  return { status: res.status, json, ms: Date.now() - started };
}

type Turn = { say: string };
type Scenario = { name: string; turns: string[]; check?: () => Promise<string> };

const today = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
})();

const latencies: number[] = [];
const log: string[] = [];
const out = (line: string) => {
  log.push(line);
  console.log(line);
};

async function runScenario(s: Scenario) {
  out(`\n=== ${s.name}`);
  let lastId = 0;
  for (const say of s.turns) {
    const r = await call("POST", "/api/athlete/voice/interpret-v2", { transcript: say, currentScreen: "today", recentAction: recentActionPayload(lastSaved, Date.now()) });
    latencies.push(r.ms);
    const j = r.json ?? {};
    out(`  you: "${say}"`);
    out(`   -> ${r.status} ${r.ms}ms intent=${j.intent} action=${j.action} entities=${JSON.stringify(j.entities)} missing=${JSON.stringify(j.missingFields)}${j.interpreterError ? " INTERPRETER_ERROR" : ""}`);
    out(`   app says: "${j.spokenResponse}"`);
    if ((j.action === "undo_last" || j.action === "amend_last") && lastSaved) {
      const plan = planFollowUp(lastSaved, j.action, j.entities);
      out(`   app plan: ${JSON.stringify(plan)}`);
      let resp: any = lastSaved.response;
      for (const step of plan.steps ?? []) {
        if (step.kind === "delete_water") resp = (await call("DELETE", `/api/athlete/water/${step.entryId}`)).json;
        else {
          const a = buildVoiceAction(step.intent, step.entities, { clientActionId: `e2e-fix-${Date.now()}` });
          if (a.kind === "http") resp = (await call(a.method, a.path, a.body)).json;
        }
      }
      if (plan.steps) lastSaved = j.action === "undo_last" ? null : { intent: j.intent, entities: j.entities, response: resp, at: Date.now() };
    }
    if (j.action === "execute") {
      const action = buildVoiceAction(j.intent, j.entities, { clientActionId: `e2e-${Date.now()}-${++lastId}` });
      if (action.kind !== "http") {
        out(`   save: ${action.kind}`);
        continue;
      }
      const w = await call(action.method, action.path, action.body);
      out(`   save: ${action.method} ${action.path} body=${JSON.stringify(action.body)} -> ${w.status}`);
      if (w.status < 300) lastSaved = { intent: j.intent, entities: j.entities, response: w.json, at: Date.now() };
      if (s.name.startsWith("Water: retry")) {
        const again = await call(action.method, action.path, action.body);
        out(`   same save sent again (network retry) -> ${again.status}`);
      }
    }
  }
  if (s.check) out(`   READ BACK: ${await s.check()}`);
}

async function waterTotal() {
  const r = await call("GET", `/api/athlete/water?date=${today}`);
  return `water today = ${r.json?.totalMl} ml in ${r.json?.entries?.length} entries`;
}

async function main() {
  const email = `voice-e2e-${Date.now()}@example.com`;
  const reg = await call("POST", "/api/auth/register-athlete", { name: "Priya Voice", email, password: "Passw0rd!long", sport: "football", timezone: "Asia/Kolkata" });
  token = reg.json?.accessToken ?? reg.json?.tokens?.accessToken ?? "";
  if (!token) throw new Error("register failed " + JSON.stringify(reg.json).slice(0, 300));
  out(`registered athlete ${email}`);

  const scenarios: Scenario[] = [
    { name: "Water: simple", turns: ["I just drank 500 ml of water"], check: waterTotal },
    { name: "Water: correction right after saving", turns: ["log 750 ml of water", "actually make it one litre"], check: waterTotal },
    { name: "Water: undo right after saving", turns: ["add 300 ml water", "no, cancel that"], check: waterTotal },
    { name: "Water: retry with the same id must not double", turns: ["add 250 ml water"], check: waterTotal },
    { name: "Water: glasses", turns: ["I had two glasses of water"], check: waterTotal },
    {
      name: "Check-in over several turns",
      turns: ["I want to do my morning check in", "sleep 8 out of 10, mood 7", "stress 3, soreness 4 and fatigue 2"],
      check: async () => {
        const r = await call("GET", `/api/athlete/daily?date=${today}`);
        const c = r.json?.card ?? {};
        return `wellness = ${JSON.stringify(c.wellness ?? { sleepQuality: c.sleepQuality, mood: c.mood, stress: c.stress, soreness: c.soreness, fatigue: c.fatigue })} readiness=${c.readinessScore ?? c.readiness}`;
      },
    },
    { name: "Check-in all in one sentence", turns: ["check in: sleep nine, mood eight, stress two, soreness three, fatigue three"] },
    { name: "Check-in: correct one score after saving", turns: ["actually my mood was 5"] },
    { name: "Vague feeling must not invent numbers", turns: ["I feel a bit tired today", "about a six"] },
    {
      name: "Meal",
      turns: ["I had two boiled eggs and a slice of toast for breakfast", "about 300 calories"],
      check: async () => {
        const r = await call("GET", `/api/athlete/nutrition/meals?date=${today}`);
        return `meals = ${JSON.stringify((r.json?.meals ?? []).map((m: any) => ({ type: m.mealType, foods: (m.foods ?? []).map((f: any) => `${f.name} ${f.calories}kcal`) })))}`;
      },
    },
    {
      name: "Water goal",
      turns: ["set my daily water goal to 3 litres"],
      check: async () => {
        const r = await call("GET", "/api/athlete/me");
        return `hydrationGoalMl = ${r.json?.athlete?.hydrationGoalMl}`;
      },
    },
    {
      name: "Session with effort",
      turns: ["log my morning session, strength training, effort 7, planned at 80 percent", "completed"],
      // spacing turns so the run stays under the per-minute write limit like a real person would
      check: async () => {
        const r = await call("GET", `/api/athlete/daily?date=${today}`);
        return `AM session = ${JSON.stringify(r.json?.card?.sessions?.AM ?? null).slice(0, 300)}`;
      },
    },
    { name: "Rest day then undo", turns: ["mark today as a rest day", "undo that"] },
    { name: "Question: hydration", turns: ["how much water have I had today"] },
    { name: "Question: explain", turns: ["what does readiness mean"] },
    { name: "Navigate", turns: ["open my progress"] },
    { name: "Off topic", turns: ["what's the weather in Chennai"] },
    { name: "Noise / half sentence", turns: ["uh um so"] },
    { name: "Hinglish", turns: ["maine abhi 500 ml paani piya"], check: waterTotal },
  ];


  const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
  for (const s of scenarios.filter((x) => !only || only.some((o) => x.name.startsWith(o)))) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      await runScenario(s);
    } catch (err) {
      out(`  ERROR ${(err as Error).message}`);
    }
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  out(`\nlatency over ${sorted.length} turns: p50 ${pct(50)}ms, p90 ${pct(90)}ms, max ${sorted[sorted.length - 1]}ms`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
