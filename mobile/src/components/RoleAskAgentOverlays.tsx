import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { usePathname, useRouter } from "expo-router";
import { Text } from "./AppText";
import { AskAgentControl } from "./AskAgentControl";
import { AthleteAskAgentOverlayV2 } from "./voiceAssistant/AthleteAskAgentOverlayV2";
import { apiFetch, apiJson } from "../lib/api";
import { ROLE_THEMES, colors } from "../lib/theme";
import { SESSION_SLOTS, SLOT_LABEL, type SessionSlot } from "../lib/sessions";
import { TRAINING_CATEGORIES } from "../lib/trainingCategories";
import { athleteNavigationReply, parseAthleteNavigationCommand, type AthleteNavigationCommand } from "../lib/athleteAskNavigation";

// Off by default — the current (V1) assistant keeps running unchanged for
// everyone until this is explicitly turned on for a build (plan §13).
const VOICE_ASSISTANT_V2 = process.env.EXPO_PUBLIC_VOICE_ASSISTANT_V2 === "true";

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
type VoiceIntentName =
  | "navigate"
  | "fill_wellness"
  | "fill_attendance"
  | "fill_training"
  | "fill_rpe"
  | "fill_heart_rate"
  | "fill_recovery"
  | "add_water"
  | "add_note"
  | "send_coach_message"
  | "query_status"
  | "unsupported";
type VoiceInterpretResult = {
  intent: VoiceIntentName;
  fields: Record<string, unknown>;
  missingFields: string[];
  followUpQuestion?: string;
  spokenResponse?: string;
};
type AskPendingGeminiIntent = {
  intent: VoiceIntentName;
  collected: Record<string, unknown>;
  missingFields: string[];
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

const LINK_COACH_BEFORE_MESSAGE = "First link with coach then you can enable to send message.";

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

function parseWaterAmountMl(command: string): number | null {
  const lower = command.toLowerCase();
  const litre = lower.match(/(\d+(?:\.\d+)?)\s*(?:l|litre|liter|litres|liters)\b/);
  if (litre) return Math.round(Number(litre[1]) * 1000);
  const ml = lower.match(/(\d+)\s*(?:ml|millilitre|milliliter|millilitres|milliliters)\b/);
  if (ml) return Number(ml[1]);
  const plain = lower.match(/\b(?:add|log|drink|drank)\s+(\d{2,4})\b/);
  return plain ? Number(plain[1]) : null;
}

function cleanCoachMessageBody(command: string): string | null {
  const body = command
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^(?:now\s+)?(?:i\s+)?(?:want|need|would\s+like)\s+to\s+(?:send|tell|message|note|text)\s+(?:the\s+|a\s+|this\s+)?(?:message|note|text)?\s*(?:to\s+)?(?:my\s+)?(?:coach|couch|house)\s*/i, "")
    .replace(/^(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:send|tell|message|note|text)\s+(?:the\s+|a\s+|this\s+)?(?:message|note|text)?\s*(?:to\s+)?(?:my\s+)?(?:coach|couch|house)\s*/i, "")
    .replace(/^(?:please\s+)?(?:send|tell|message|note|text)\s+(?:the\s+|a\s+|this\s+)?(?:message|note|text)?\s*(?:to\s+)?(?:my\s+)?(?:coach|couch|house)\s*/i, "")
    .replace(/^(?:stating|setting|saying)\s+that\s+/i, "")
    .replace(/^(?:stating|setting|saying|that)\s+/i, "")
    .replace(/^(?:for|as|:|-)\s*/i, "")
    .replace(/^available\b/i, "I won't be available")
    .replace(/\band unable to\b/i, "and I am unable to attend")
    .replace(/\bunable to today class\b/i, "I am unable to attend today's class")
    .replace(/\battend today class\b/i, "attend today's class")
    .replace(/\bi will tomorrow\b/i, "I will join tomorrow")
    .trim();
  if (!body) return null;
  if (/^(?:can|could|would|will|please|you|send|sent|sending|tell|message|note|text|to|my|coach|couch|house|that|stating|setting|saying)\b[\s\w]*$/i.test(body)) {
    return null;
  }
  return body;
}

function extractCoachMessage(command: string): string | null {
  const cleaned = command.trim().replace(/\bcouch\b/gi, "coach").replace(/\bhouse\b/gi, "coach");
  const lower = command.toLowerCase();
  if (!/\b(coach|couch|house)\b/.test(lower) || !/\b(send|sending|sent|tell|message|note|text)\b/.test(lower)) return null;
  const want = cleaned.match(/^(?:now\s+)?(?:i\s+)?(?:want|need|would\s+like)\s+to\s+(?:send|tell|message|note|text)\s+(?:the\s+|a\s+|this\s+)?(?:message|note|text)?\s*(?:to\s+)?(?:my\s+)?coach\s*(?:stating|setting|saying|that|:|-)?\s*(.*)$/i);
  if (want) return cleanCoachMessageBody(want[1] ?? "");
  const polite = cleaned.match(/^(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:send|tell|message|note|text)\s+(?:the\s+|a\s+|this\s+)?(?:message|note|text)?\s*(?:to\s+)?(?:my\s+)?coach\s*(?:stating|setting|saying|that|:|-)?\s*(.*)$/i);
  if (polite) return cleanCoachMessageBody(polite[1] ?? "");
  const direct = cleaned.match(/^(?:please\s+)?(?:send|tell|message|note|text)\s+(?:the\s+|a\s+|this\s+)?(?:message|note|text)?\s*(?:to\s+)?(?:my\s+)?coach\s*(?:stating|setting|saying|that|:|-)?\s*(.*)$/i);
  if (direct) return cleanCoachMessageBody(direct[1] ?? "");
  const suffix = cleaned.match(/^(.+?)\s+(?:send\s+)?(?:this\s+)?(?:message|note|text)\s+to\s+(?:my\s+)?coach$/i);
  if (suffix?.[1]?.trim()) return cleanCoachMessageBody(suffix[1]);
  const match = cleaned.match(/^(?:send|sent|message|text)\s+(.+?)\s+to\s+(?:my\s+)?coach$/i);
  if (match?.[1]?.trim()) return cleanCoachMessageBody(match[1]);
  const reverse = cleaned.match(/^(?:send|sent|message|text)\s+(?:my\s+)?coach\s+(.+)$/i);
  if (reverse?.[1]?.trim()) return cleanCoachMessageBody(reverse[1]);
  return null;
}

function isCoachMessageIntent(command: string): boolean {
  const lower = command.toLowerCase();
  return /\bcoach\b|\bcouch\b|\bhouse\b/.test(lower) && /\b(send|sending|sent|tell|message|note|text)\b/.test(lower);
}

function extractNoteBody(command: string): string | null {
  const match = command.match(/^(?:add|create|save|write)\s+(?:a\s+)?(?:session\s+)?note(?:\s+for)?\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

const ATHLETE_ASK_HELP = "Try: update sleep score, mark attendance present, log RPE, add water, save recovery, or send a coach message.";
const AGENT_API_ERROR_MESSAGES: Record<string, string> = {
  invalid_sleepHours: "Sleep hours must be between 0 and 14.",
  invalid_sleepQuality: "Sleep quality is out of range.",
  invalid_mood: "Mood is out of range.",
  invalid_stress: "Stress is out of range.",
  invalid_soreness: "Soreness is out of range.",
  invalid_fatigue: "Fatigue is out of range.",
  invalid_amountMl: "Water amount must be between 1 and 4000 ml.",
  invalid_wakeHr: "Wake heart rate must be between 25 and 220 bpm.",
  invalid_bedHr: "Bed heart rate must be between 25 and 220 bpm.",
  no_values: "No heart rate values to save.",
  invalid_status: "That status is not recognized.",
  invalid_attended: "That value is not recognized.",
  invalid_workoutType: "Workout type is too long.",
  invalid_reps: "Reps value is too long.",
  invalid_sets: "Sets must be between 0 and 200.",
  invalid_actualDurationMin: "Duration must be between 0 and 600 minutes.",
  invalid_effortRating: "Effort or RPE must be between 1 and 10.",
  no_updates: "Nothing to update.",
  invalid_slot: "That session slot is not recognized.",
  invalid_sessionType: "That session slot is not recognized.",
  invalid_trainingCategory: "That training category is not recognized.",
  invalid_plannedIntensityPercent: "Planned intensity must be between 0 and 100 percent.",
  invalid_rpe: "RPE must be between 0 and 10.",
  invalid_muscleSoreness: "Soreness is out of range.",
  invalid_moodMotivation: "Mood is out of range.",
  invalid_restingHeartRate: "Resting heart rate must be between 20 and 220 bpm.",
  body_required: "Note cannot be empty.",
  athlete_profile_not_found: "Your athlete profile could not be found.",
  coach_not_assigned: LINK_COACH_BEFORE_MESSAGE,
};

function fieldNumber(fields: Record<string, unknown>, key: string): number | undefined {
  const value = fields[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function fieldString(fields: Record<string, unknown>, key: string): string | undefined {
  const value = fields[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function slotFromFields(fields: Record<string, unknown>): SessionSlot {
  return SESSION_SLOTS.includes(fields.slot as SessionSlot) ? (fields.slot as SessionSlot) : "AM";
}

function wellnessTenToFive(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 1 || raw > 10) return undefined;
  return 1 + ((raw - 1) * 4) / 9;
}

function normalizeTrainingCategory(value: string | undefined): string {
  if (value && (TRAINING_CATEGORIES as readonly string[]).includes(value)) return value;
  const lower = (value ?? "").toLowerCase();
  if (lower.includes("strength") || lower.includes("general")) return "GENERAL STRENGTH & MOBILITY";
  if (lower.includes("conditioning") || lower.includes("endurance")) return "ENDURANCE";
  if (lower.includes("skill") || lower.includes("technique")) return "TECHNIQUE / COORDINATION DRILLS";
  if (lower.includes("mobility")) return "GENERAL STRENGTH & MOBILITY";
  if (lower.includes("rest")) return "ACTIVE REST / REST";
  return TRAINING_CATEGORIES[0];
}

function sessionRpeUpdateMessage(slot: SessionSlot, fields: Record<string, unknown>): string {
  const parts: string[] = [];
  const rpeValue = fieldNumber(fields, "effortRating") ?? fieldNumber(fields, "rpe");
  if (rpeValue !== undefined) parts.push(`RPE ${rpeValue}`);
  const plannedIntensity = fieldNumber(fields, "plannedIntensityPercent");
  if (plannedIntensity !== undefined) parts.push(`planned intensity ${plannedIntensity}%`);
  const soreness = fieldNumber(fields, "soreness");
  if (soreness !== undefined) parts.push(`soreness ${soreness}`);
  const fatigue = fieldNumber(fields, "fatigue");
  if (fatigue !== undefined) parts.push(`fatigue ${fatigue}`);
  const sleepQuality = fieldNumber(fields, "sleepQuality");
  if (sleepQuality !== undefined) parts.push(`sleep quality ${sleepQuality}`);
  const mood = fieldNumber(fields, "mood");
  if (mood !== undefined) parts.push(`mood ${mood}`);
  const restingHeartRate = fieldNumber(fields, "restingHeartRate");
  if (restingHeartRate !== undefined) parts.push(`resting heart rate ${restingHeartRate} bpm`);
  if (fieldString(fields, "bodyConditionFeedback")) parts.push("body condition");
  if (!parts.length) return `Saved to your ${SLOT_LABEL[slot]} session.`;
  return `Saved to your ${SLOT_LABEL[slot]} session: ${parts.join(", ")}.`;
}

async function readAgentApiError(res: Response): Promise<string> {
  const raw = await res.text().catch(() => "");
  if (!raw) return `Request failed (${res.status}).`;
  try {
    const parsed = JSON.parse(raw) as { error?: string; message?: string };
    const code = parsed.error ?? parsed.message ?? raw;
    return AGENT_API_ERROR_MESSAGES[code] ?? code;
  } catch {
    return raw;
  }
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
      onPress: () => router.push({ pathname: "/coach/athletes/[athleteId]", params: { athleteId: card.athleteId, name: card.name } } as never),
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
    const push = (row: AgentRow) => rows.push({ ...row, onPress: () => router.push({ pathname: "/coach/athletes/[athleteId]", params: { athleteId: athlete.athleteId, name: athlete.name } } as never) });

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
          onPress: () => router.push({ pathname: "/coach/athletes/[athleteId]", params: { athleteId: note.athleteId, name: note.athleteName } } as never),
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

  async function runCoachCommand(command: string): Promise<string> {
    const lower = normalizeCommand(command);
    setResult(null);
    try {
      const announcementBody = extractAnnouncementBody(command);
      if (announcementBody) {
        return sendAnnouncement(announcementBody);
      }
      if (/\b(notification|notifications|bell|alerts?)\b/.test(lower)) {
        router.push("/notifications" as never);
        return "Opening notifications.";
      }
      if (/\b(calendar|calender|date picker|pick date)\b/.test(lower)) {
        router.push({ pathname: "/coach/dashboard", params: { ask: "calendar", t: String(Date.now()) } } as never);
        return "Opening calendar.";
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
  if (VOICE_ASSISTANT_V2) return <AthleteAskAgentOverlayV2 />;
  return <AthleteAskAgentOverlayV1 />;
}

function AthleteAskAgentOverlayV1() {
  const router = useRouter();
  const pathname = usePathname();
  const accent = ROLE_THEMES.athlete.accent;
  const accentInk = ROLE_THEMES.athlete.accentInk;
  const [result, setResult] = useState<AgentResult | null>(null);
  const [inputOpen, setInputOpen] = useState(false);
  const pendingCoachMessageRef = useRef(false);
  const pendingGeminiRef = useRef<AskPendingGeminiIntent | null>(null);
  const hidden = useMemo(() => pathname === "/athlete/dashboard", [pathname]);

  function openDashboard(section: string, slot?: "AM" | "AFT" | "PM") {
    router.push({ pathname: "/athlete/dashboard", params: { section, ...(slot ? { slot } : {}) } } as never);
  }

  function applyNavigation(command: AthleteNavigationCommand) {
    if (command.kind === "notifications") {
      router.push("/notifications" as never);
      return;
    }
    if (command.kind === "calendar") {
      openDashboard("today");
      return;
    }
    openDashboard(command.section, command.slot);
  }

  async function sendCoachMessage(body: string): Promise<string> {
    const messageBody = cleanCoachMessageBody(body);
    if (!messageBody) {
      setResult({ title: "Ask Agent", subtitle: "Coach message", summary: "What message would you like to send?", rows: [] });
      return "What message would you like to send?";
    }
    const coachRes = await apiJson<{ coaches: { coachId: string; name?: string }[] }>("/api/athlete/coaches");
    const coach = coachRes.coaches?.[0];
    if (!coach) {
      openDashboard("messages");
      return LINK_COACH_BEFORE_MESSAGE;
    }
    const res = await apiFetch(`/api/athlete/messages/${coach.coachId}`, { method: "POST", body: JSON.stringify({ body: messageBody }) });
    if (!res.ok) throw new Error("message_failed");
    setResult({
      title: "Message Sent",
      subtitle: coach.name || "Coach",
      summary: messageBody,
      rows: [{ id: "message", icon: "chatbubble-ellipses-outline", label: "Coach message", status: "Sent", detail: "Direct message sent to coach.", tone: "ok", onPress: () => openDashboard("chat") }],
    });
    return "Message sent to coach.";
  }

  async function postAgentJson(path: string, body: unknown): Promise<void> {
    const res = await apiFetch(path, { method: "POST", body: JSON.stringify(body) });
    if (!res.ok) throw new Error(await readAgentApiError(res));
  }

  function showSavedResult(title: string, summary: string, row: AgentRow) {
    setResult({ title, subtitle: today(), summary, rows: [row] });
  }

  async function interpretAthleteCommand(command: string): Promise<VoiceInterpretResult> {
    const pending = pendingGeminiRef.current;
    const response = await apiFetch("/api/athlete/voice/interpret", {
      method: "POST",
      body: JSON.stringify({
        transcript: command,
        pendingIntent: pending ?? undefined,
      }),
    });
    if (!response.ok) throw new Error(await readAgentApiError(response));
    return (await response.json()) as VoiceInterpretResult;
  }

  function askForMissing(result: VoiceInterpretResult): string {
    pendingGeminiRef.current = {
      intent: result.intent,
      collected: result.fields ?? {},
      missingFields: result.missingFields ?? [],
    };
    const summary = result.followUpQuestion ?? "I need one more detail.";
    setResult({ title: "Ask Agent", subtitle: "More detail needed", summary, rows: [] });
    return summary;
  }

  async function runInterpretedAthleteCommand(command: string): Promise<string> {
    const interpreted = await interpretAthleteCommand(command);
    const fields = interpreted.fields ?? {};
    if (interpreted.intent === "unsupported") {
      pendingGeminiRef.current = null;
      setResult({ title: "Ask Agent", subtitle: "Athlete commands", summary: ATHLETE_ASK_HELP, rows: [] });
      return interpreted.spokenResponse ?? ATHLETE_ASK_HELP;
    }
    if (interpreted.missingFields?.length) return askForMissing(interpreted);

    if (interpreted.intent === "navigate") {
      pendingGeminiRef.current = null;
      const navigation = parseAthleteNavigationCommand(String(fieldString(fields, "section") ?? command)) ?? parseAthleteNavigationCommand(command);
      if (navigation) {
        applyNavigation(navigation);
        return athleteNavigationReply(navigation);
      }
      openDashboard("today");
      return interpreted.spokenResponse ?? "Opening dashboard.";
    }

    if (interpreted.intent === "add_water") {
      const amountMl = Math.round(fieldNumber(fields, "amountMl") ?? 0);
      if (!amountMl) return askForMissing({ ...interpreted, missingFields: ["amountMl"], followUpQuestion: "How much water should I log in millilitres?" });
      pendingGeminiRef.current = null;
      await postAgentJson("/api/athlete/water", { date: today(), amountMl });
      showSavedResult("Water Logged", `Logged ${amountMl} ml of water.`, {
        id: "water",
        icon: "water-outline",
        label: "Hydration",
        status: `${amountMl} ml`,
        detail: "Added to today's water total.",
        tone: "ok",
        onPress: () => openDashboard("water"),
      });
      return `Logged ${amountMl} ml of water.`;
    }

    if (interpreted.intent === "fill_wellness") {
      const payload: Record<string, unknown> = { date: today() };
      const sleepHours = fieldNumber(fields, "sleepHours");
      const sleepQuality = wellnessTenToFive(fields.sleepQuality);
      const mood = wellnessTenToFive(fields.mood);
      const stress = wellnessTenToFive(fields.stress);
      const soreness = wellnessTenToFive(fields.soreness);
      const fatigue = wellnessTenToFive(fields.fatigue);
      if (sleepHours !== undefined) payload.sleepHours = sleepHours;
      if (sleepQuality !== undefined) payload.sleepQuality = sleepQuality;
      if (mood !== undefined) payload.mood = mood;
      if (stress !== undefined) payload.stress = stress;
      if (soreness !== undefined) payload.soreness = soreness;
      if (fatigue !== undefined) payload.fatigue = fatigue;
      if (Object.keys(payload).length === 1) return askForMissing({ ...interpreted, missingFields: ["wellness"], followUpQuestion: "What wellness value should I update?" });
      pendingGeminiRef.current = null;
      await postAgentJson("/api/athlete/wellness", payload);
      const visible = [
        sleepHours !== undefined ? `sleep ${sleepHours}h` : null,
        fieldNumber(fields, "sleepQuality") !== undefined ? `sleep score ${fieldNumber(fields, "sleepQuality")}` : null,
        fieldNumber(fields, "mood") !== undefined ? `mood ${fieldNumber(fields, "mood")}` : null,
        fieldNumber(fields, "stress") !== undefined ? `stress ${fieldNumber(fields, "stress")}` : null,
        fieldNumber(fields, "soreness") !== undefined ? `soreness ${fieldNumber(fields, "soreness")}` : null,
        fieldNumber(fields, "fatigue") !== undefined ? `fatigue ${fieldNumber(fields, "fatigue")}` : null,
      ].filter(Boolean).join(", ");
      showSavedResult("Check-in Saved", visible || "Today's check-in was updated.", {
        id: "wellness",
        icon: "pulse-outline",
        label: "Daily wellness",
        status: "Saved",
        detail: "Updated today's check-in.",
        tone: "ok",
        onPress: () => openDashboard("today"),
      });
      return "Check-in saved.";
    }

    if (interpreted.intent === "fill_attendance") {
      const status = fieldString(fields, "status") ?? "";
      if (!["present", "absent", "late", "excused", "rest"].includes(status)) throw new Error("That attendance status is not recognized.");
      pendingGeminiRef.current = null;
      await postAgentJson("/api/athlete/attendance", { date: today(), status });
      showSavedResult("Attendance Saved", `Attendance marked ${status}.`, {
        id: "attendance",
        icon: "calendar-outline",
        label: "Attendance",
        status,
        detail: "Updated today's attendance.",
        tone: "ok",
        onPress: () => openDashboard("log"),
      });
      return `Attendance marked ${status}.`;
    }

    if (interpreted.intent === "fill_training") {
      const slot = slotFromFields(fields);
      const payload: Record<string, unknown> = { date: today() };
      const status = fieldString(fields, "status");
      const workoutType = fieldString(fields, "workoutType");
      const reps = fieldString(fields, "reps");
      const notes = fieldString(fields, "notes");
      const sets = fieldNumber(fields, "sets");
      const actualDurationMin = fieldNumber(fields, "actualDurationMin");
      const effortRating = fieldNumber(fields, "effortRating") ?? fieldNumber(fields, "rpe");
      if (status) payload.status = status;
      if (typeof fields.attended === "boolean") payload.attended = fields.attended;
      if (workoutType) payload.workoutType = workoutType;
      if (sets !== undefined) payload.sets = sets;
      if (reps) payload.reps = reps;
      if (actualDurationMin !== undefined) payload.actualDurationMin = actualDurationMin;
      if (effortRating !== undefined) payload.effortRating = effortRating;
      if (notes) payload.notes = notes;
      if (Object.keys(payload).length === 1) return askForMissing({ ...interpreted, missingFields: ["training"], followUpQuestion: "What should I update for this training session?" });
      pendingGeminiRef.current = null;
      await postAgentJson(`/api/athlete/training/${slot}`, payload);
      showSavedResult(`${SLOT_LABEL[slot]} Session Saved`, `${SLOT_LABEL[slot]} session saved.`, {
        id: "training",
        icon: "barbell-outline",
        label: `${SLOT_LABEL[slot]} training`,
        status: "Saved",
        detail: "Updated today's session log.",
        tone: "ok",
        onPress: () => openDashboard("log", slot),
      });
      return `${SLOT_LABEL[slot]} session saved.`;
    }

    if (interpreted.intent === "fill_rpe") {
      const slot = slotFromFields(fields);
      const existing = await apiJson<{ entries: Record<string, unknown>[] }>(`/api/athlete/rpe-monitoring?date=${today()}`)
        .then((data) => data.entries.find((entry) => entry.sessionType === slot))
        .catch(() => undefined);
      const rpeValue = fieldNumber(fields, "effortRating") ?? fieldNumber(fields, "rpe") ?? fieldNumber(existing ?? {}, "rpe");
      if (rpeValue === undefined) return askForMissing({ ...interpreted, missingFields: ["rpe"], followUpQuestion: "What was your session RPE from 1 to 10?" });
      const neutralWellness = wellnessTenToFive(5) ?? 3;
      const payload = {
        date: today(),
        sessionType: slot,
        trainingCategory: normalizeTrainingCategory(fieldString(fields, "trainingCategory") ?? fieldString(existing ?? {}, "trainingCategory")),
        plannedIntensityPercent: fieldNumber(fields, "plannedIntensityPercent") ?? fieldNumber(existing ?? {}, "plannedIntensityPercent") ?? 0,
        rpe: rpeValue,
        sleepQuality: wellnessTenToFive(fields.sleepQuality) ?? fieldNumber(existing ?? {}, "sleepQuality") ?? neutralWellness,
        muscleSoreness: wellnessTenToFive(fields.soreness) ?? fieldNumber(existing ?? {}, "muscleSoreness") ?? neutralWellness,
        fatigue: wellnessTenToFive(fields.fatigue) ?? fieldNumber(existing ?? {}, "fatigue") ?? neutralWellness,
        moodMotivation: wellnessTenToFive(fields.mood) ?? fieldNumber(existing ?? {}, "moodMotivation") ?? neutralWellness,
        ...(fieldNumber(fields, "restingHeartRate") !== undefined ? { restingHeartRate: fieldNumber(fields, "restingHeartRate") } : {}),
        ...(fieldString(fields, "bodyConditionFeedback") ? { bodyConditionFeedback: fieldString(fields, "bodyConditionFeedback") } : {}),
      };
      pendingGeminiRef.current = null;
      await postAgentJson("/api/athlete/rpe-monitoring", payload);
      const summary = sessionRpeUpdateMessage(slot, { ...fields, rpe: rpeValue });
      showSavedResult("Session RPE Saved", summary, {
        id: "rpe",
        icon: "flame-outline",
        label: `${SLOT_LABEL[slot]} RPM`,
        status: String(rpeValue),
        detail: "Updated today's session load.",
        tone: "ok",
        onPress: () => openDashboard("log", slot),
      });
      return summary;
    }

    if (interpreted.intent === "fill_heart_rate") {
      const payload: Record<string, unknown> = { date: today() };
      const wakeHr = fieldNumber(fields, "wakeHr");
      const bedHr = fieldNumber(fields, "bedHr");
      if (wakeHr !== undefined) payload.wakeHr = wakeHr;
      if (bedHr !== undefined) payload.bedHr = bedHr;
      if (Object.keys(payload).length === 1) return askForMissing({ ...interpreted, missingFields: ["heartRate"], followUpQuestion: "What heart rate should I save?" });
      pendingGeminiRef.current = null;
      await postAgentJson("/api/athlete/heart-rate", payload);
      showSavedResult("Heart Rate Saved", "Heart rate saved.", {
        id: "heart-rate",
        icon: "heart-outline",
        label: "Heart rate",
        status: wakeHr !== undefined ? `${wakeHr} bpm` : `${bedHr} bpm`,
        detail: "Updated today's heart-rate entry.",
        tone: "ok",
        onPress: () => openDashboard("today"),
      });
      return "Heart rate saved.";
    }

    if (interpreted.intent === "fill_recovery") {
      const modalities = Array.isArray(fields.modalities) ? fields.modalities.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
      pendingGeminiRef.current = null;
      await postAgentJson("/api/athlete/recovery", { date: today(), modalities });
      showSavedResult("Recovery Saved", "Recovery saved.", {
        id: "recovery",
        icon: "fitness-outline",
        label: "Recovery",
        status: "Saved",
        detail: modalities.length ? modalities.join(", ") : "Updated today's recovery.",
        tone: "ok",
        onPress: () => openDashboard("log"),
      });
      return "Recovery saved.";
    }

    if (interpreted.intent === "add_note") {
      const body = fieldString(fields, "body") ?? extractNoteBody(command) ?? command.trim();
      pendingGeminiRef.current = null;
      await postAgentJson("/api/athlete/notes", { date: today(), body });
      showSavedResult("Note Saved", body, {
        id: "note",
        icon: "document-text-outline",
        label: "Session note",
        status: "Saved",
        detail: "Added to today's athlete notes.",
        tone: "ok",
        onPress: () => openDashboard("log"),
      });
      return "Note saved.";
    }

    if (interpreted.intent === "send_coach_message") {
      const body = extractCoachMessage(command) ?? cleanCoachMessageBody(fieldString(fields, "body") ?? "");
      pendingGeminiRef.current = null;
      if (!body) {
        pendingCoachMessageRef.current = true;
        setResult({ title: "Ask Agent", subtitle: "Coach message", summary: "What message would you like to send?", rows: [] });
        return "What message would you like to send?";
      }
      pendingCoachMessageRef.current = false;
      return sendCoachMessage(body);
    }

    if (interpreted.intent === "query_status") {
      pendingGeminiRef.current = null;
      openDashboard("today");
      return interpreted.spokenResponse ?? "Opening today's dashboard.";
    }

    pendingGeminiRef.current = null;
    setResult({ title: "Ask Agent", subtitle: "Athlete commands", summary: ATHLETE_ASK_HELP, rows: [] });
    return ATHLETE_ASK_HELP;
  }

  async function handleCommand(command: string): Promise<string> {
    const lower = normalizeCommand(command);
    setResult(null);
    try {
      if (pendingGeminiRef.current) {
        return runInterpretedAthleteCommand(command);
      }
      const navigation = parseAthleteNavigationCommand(command);
      if (navigation) {
        applyNavigation(navigation);
        return athleteNavigationReply(navigation);
      }
      if (pendingCoachMessageRef.current) {
        const messageBody = cleanCoachMessageBody(command);
        if (!messageBody) {
          setInputOpen(true);
          return "What message would you like to send?";
        }
        pendingCoachMessageRef.current = false;
        return sendCoachMessage(messageBody);
      }

      const waterAmount = parseWaterAmountMl(command);
      if (waterAmount && /\b(water|drink|drank|hydrat)\b/.test(lower)) {
        const res = await apiFetch("/api/athlete/water", { method: "POST", body: JSON.stringify({ date: today(), amountMl: waterAmount }) });
        if (!res.ok) throw new Error("water_failed");
        setResult({ title: "Water Logged", subtitle: today(), summary: `Logged ${waterAmount} ml of water.`, rows: [{ id: "water", icon: "water-outline", label: "Hydration", status: `${waterAmount} ml`, detail: "Added to today's water total.", tone: "ok", onPress: () => openDashboard("water") }] });
        return `Logged ${waterAmount} ml of water.`;
      }
      if (/\b(set|mark)\b.*\b(rest day|rest)\b/.test(lower)) {
        const res = await apiFetch("/api/athlete/rest-day", { method: "POST", body: JSON.stringify({ date: today(), enabled: true }) });
        if (!res.ok) throw new Error("rest_failed");
        setResult({ title: "Rest Day Set", subtitle: today(), summary: "Today is set as a rest day.", rows: [{ id: "rest", icon: "moon-outline", label: "Rest day", status: "On", detail: "Training inputs are paused for today.", tone: "ok", onPress: () => openDashboard("log") }] });
        return "Today is set as a rest day.";
      }
      if (/\b(remove|clear|turn off|disable)\b.*\b(rest day|rest)\b/.test(lower)) {
        const res = await apiFetch("/api/athlete/rest-day", { method: "POST", body: JSON.stringify({ date: today(), enabled: false }) });
        if (!res.ok) throw new Error("rest_clear_failed");
        setResult({ title: "Rest Day Removed", subtitle: today(), summary: "Rest day was removed for today.", rows: [{ id: "rest", icon: "barbell-outline", label: "Training log", status: "Open", detail: "Training inputs are available again.", tone: "ok", onPress: () => openDashboard("log") }] });
        return "Rest day was removed for today.";
      }
      const coachMessage = extractCoachMessage(command);
      if (coachMessage) {
        pendingCoachMessageRef.current = false;
        return sendCoachMessage(coachMessage);
      }
      if (isCoachMessageIntent(command)) {
        pendingCoachMessageRef.current = true;
        setResult({ title: "Ask Agent", subtitle: "Coach message", summary: "What message would you like to send?", rows: [] });
        return "What message would you like to send?";
      }
      const noteBody = extractNoteBody(command);
      if (noteBody) {
        const res = await apiFetch("/api/athlete/notes", { method: "POST", body: JSON.stringify({ date: today(), body: noteBody }) });
        if (!res.ok) throw new Error("note_failed");
        setResult({ title: "Note Saved", subtitle: today(), summary: noteBody, rows: [{ id: "note", icon: "document-text-outline", label: "Session note", status: "Saved", detail: "Added to today's athlete notes.", tone: "ok", onPress: () => openDashboard("log") }] });
        return "Note saved.";
      }
      return runInterpretedAthleteCommand(command);
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : "I could not complete that command. Please try again.";
      const summary = message === "water_failed" || message === "rest_failed" || message === "rest_clear_failed" || message === "note_failed"
        ? "I could not complete that command. Please try again."
        : message;
      setResult({ title: "Ask Agent", subtitle: "Athlete commands", summary, rows: [] });
      return summary;
    }
  }

  if (hidden) return null;
  return (
    <>
      <AskAgentControl accent={accent} accentInk={accentInk} onCommand={handleCommand} onInputOpenChange={setInputOpen} onListeningChange={(listening) => listening && setResult(null)} />
      {!inputOpen ? <AgentResultSheet result={result} onClose={() => setResult(null)} /> : null}
    </>
  );
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
  headText: { color: colors.inkMuted, fontSize: 10, fontWeight: "900", letterSpacing: 1.4, textTransform: "uppercase" },
  headStatus: { color: colors.inkMuted, fontSize: 10, fontWeight: "900", letterSpacing: 1.4, textTransform: "uppercase" },
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
  rowDetail: { marginTop: 2, color: colors.inkMuted, fontSize: 11, lineHeight: 15 },
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
  chatTitle: { color: colors.inkFaint, fontSize: 10, fontWeight: "900", letterSpacing: 1.1, textTransform: "uppercase" },
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
