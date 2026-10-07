import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Text } from "./AppText";
import { AskAgentControl } from "./AskAgentControl";
import { AthleteAskAgentOverlayV2 } from "./voiceAssistant/AthleteAskAgentOverlayV2";
import { apiFetch, apiJson } from "../lib/api";
import { ROLE_THEMES, colors } from "../lib/theme";
import { SESSION_SLOTS } from "../lib/sessions";

type AgentRow = {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  status: string;
  detail: string;
  tone?: "ok" | "warn" | "bad" | "neutral";
  onPress?: () => void;
};

type AgentResult = {
  title: string;
  subtitle: string;
  summary: string;
  rows: AgentRow[];
};
type AgentChatEntry = {
  id: string;
  role: "user" | "agent";
  text: string;
};
type CoachAgentMemory = {
  date: string;
  lastAthleteId?: string;
  lastAthleteName?: string;
  lastReportKind?: string;
  lastReportDate?: string;
  lastSummary?: string;
  turns: { role: "user" | "agent"; text: string; at: string }[];
};
type PendingCoachAction =
  | { kind: "client_note"; athleteId: string; athleteName: string; body: string }
  | { kind: "announcement"; body: string };

type CoachCard = {
  athleteId: string;
  name: string;
  sport?: string | null;
  position?: string | null;
  attendance?: { status: string | null };
  sessions?: Record<string, { status: string | null; type: string | null }>;
  readinessScore: number | null;
  injury?: { active: boolean; bodyPart: string | null };
  rpe?: { calculatedTrainingLoad: number; riskFlag: "green" | "amber" | "red" } | null;
};

type CoachDashboardResponse = { date: string; count: number; cards: CoachCard[] };
type CoachNotesInbox = {
  openCount: number;
  notes: { noteId: string; athleteId: string; athleteName: string; date: string; body: string; needsReply: boolean }[];
};
type CoachDailyCard = CoachCard & {
  date: string;
  sleep?: { hours: number | null; quality: number | null };
  soreness?: number | null;
  heartRate?: { wakeHr: number | null; bedHr: number | null };
  recovery?: { status: string | null; score: number | null; restingHr: number | null; hrv: number | null };
  rpe?: CoachCard["rpe"] & {
    rpe?: number;
    fatigue?: number;
    muscleSoreness?: number;
    sleepQuality?: number;
    moodMotivation?: number;
  };
};
type CoachWellnessPoint = {
  date: string;
  sleepHours: number | null;
  sleepQuality: number | null;
  mood: number | null;
  stress: number | null;
  soreness: number | null;
  fatigue: number | null;
  wakeHr: number | null;
  bedHr: number | null;
};

const today = () => new Date().toISOString().slice(0, 10);
const COACH_AGENT_MEMORY_KEY = "scp.coach.askAgent.memory";

function dateFromKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function addDays(key: string, days: number) {
  const date = dateFromKey(key);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function reportDateFromCommand(command: string) {
  const lower = command.toLowerCase();
  if (/\byesterday\b/.test(lower)) return addDays(today(), -1);
  if (/\btomorrow\b/.test(lower)) return addDays(today(), 1);
  return today();
}

function toneColor(tone: AgentRow["tone"]) {
  if (tone === "ok") return colors.ok;
  if (tone === "warn") return colors.warn;
  if (tone === "bad") return colors.bad;
  return colors.inkMuted;
}

function normalizeCommand(command: string) {
  return command.toLowerCase().replace(/\bcouch\b/g, "coach").trim();
}

function attentionRank(card: CoachCard): number {
  if (card.rpe?.riskFlag === "red") return 0;
  if (card.injury?.active) return 0.5;
  if (card.readinessScore !== null && card.readinessScore < 60) return 1;
  if (card.rpe?.riskFlag === "amber") return 1.5;
  if (card.readinessScore !== null && card.readinessScore < 80) return 2;
  return 3;
}

function attentionReason(card: CoachCard): string {
  if (card.rpe?.riskFlag === "red") return "High RPM risk";
  if (card.injury?.active) return card.injury.bodyPart ? `Injury - ${card.injury.bodyPart}` : "Injury";
  if (card.readinessScore !== null && card.readinessScore < 60) return `Low readiness ${card.readinessScore}`;
  if (card.rpe?.riskFlag === "amber") return "RPM caution";
  if (card.readinessScore !== null && card.readinessScore < 80) return `Readiness ${card.readinessScore}`;
  return "Ready";
}

function displayMetric(value: number | null | undefined, suffix = "") {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  const rounded = Number(value.toFixed(2));
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(2)}${suffix}`;
}

function wellnessTen(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Number((value * 2).toFixed(2));
}

function requestedCoachMetric(command: string): "status" | "heartbeat" | "readiness" | "recovery" | "sleep" | "load" | "wellness" | "all" {
  const lower = command.toLowerCase();
  if (/\b(heart\s*beat|heartbeat|healthbeat|heathbeat|heart\s*rate|hr|pulse|bpm)\b/.test(lower)) return "heartbeat";
  if (/\breadiness\b/.test(lower)) return "readiness";
  if (/\brecovery\b/.test(lower)) return "recovery";
  if (/\bsleep\b/.test(lower)) return "sleep";
  if (/\b(load|rpm|rpe|training)\b/.test(lower)) return "load";
  if (/\b(fatigue|soreness|sore|mood|stress|wellness)\b/.test(lower)) return "wellness";
  if (/\b(all|full|complete|overall|everything|details?)\b/.test(lower)) return "all";
  return "status";
}

function extractAnnouncementBody(command: string): string | null {
  const cleaned = command.trim().replace(/\bcouch\b/gi, "coach");
  const target = String.raw`(?:all\s+)?(?:team|squad|athlete|athletes|player|players)`;
  const patterns = [
    new RegExp(String.raw`^(?:send|sent|post|create|make)?\s*(?:an?\s*)?(?:announce(?:ment)?|announcements|broadcast)(?:\s+message)?(?:\s+to\s+${target})?(?:\s+that|\s+saying|:|\s+of)?\s+(.+)$`, "i"),
    new RegExp(String.raw`^(?:send|sent|post|create|make)?\s*(?:a\s*)?message\s+(?:of|for|as)\s+(?:an?\s*)?(?:announce(?:ment)?|broadcast)(?:\s+to\s+${target})?(?:\s+that|\s+saying|:|\s+of)?\s+(.+)$`, "i"),
    new RegExp(String.raw`^(?:send|sent|post)\s+(.+?)\s+(?:as\s+|of\s+)?(?:an?\s*)?(?:announce(?:ment)?|broadcast)(?:\s+to\s+${target})?$`, "i"),
  ];
  for (const pattern of patterns) {
    const body = cleaned.match(pattern)?.[1]?.trim();
    if (body) return body.replace(/^(?:to\s+)?all\s+(?:athlete|athletes|players|team|squad)\s+(?:of|that|saying)\s+/i, "").trim();
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isCoachClientNoteIntent(command: string): boolean {
  const lower = command.toLowerCase();
  return /\b(add|save|write|record|create)\b/.test(lower) && /\b(client\s+)?(notes?|comments?|feedback)\b/.test(lower);
}

function cleanCoachClientNoteBody(command: string, athleteName?: string | null): string | null {
  let body = command
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^(?:please\s+)?(?:add|save|write|record|create)\s+(?:a\s+)?(?:client\s+)?(?:notes?|comments?|feedback)\s*/i, "")
    .replace(/^(?:for|to|about)\s+(?:client|athlete|player)?\s*/i, "")
    .trim();
  if (athleteName) {
    const names = [athleteName, athleteName.split(/\s+/)[0]].filter(Boolean);
    for (const name of names) {
      body = body.replace(new RegExp(`^${escapeRegExp(name)}\\b\\s*`, "i"), "").trim();
    }
  }
  body = body
    .replace(/^(?:that|saying|says|:|-)\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!body || /^(?:for|to|about|client|athlete|player|note|comment|feedback)$/i.test(body)) return null;
  return body.slice(0, 2000);
}

function AgentResultSheet({ result, onClose }: { result: AgentResult | null; onClose: () => void }) {
  if (!result) return null;
  return (
    <View style={styles.sheetOverlay} pointerEvents="box-none">
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.sheetHeader}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.sheetTitle}>{result.title}</Text>
            <Text style={styles.sheetSubtitle}>{result.subtitle}</Text>
          </View>
          <Pressable onPress={onClose} style={styles.closeButton} accessibilityRole="button" accessibilityLabel="Close result">
            <Ionicons name="close" size={18} color={colors.inkMuted} />
          </Pressable>
        </View>
        <View style={styles.summary}>
          <Ionicons name="sparkles-outline" size={15} color={colors.ok} />
          <Text style={styles.summaryText}>{result.summary}</Text>
        </View>
        {result.rows.length ? (
          <>
            <View style={styles.tableHead}>
              <Text style={styles.headText}>Item</Text>
              <Text style={styles.headStatus}>Status</Text>
            </View>
            <ScrollView style={styles.rowsScroll} contentContainerStyle={styles.rows} showsVerticalScrollIndicator>
              {result.rows.map((row) => {
                const color = toneColor(row.tone);
                return (
                  <Pressable
                    key={row.id}
                    onPress={row.onPress}
                    disabled={!row.onPress}
                    style={({ pressed }) => [styles.row, row.onPress ? styles.rowAction : null, pressed ? { opacity: 0.82 } : null]}
                    accessibilityRole={row.onPress ? "button" : undefined}
                    accessibilityLabel={row.onPress ? `Open ${row.label}` : undefined}
                  >
                    <View style={[styles.iconBox, { backgroundColor: `${color}16`, borderColor: `${color}44` }]}>
                      <Ionicons name={row.icon} size={16} color={color} />
                    </View>
                    <View style={styles.mainCell}>
                      <Text style={styles.rowLabel} numberOfLines={1}>{row.label}</Text>
                      <Text style={styles.rowDetail} numberOfLines={2}>{row.detail}</Text>
                    </View>
                    <View style={[styles.statusPill, { borderColor: `${color}44`, backgroundColor: `${color}12` }]}>
                      <Text style={[styles.statusText, { color }]} numberOfLines={1}>{row.status}</Text>
                    </View>
                    {row.onPress ? <Ionicons name="chevron-forward" size={15} color={colors.inkFaint} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </>
        ) : null}
      </View>
    </View>
  );
}

function AgentChatLog({ entries, onClose }: { entries: AgentChatEntry[]; onClose: () => void }) {
  if (!entries.length) return null;
  return (
    <View style={styles.chatWrap} pointerEvents="box-none">
      <View style={styles.chatCard}>
        <View style={styles.chatHeader}>
          <Text style={styles.chatTitle}>Ask Agent</Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close agent chat" style={styles.chatClose}>
            <Ionicons name="close" size={14} color={colors.inkMuted} />
          </Pressable>
        </View>
        <ScrollView style={styles.chatScroll} contentContainerStyle={styles.chatRows} showsVerticalScrollIndicator>
          {entries.map((entry) => (
            <View key={entry.id} style={[styles.chatBubble, entry.role === "user" ? styles.chatBubbleUser : styles.chatBubbleAgent]}>
              <Text style={[styles.chatText, entry.role === "user" ? styles.chatTextUser : null]}>{entry.text}</Text>
            </View>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

export function CoachAskAgentOverlay() {
  const router = useRouter();
  const accent = ROLE_THEMES.coach.accent;
  const [result, setResult] = useState<AgentResult | null>(null);
  const [inputOpen, setInputOpen] = useState(false);
  const [chatVisible, setChatVisible] = useState(true);
  const [chatLog, setChatLog] = useState<AgentChatEntry[]>([]);
  const [memory, setMemory] = useState<CoachAgentMemory>(() => ({ date: today(), turns: [] }));
  const chatSeqRef = useRef(0);
  const memoryRef = useRef<CoachAgentMemory>({ date: today(), turns: [] });
  const pendingCoachActionRef = useRef<PendingCoachAction | null>(null);

  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(COACH_AGENT_MEMORY_KEY)
      .then((raw) => {
        if (!raw || cancelled) return;
        const parsed = JSON.parse(raw) as CoachAgentMemory;
        if (parsed.date !== today()) {
          void AsyncStorage.removeItem(COACH_AGENT_MEMORY_KEY);
          return;
        }
        memoryRef.current = { ...parsed, turns: parsed.turns ?? [] };
        setMemory(memoryRef.current);
        setChatLog(
          (parsed.turns ?? []).slice(-20).map((turn, index) => ({
            id: `stored-${index}-${turn.at}`,
            role: turn.role,
            text: turn.text,
          }))
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  function updateMemory(patch: Partial<CoachAgentMemory>, turn?: { role: "user" | "agent"; text: string }) {
    const base = memoryRef.current.date === today() ? memoryRef.current : { date: today(), turns: [] };
    const nextTurns = turn ? [...(base.turns ?? []), { ...turn, at: new Date().toISOString() }].slice(-40) : base.turns ?? [];
    const next: CoachAgentMemory = { ...base, ...patch, date: today(), turns: nextTurns };
    memoryRef.current = next;
    setMemory(next);
    void AsyncStorage.setItem(COACH_AGENT_MEMORY_KEY, JSON.stringify(next)).catch(() => undefined);
  }

  function appendChat(role: "user" | "agent", text: string) {
    const clean = text.trim();
    if (!clean) return;
    chatSeqRef.current += 1;
    setChatVisible(true);
    setChatLog((prev) => [...prev.slice(-39), { id: `coach-agent-${chatSeqRef.current}`, role, text: clean }]);
    updateMemory({}, { role, text: clean });
  }

  async function loadDashboard(date = today()) {
    return apiJson<CoachDashboardResponse>(`/api/coach/dashboard?date=${date}`);
  }

  function openCoachAthlete(athleteId: string, name?: string | null) {
    const suffix = name ? `?name=${encodeURIComponent(name)}` : "";
    router.push(`/coach/athletes/${encodeURIComponent(athleteId)}${suffix}` as never);
  }

  function athleteRows(cards: CoachCard[], empty: string): AgentRow[] {
    if (!cards.length) {
      return [{ id: "empty", icon: "checkmark-done-outline", label: empty, status: "0", detail: "No matching athletes found.", tone: "ok" }];
    }
    return cards.map((card) => ({
      id: card.athleteId,
      icon: card.injury?.active ? "medkit-outline" : card.attendance?.status === "absent" ? "close-circle-outline" : "person-outline",
      label: card.name || "Athlete",
      status: card.readinessScore == null ? "-" : String(card.readinessScore),
      detail: [card.sport, card.position, card.attendance?.status, attentionReason(card)].filter(Boolean).join(" · "),
      tone: card.injury?.active || card.attendance?.status === "absent" ? "bad" : attentionRank(card) < 2 ? "warn" : "ok",
      onPress: () => openCoachAthlete(card.athleteId, card.name),
    }));
  }

  function resolveRequestedAthlete(command: string, cards: CoachCard[]): CoachCard | null {
    const lower = command.toLowerCase();
    const numbered = lower.match(/\bathlete\s*(?:number\s*)?(\d+)\b|\bplayer\s*(?:number\s*)?(\d+)\b/);
    const index = Number(numbered?.[1] ?? numbered?.[2]);
    if (Number.isFinite(index) && index > 0 && cards[index - 1]) return cards[index - 1];
    const lastNumbered = lower.match(/\blast\s+athlete\s*(\d+)\b/);
    const lastIndex = Number(lastNumbered?.[1]);
    if (Number.isFinite(lastIndex) && lastIndex > 0 && cards[lastIndex - 1]) return cards[lastIndex - 1];
    const byName = cards.find((card) => {
      const name = card.name.toLowerCase();
      if (name && lower.includes(name)) return true;
      return name.split(/\s+/).some((part) => part.length > 2 && lower.includes(part));
    });
    if (byName) return byName;
    const rememberedId = memory.lastAthleteId;
    const hasFollowUpMetric = /\b(what about|how about|and|also|their|his|her|same|status|report|heart\s*beat|heartbeat|healthbeat|heathbeat|heart\s*rate|readiness|recovery|sleep|load|rpm|rpe|wellness|fatigue|soreness|mood|stress)\b/.test(lower);
    if (rememberedId && hasFollowUpMetric) return cards.find((card) => card.athleteId === rememberedId) ?? null;
    return null;
  }

  function resolveCoachNoteAthlete(command: string, cards: CoachCard[]): CoachCard | null {
    const explicit = resolveRequestedAthlete(command, cards);
    if (explicit) return explicit;
    const lower = command.toLowerCase();
    if (memory.lastAthleteId && /\b(him|her|them|same|that athlete|last athlete)\b/.test(lower)) {
      return cards.find((card) => card.athleteId === memory.lastAthleteId) ?? null;
    }
    return null;
  }

  async function sendClientNote(action: Extract<PendingCoachAction, { kind: "client_note" }>): Promise<string> {
    pendingCoachActionRef.current = null;
    const res = await apiFetch(`/api/coach/athletes/${action.athleteId}/comment`, {
      method: "POST",
      body: JSON.stringify({ date: today(), body: action.body }),
    });
    if (!res.ok) throw new Error("client_note_failed");
    setResult({
      title: "Client Note Sent",
      subtitle: action.athleteName,
      summary: action.body,
      rows: [
        {
          id: "client-note",
          icon: "document-text-outline",
          label: action.athleteName,
          status: "Sent",
          detail: "Visible as coach feedback for the client.",
          tone: "ok",
          onPress: () => openCoachAthlete(action.athleteId, action.athleteName),
        },
      ],
    });
    updateMemory({
      lastAthleteId: action.athleteId,
      lastAthleteName: action.athleteName,
      lastReportKind: "client-note",
      lastReportDate: today(),
      lastSummary: action.body,
    });
    return `Note sent to ${action.athleteName}.`;
  }

  async function prepareClientNote(command: string): Promise<string | null> {
    if (!isCoachClientNoteIntent(command)) return null;
    const data = await loadDashboard(reportDateFromCommand(command));
    const cards = data.cards ?? [];
    const athlete = resolveCoachNoteAthlete(command, cards);
    if (!athlete) {
      const summary = "Which client should I attach the note to?";
      setResult({ title: "Client Note", subtitle: "Client required", summary, rows: athleteRows(cards.slice(0, 6), "No clients found") });
      return summary;
    }
    const body = cleanCoachClientNoteBody(command, athlete.name);
    if (!body) {
      const summary = `What note should I save for ${athlete.name}?`;
      setResult({ title: "Client Note", subtitle: athlete.name, summary, rows: [] });
      return summary;
    }
    pendingCoachActionRef.current = { kind: "client_note", athleteId: athlete.athleteId, athleteName: athlete.name, body };
    setResult({
      title: "Confirm Client Note",
      subtitle: athlete.name,
      summary: body,
      rows: [
        {
          id: "confirm-note",
          icon: "help-circle-outline",
          label: "Confirmation required",
          status: "Say yes",
          detail: "Say yes to send this as coach feedback, or no to cancel.",
          tone: "warn",
        },
      ],
    });
    updateMemory({ lastAthleteId: athlete.athleteId, lastAthleteName: athlete.name });
    return `Send this note to ${athlete.name}: ${body}? Say yes to confirm.`;
  }

  async function showIndividualAthleteReport(command: string): Promise<string | null> {
    const data = await loadDashboard(reportDateFromCommand(command));
    const cards = data.cards ?? [];
    const athlete = resolveRequestedAthlete(command, cards);
    if (!athlete) return null;

    const [{ card }, wellnessResult] = await Promise.all([
      apiJson<{ card: CoachDailyCard }>(`/api/coach/athletes/${athlete.athleteId}/daily-card?date=${data.date}`),
      apiJson<{ series: CoachWellnessPoint[] }>(`/api/coach/athletes/${athlete.athleteId}/analytics/wellness?days=30`).catch(() => ({ series: [] })),
    ]);
    const metric = requestedCoachMetric(command);
    const latestWellness = wellnessResult.series?.slice().reverse().find((point) => point.wakeHr != null || point.bedHr != null || point.sleepQuality != null);
    const rows: AgentRow[] = [];
    const push = (row: AgentRow) => rows.push({ ...row, onPress: () => openCoachAthlete(athlete.athleteId, athlete.name) });

    if (metric === "status" || metric === "all") {
      push({ id: "attendance", icon: "calendar-outline", label: "Attendance", status: card.attendance?.status ?? "--", detail: `Attendance status on ${data.date}.`, tone: card.attendance?.status === "absent" ? "bad" : "neutral" });
      push({ id: "sessions", icon: "checkmark-done-outline", label: "Sessions", status: String(SESSION_SLOTS.filter((slot) => card.sessions?.[slot]?.status === "completed").length), detail: SESSION_SLOTS.map((slot) => `${slot}: ${card.sessions?.[slot]?.status ?? "--"}`).join(" · "), tone: "neutral" });
    }
    if (metric === "readiness" || metric === "status" || metric === "all") {
      push({ id: "readiness", icon: "pulse-outline", label: "Readiness", status: displayMetric(card.readinessScore), detail: attentionReason(card), tone: card.readinessScore == null ? "neutral" : card.readinessScore >= 75 ? "ok" : card.readinessScore >= 60 ? "warn" : "bad" });
    }
    if (metric === "recovery" || metric === "status" || metric === "all") {
      push({ id: "recovery", icon: "fitness-outline", label: "Recovery", status: displayMetric(card.recovery?.score), detail: [card.recovery?.status, card.recovery?.restingHr != null ? `resting HR ${card.recovery.restingHr}` : null, card.recovery?.hrv != null ? `HRV ${card.recovery.hrv}` : null].filter(Boolean).join(" · ") || "No recovery data.", tone: "neutral" });
    }
    if (metric === "heartbeat" || metric === "all") {
      push({ id: "heart-rate", icon: "heart-outline", label: "Heart rate", status: card.heartRate?.wakeHr != null ? `${card.heartRate.wakeHr} bpm` : latestWellness?.wakeHr != null ? `${latestWellness.wakeHr} bpm` : "--", detail: `Wake ${displayMetric(card.heartRate?.wakeHr ?? latestWellness?.wakeHr, " bpm")} · bed ${displayMetric(card.heartRate?.bedHr ?? latestWellness?.bedHr, " bpm")}.`, tone: "neutral" });
    }
    if (metric === "sleep" || metric === "wellness" || metric === "all") {
      push({ id: "sleep", icon: "moon-outline", label: "Sleep", status: displayMetric(card.sleep?.hours, " h"), detail: `Quality ${displayMetric(wellnessTen(card.sleep?.quality ?? latestWellness?.sleepQuality), "/10")}.`, tone: "neutral" });
    }
    if (metric === "load" || metric === "all") {
      push({ id: "load", icon: "flame-outline", label: "Training load", status: displayMetric(card.rpe?.calculatedTrainingLoad), detail: card.rpe ? `RPM ${displayMetric(card.rpe.rpe)} · ${card.rpe.riskFlag} risk.` : "No RPM logged.", tone: card.rpe?.riskFlag === "red" ? "bad" : card.rpe?.riskFlag === "amber" ? "warn" : "ok" });
    }
    if (metric === "wellness" || metric === "all") {
      push({ id: "fatigue", icon: "battery-half-outline", label: "Fatigue", status: displayMetric(wellnessTen(card.rpe?.fatigue ?? latestWellness?.fatigue), "/10"), detail: "Lower fatigue is better.", tone: "neutral" });
      push({ id: "soreness", icon: "body-outline", label: "Soreness", status: displayMetric(wellnessTen(card.soreness ?? card.rpe?.muscleSoreness ?? latestWellness?.soreness), "/10"), detail: "Lower soreness is better.", tone: "neutral" });
      push({ id: "mood", icon: "happy-outline", label: "Mood", status: displayMetric(wellnessTen(card.rpe?.moodMotivation ?? latestWellness?.mood), "/10"), detail: "Higher mood is better.", tone: "neutral" });
      push({ id: "stress", icon: "warning-outline", label: "Stress", status: displayMetric(wellnessTen(latestWellness?.stress), "/10"), detail: "Lower stress is better.", tone: "neutral" });
    }

    const summary =
      metric === "heartbeat"
        ? `${athlete.name} heart rate: wake ${displayMetric(card.heartRate?.wakeHr ?? latestWellness?.wakeHr, " bpm")}, bed ${displayMetric(card.heartRate?.bedHr ?? latestWellness?.bedHr, " bpm")}.`
        : `${athlete.name} status on ${data.date}: readiness ${displayMetric(card.readinessScore)}, attendance ${card.attendance?.status ?? "--"}.`;
    setResult({
      title: `${athlete.name} ${metric === "heartbeat" ? "Heartbeat Report" : "Status Report"}`,
      subtitle: data.date,
      summary,
      rows,
    });
    updateMemory({
      lastAthleteId: athlete.athleteId,
      lastAthleteName: athlete.name,
      lastReportKind: metric,
      lastReportDate: data.date,
      lastSummary: summary,
    });
    return summary;
  }

  async function showCoachNotesReport(): Promise<string> {
    const inbox = await apiJson<CoachNotesInbox>("/api/coach/notes-inbox?days=14");
    const rows: AgentRow[] = inbox.notes.length
      ? inbox.notes.slice(0, 8).map((note) => ({
          id: note.noteId,
          icon: "document-text-outline",
          label: note.athleteName || "Athlete note",
          status: note.needsReply ? "Reply" : "Read",
          detail: note.body || `Note from ${note.date.slice(0, 10)}.`,
          tone: note.needsReply ? "warn" : "ok",
          onPress: () => openCoachAthlete(note.athleteId, note.athleteName),
        }))
      : [{ id: "empty", icon: "checkmark-done-outline", label: "Athlete notes", status: "0", detail: "No athlete notes in the last 14 days.", tone: "ok" }];
    const summary = `${inbox.openCount} athlete note${inbox.openCount === 1 ? "" : "s"} need reply.`;
    setResult({
      title: "Athlete Notes",
      subtitle: "Last 14 days",
      summary,
      rows,
    });
    updateMemory({ lastReportKind: "notes", lastReportDate: today(), lastSummary: summary });
    return summary;
  }

  async function showCoachReport(kind: "summary" | "best" | "roster" | "absent" | "nocheck" | "injury" | "attention", command = ""): Promise<string> {
    const data = await loadDashboard(reportDateFromCommand(command));
    const cards = data.cards ?? [];
    const present = cards.filter((card) => card.attendance?.status === "present").length;
    const completed = cards.filter((card) => SESSION_SLOTS.some((slot) => card.sessions?.[slot]?.status === "completed")).length;
    const avgCards = cards.filter((card) => card.readinessScore != null);
    const avg = avgCards.length ? Math.round(avgCards.reduce((sum, card) => sum + (card.readinessScore ?? 0), 0) / avgCards.length) : null;
    const best = [...cards].sort((a, b) => {
      const aSessions = SESSION_SLOTS.filter((slot) => a.sessions?.[slot]?.status === "completed").length;
      const bSessions = SESSION_SLOTS.filter((slot) => b.sessions?.[slot]?.status === "completed").length;
      return (b.readinessScore ?? 0) + bSessions * 8 - attentionRank(b) * 10 - ((a.readinessScore ?? 0) + aSessions * 8 - attentionRank(a) * 10);
    })[0];
    const attention = cards.filter((card) => attentionRank(card) < 2);
    const absent = cards.filter((card) => card.attendance?.status === "absent");
    const nocheck = cards.filter((card) => card.readinessScore === null);
    const injured = cards.filter((card) => card.injury?.active);
    const rows =
      kind === "best" && best ? athleteRows([best], "No athlete data")
      : kind === "roster" ? athleteRows(cards, "No athletes")
      : kind === "absent" ? athleteRows(absent, "No absent athletes")
      : kind === "nocheck" ? athleteRows(nocheck, "Everyone checked in")
      : kind === "injury" ? athleteRows(injured, "No injured athletes")
      : kind === "attention" ? athleteRows(attention, "No athletes need attention")
      : [
          { id: "athletes", icon: "people-outline" as const, label: "Athletes", status: String(cards.length), detail: `${present} present today.`, tone: "neutral" as const, onPress: () => router.push("/coach/athletes" as never) },
          { id: "sessions", icon: "checkmark-done-outline" as const, label: "Sessions done", status: String(completed), detail: `${completed} completed session entries.`, tone: completed ? "ok" as const : "warn" as const },
          { id: "readiness", icon: "pulse-outline" as const, label: "Avg readiness", status: avg == null ? "-" : String(avg), detail: "Current squad readiness average.", tone: avg == null ? "neutral" as const : avg >= 75 ? "ok" as const : avg >= 60 ? "warn" as const : "bad" as const },
        ];
    const summary =
      kind === "best" && best ? `${best.name} is top on ${data.date}.`
      : kind === "absent" ? `${absent.length} absent athlete${absent.length === 1 ? "" : "s"} on ${data.date}.`
      : kind === "nocheck" ? `${nocheck.length} athlete${nocheck.length === 1 ? "" : "s"} have not checked in on ${data.date}.`
      : `${cards.length} athletes · ${present} present · ${completed} sessions done · readiness ${avg ?? "-"}`;
    setResult({
      title: kind === "best" ? "Best Athlete" : kind === "roster" ? "Athlete List" : kind === "absent" ? "Absent Athletes" : kind === "nocheck" ? "Check-in Report" : kind === "injury" ? "Injury Report" : kind === "attention" ? "Attention Report" : "Squad Report",
      subtitle: data.date,
      summary,
      rows,
    });
    updateMemory({ lastReportKind: kind, lastReportDate: data.date, lastSummary: summary });
    return summary;
  }

  async function sendAnnouncement(body: string): Promise<string> {
    pendingCoachActionRef.current = null;
    const res = await apiFetch("/api/coach/announcements", { method: "POST", body: JSON.stringify({ body }) });
    if (!res.ok) throw new Error("announce_failed");
    setResult({
      title: "Announcement Sent",
      subtitle: today(),
      summary: body,
      rows: [{ id: "announcement", icon: "megaphone-outline", label: "Squad announcement", status: "Sent", detail: "Broadcast to assigned athletes.", tone: "ok", onPress: () => router.push("/coach/announcements" as never) }],
    });
    return "Announcement sent.";
  }

  /**
   * Broadcasts go to every assigned athlete and can't be unsent — unlike a
   * client note (one athlete, correctable in the athlete's own feed), a
   * misheard announcement reaches the whole squad. Route it through the
   * same say-yes-to-confirm gate as client notes instead of firing on a
   * regex match alone.
   */
  function prepareAnnouncement(body: string): string {
    pendingCoachActionRef.current = { kind: "announcement", body };
    setResult({
      title: "Confirm Announcement",
      subtitle: "All assigned athletes",
      summary: body,
      rows: [
        {
          id: "confirm-announcement",
          icon: "help-circle-outline",
          label: "Confirmation required",
          status: "Say yes",
          detail: "Say yes to broadcast this to your squad, or no to cancel.",
          tone: "warn",
        },
      ],
    });
    return `Broadcast this to your whole squad: ${body}? Say yes to confirm.`;
  }

  async function runCoachCommand(command: string): Promise<string> {
    const lower = normalizeCommand(command);
    try {
      const pending = pendingCoachActionRef.current;
      if (pending) {
        if (/^(yes|yeah|yep|confirm|send|send it|do it|save it)\b/.test(lower)) {
          setResult(null);
          return pending.kind === "announcement" ? sendAnnouncement(pending.body) : sendClientNote(pending);
        }
        if (/^(no|nope|cancel|stop|never mind|dont|don't)\b/.test(lower)) {
          pendingCoachActionRef.current = null;
          const summary = "Okay, cancelled.";
          setResult({
            title: pending.kind === "announcement" ? "Announcement Cancelled" : "Client Note Cancelled",
            subtitle: pending.kind === "announcement" ? "All assigned athletes" : pending.athleteName,
            summary,
            rows: [],
          });
          return summary;
        }
        return pending.kind === "announcement"
          ? "Please say yes to send the announcement, or no to cancel."
          : "Please say yes to send the client note, or no to cancel.";
      }

      setResult(null);
      const announcementBody = extractAnnouncementBody(command);
      if (announcementBody) {
        return prepareAnnouncement(announcementBody);
      }
      const clientNote = await prepareClientNote(command);
      if (clientNote) return clientNote;
      if (/\b(notification|notifications|bell|alerts?)\b/.test(lower)) {
        router.push("/notifications" as never);
        return "Opening notifications.";
      }
      if (/\b(calendar|calender|date picker|pick date)\b/.test(lower)) {
        router.push("/coach/dashboard" as never);
        return "There's no calendar view yet - showing your upcoming sessions instead.";
      }
      if (/\b(message|messages|chat|inbox|dm|direct)\b/.test(lower)) {
        router.push("/coach/messages" as never);
        return "Opening messages.";
      }
      if (/\b(announce|announcement|announcements|broadcast)\b/.test(lower)) {
        router.push("/coach/announcements" as never);
        return "Opening announcements.";
      }
      if (/^(open|go to)\s+(?:the\s+)?(?:roster|athletes|athlete list|players|squad list|team list)\b/.test(lower)) {
        router.push("/coach/athletes" as never);
        return "Opening roster.";
      }
      if (/\b(add|create|new|invite)\b.*\b(athlete|player|student)\b/.test(lower)) {
        router.push("/coach/athletes/new" as never);
        return "Opening add athlete.";
      }
      if (
        /\b(athlete\s*(?:number\s*)?\d+|player\s*(?:number\s*)?\d+|last\s+athlete\s*\d+|heart\s*beat|heartbeat|healthbeat|heathbeat|heart\s*rate|status|individual|separate|specific)\b/.test(lower) ||
        /\b(report|status|readiness|recovery|sleep|load|rpm|rpe|wellness|fatigue|soreness|mood|stress)\b/.test(lower)
      ) {
        const individual = await showIndividualAthleteReport(command);
        if (individual) return individual;
      }
      if (/\b(absent|absented|absence|not present|missing)\b/.test(lower)) return showCoachReport("absent", lower);
      if (/\b(no check|no check-in|not check|not check-in|nocheck|missing check|not checked|without check|check-int|checked in|check in)\b/.test(lower) && /\b(no|not|missing|without|who|which)\b/.test(lower)) return showCoachReport("nocheck", lower);
      if (/\b(note|notes|reply|replies|feedback)\b/.test(lower)) return showCoachNotesReport();
      if (/\b(report|reports|summary|readiness|attendance|present|load|sessions?)\b/.test(lower)) return showCoachReport("summary", lower);
      if (/\b(roster|athletes|athlete list|players|squad list|team list|listout|list out)\b/.test(lower)) return showCoachReport("roster", lower);
      if (/\b(injury|injuries|injured|hurt|pain)\b/.test(lower)) return showCoachReport("injury", lower);
      if (/\b(attention|risk|flag|low readiness|need attention)\b/.test(lower)) return showCoachReport("attention", lower);
      if (/\b(best|top|strongest|highest|leader)\b/.test(lower)) return showCoachReport("best", lower);
      const summary = "Try: who is best athlete, list athletes, who is absent, show injury report, or announce practice at 7 AM.";
      setResult({ title: "Ask Agent", subtitle: "Coach commands", summary, rows: [] });
      return summary;
    } catch {
      const summary = "I could not complete that command. Please try again.";
      setResult({ title: "Ask Agent", subtitle: "Coach commands", summary, rows: [] });
      return summary;
    }
  }

  async function handleCommand(command: string): Promise<string> {
    appendChat("user", command);
    const reply = await runCoachCommand(command);
    appendChat("agent", reply);
    return reply;
  }

  return (
    <>
      {chatVisible ? <AgentChatLog entries={chatLog} onClose={() => setChatVisible(false)} /> : null}
      <AskAgentControl
        accent={accent}
        accentInk="#fff"
        onCommand={handleCommand}
        onInputOpenChange={setInputOpen}
        tourTargetId="mobile-coach-agent"
      />
      {!inputOpen ? <AgentResultSheet result={result} onClose={() => setResult(null)} /> : null}
    </>
  );
}

export function AthleteAskAgentOverlay() {
  return <AthleteAskAgentOverlayV2 />;
}

const styles = StyleSheet.create({
  sheetOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 3000,
    elevation: 50,
    justifyContent: "flex-end",
  },
  sheet: {
    marginHorizontal: 16,
    marginBottom: 96,
    maxHeight: 310,
    borderRadius: 22,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 12,
    shadowColor: "#0f172a",
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  handle: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: colors.line, marginBottom: 8 },
  sheetHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  sheetTitle: { fontSize: 17, fontWeight: "900", color: colors.ink },
  sheetSubtitle: { marginTop: 1, fontSize: 12, fontWeight: "700", color: colors.inkMuted },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceInset,
  },
  summary: {
    marginTop: 10,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#9bcfbe",
    backgroundColor: "#eaf7f1",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  summaryText: { flex: 1, color: colors.ink, fontSize: 13, fontWeight: "800", lineHeight: 18 },
  tableHead: { marginTop: 10, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 4 },
  headText: { color: colors.inkMuted, fontSize: 12, fontWeight: "900", letterSpacing: 1.4, textTransform: "uppercase" },
  headStatus: { color: colors.inkMuted, fontSize: 12, fontWeight: "900", letterSpacing: 1.4, textTransform: "uppercase" },
  rowsScroll: { marginTop: 6 },
  rows: { gap: 7, paddingBottom: 4 },
  row: {
    minHeight: 58,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceInset,
    padding: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  rowAction: { backgroundColor: "#f8faf7" },
  iconBox: { width: 34, height: 34, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  mainCell: { flex: 1, minWidth: 0 },
  rowLabel: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  rowDetail: { marginTop: 2, color: colors.inkMuted, fontSize: 12, lineHeight: 16 },
  statusPill: {
    minWidth: 66,
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  statusText: { fontSize: 12, fontWeight: "900" },
  chatWrap: {
    position: "absolute",
    right: 16,
    left: 16,
    bottom: 148,
    zIndex: 2400,
    elevation: 45,
    alignItems: "flex-end",
  },
  chatCard: {
    width: "82%",
    maxHeight: 220,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
    padding: 10,
    shadowColor: "#0f172a",
    shadowOpacity: 0.14,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  chatHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  chatTitle: { color: colors.inkFaint, fontSize: 12, fontWeight: "900", letterSpacing: 1.1, textTransform: "uppercase" },
  chatClose: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceInset,
    borderWidth: 1,
    borderColor: colors.line,
  },
  chatScroll: { maxHeight: 170 },
  chatRows: { gap: 6, paddingBottom: 2 },
  chatBubble: { maxWidth: "92%", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 7 },
  chatBubbleUser: { alignSelf: "flex-end", backgroundColor: `${ROLE_THEMES.coach.accent}22` },
  chatBubbleAgent: { alignSelf: "flex-start", backgroundColor: colors.surfaceInset },
  chatText: { color: colors.inkMuted, fontSize: 12, lineHeight: 16 },
  chatTextUser: { color: colors.ink, fontWeight: "700" },
});
