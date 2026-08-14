import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Image, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from "react-native";
import { Text } from "../../components/AppText";
import { Ionicons } from "@expo/vector-icons";
import { BlurView, BlurTargetView } from "expo-blur";
import * as DocumentPicker from "expo-document-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { BarChart } from "react-native-chart-kit";
import { useLocalSearchParams, useRouter } from "expo-router";
import { speakAgentReply } from "../../lib/agentSpeech";
import { startVoiceConversation, type VoiceConversationHandle } from "../../lib/voiceSession";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from "react-native-svg";
import { AppFrame, type NativeNavItem } from "../../components/AppFrame";
import { Card, Muted, TextField } from "../../components/ui";
import { DatePickerPill } from "../../components/DatePickerPill";
import { type MessageParty, type MessageView } from "../../components/MessageCenter";
import { ChatMediaBubble } from "../../components/ChatMediaBubble";
import { ProfileMenu } from "../../components/ProfileMenu";
import { apiFetch, apiJson, API_BASE, getAccessToken, loadSession } from "../../lib/api";
import { ROLE_THEMES, colors, radius } from "../../lib/theme";
import { SESSION_SLOTS, SLOT_LABEL, type SessionSlot } from "../../lib/sessions";
import { TRAINING_CATEGORIES } from "../../lib/trainingCategories";
import { classifyReportQuery, isReportLikeQuery, requestedHistoryDays, type ReportDirection, type ReportMetric, type ReportSubject } from "../../lib/askAgentReportIntents";
import { athleteNavigationReply, parseAthleteNavigationCommand, type AthleteNavigationCommand } from "../../lib/athleteAskNavigation";
import {
  useAutoStartMobileTour,
  useTourAction,
  useTourHighlight,
  useTourScrollView,
  type TourHighlightStyle,
} from "../../lib/tour/MobileTourProvider";
import { SpotlightTarget, useSpotlightRef } from "../../lib/tour/SpotlightTarget";
import { fireMascotReaction } from "../../lib/tour/reactions";
import {
  summarizeTrend,
  fmtValue,
  fmtMagnitude,
  column,
  latestVal,
  type TrendSummary,
} from "../../lib/trendStats";

type Section = "today" | "progress" | "log" | "coach" | "messages";
type ProgressTab = "goals" | "water" | "trends";
type Band = "green" | "amber" | "red";

type DailySession = {
  status: string | null;
  type: string | null;
  durationMin?: number | null;
  intensityRpe?: number | null;
  attended?: boolean | null;
  workoutType?: string | null;
  sets?: number | null;
  reps?: string | null;
  actualDurationMin?: number | null;
  effortRating?: number | null;
  notes?: string | null;
};

type RpeEntry = {
  _id?: string;
  sessionType: SessionSlot;
  trainingCategory: string;
  plannedIntensityPercent: number;
  rpe: number;
  calculatedTrainingLoad: number;
  riskFlag: Band;
  riskReasons?: string[];
  readinessScore?: number;
  readinessBand?: Band;
  sleepQuality?: number;
  muscleSoreness?: number;
  fatigue?: number;
  moodMotivation?: number;
  bodyConditionFeedback?: string | null;
};

type DailyCard = {
  athleteId: string;
  name: string;
  sport: string;
  position: string | null;
  date: string;
  isRestDay?: boolean;
  attendance: { status: string | null; note?: string | null };
  sessions: Record<SessionSlot, DailySession>;
  readinessScore: number | null;
  sleep: { hours: number | null; quality: number | null };
  soreness: number | null;
  heartRate: { wakeHr: number | null; bedHr: number | null };
  recovery: { status: string | null; score: number | null; restingHr?: number | null; hrv?: number | null };
  injury: { active: boolean; bodyPart: string | null; severity: string | null; restriction: string | null };
  rpe?: RpeEntry | null;
  rpeEntries?: Record<SessionSlot, RpeEntry | null>;
};
type DailyResponse = { date: string; card: DailyCard };
type FeedItem = { id: string; at: string; kind: string; title: string; subtitle?: string; detail?: string; band?: Band };
type AthleteNote = { _id: string; body: string; date: string; createdAt: string };
type SessionPhotoMeta = { id: string; originalName: string; mimeType: string; sizeBytes: number; uploadedAt: string };
type CoachComment = { _id: string; body: string; date: string; createdAt: string; coachId: string };
type TeamAnnouncement = { id: string; body: string; coachName: string; createdAt: string };
type AssignedCoach = { coachId: string; name: string };
type MessageThreadSummary = {
  partyId: string;
  partyName: string;
  lastMessage: string;
  lastAt: string;
  lastSenderRole: "coach" | "athlete";
  unreadCount: number;
};
type WaterDay = { date: string; goalMl: number; totalMl: number; entries: { id: string; amountMl: number; loggedAt: string }[] };
type WaterPoint = { date: string; totalMl: number | null };
type WaterSeries = { days: number; goalMl: number; series: WaterPoint[] };
type TrendPoint = { date: string; readiness: number | null; load: number | null; sleepHours: number | null; recoveryScore: number | null };
type WellnessPoint = {
  date: string;
  sleepQuality: number | null;
  mood: number | null;
  stress: number | null;
  soreness: number | null;
  fatigue: number | null;
  wakeHr?: number | null;
  bedHr?: number | null;
  waterPct?: number | null;
};
type PerfPoint = { date: string; value: number; metric: string; unit: string };
type AchievementGoalKey = "check_in" | "training" | "hydration" | "all_rounder";
type AchievementTone = "green" | "amber" | "red";
type AchievementGoal = {
  key: AchievementGoalKey;
  title: string;
  description: string;
  metricLabel: string;
  target: number;
  currentStreak: number;
  completedDays: number;
  longestStreak: number;
  progress: number;
  achieved: boolean;
  tone: AchievementTone;
  reward: { title: string; description: string; badgeLabel: string; unlocked: boolean };
  history: { date: string; met: boolean }[];
};
type AchievementsResponse = {
  days: number;
  generatedAt: string;
  summary: {
    unlocked: number;
    nextGoal: { key: AchievementGoalKey; title: string; remaining: number } | null;
    bestStreak: { key: AchievementGoalKey; title: string; days: number } | null;
  };
  goals: AchievementGoal[];
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
type AskSessionWizardField = "trainingCategory" | "rpe" | "plannedIntensityPercent" | "muscleSoreness" | "fatigue" | "moodMotivation";
type AskSessionWizard = {
  slot: SessionSlot;
  patch: TrainingCommandPatch;
  remaining: AskSessionWizardField[];
};
type AskLogEntry = {
  id: string;
  role: "user" | "agent";
  text: string;
  /** Only meaningful for role "agent" — undefined for plain acknowledgements. */
  ok?: boolean;
};
type AskInfoRow = {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  status: string;
  detail: string;
  tone?: "ok" | "warn" | "bad" | "neutral";
  action?: { type: "section"; section: Section; slot?: SessionSlot; progressTab?: ProgressTab } | { type: "coachThread"; coachId?: string } | { type: "notifications" };
};
type AskInfoResult = {
  kind?: "data" | "report" | "suggestion";
  title: string;
  subtitle: string;
  summary: string;
  body?: string;
  sections?: { heading: string; text: string }[];
  rows: AskInfoRow[];
};
type AthleteSelfProfile = {
  name: string;
  email: string;
  createdAt: string | null;
  sport?: string | null;
  position?: string | null;
  dob?: string | null;
  heightCm?: number | null;
  weightKg?: number | null;
  timezone?: string | null;
  hydrationGoalMl?: number | null;
};
type NotificationView = {
  id: string;
  title: string;
  body: string;
  priority: "low" | "medium" | "high";
  read: boolean;
  createdAt: string;
};

type WellnessForm = {
  sleepHours: string;
  sleepQuality: string;
  mood: string;
  stress: string;
  soreness: string;
  fatigue: string;
};
type MessageHeader = { title: string; subtitle?: string };

const theme = ROLE_THEMES.athlete;
const HERO_RUNNER = require("../../../assets/images/athlete-runner-hero.png");
const today = () => new Date().toISOString().slice(0, 10);
const emptyWellness: WellnessForm = {
  sleepHours: "",
  sleepQuality: "3",
  mood: "3",
  stress: "3",
  soreness: "3",
  fatigue: "3",
};

function emptyDailyCard(date: string, name = "Athlete"): DailyCard {
  return {
    athleteId: "local-empty",
    name,
    sport: "",
    position: null,
    date,
    isRestDay: false,
    attendance: { status: null },
    sessions: {
      AM: { status: null, type: null },
      AFT: { status: null, type: null },
      PM: { status: null, type: null },
    },
    readinessScore: null,
    sleep: { hours: null, quality: null },
    soreness: null,
    heartRate: { wakeHr: null, bedHr: null },
    recovery: { status: null, score: null },
    injury: { active: false, bodyPart: null, severity: null, restriction: null },
    rpe: null,
    rpeEntries: { AM: null, AFT: null, PM: null },
  };
}

function emptyWeekLoad(date: string): { label: string; value: number | null }[] {
  return Array.from({ length: 7 }, (_, index) => {
    const day = addDays(date, index - 6);
    return { label: WEEKDAY_LETTER[new Date(`${day}T00:00:00`).getDay()], value: null };
  });
}

const NAV: NativeNavItem[] = [
  { key: "today", label: "Today", icon: "home-outline" },
  { key: "progress", label: "Progress", icon: "trending-up-outline" },
  { key: "log", label: "Log", icon: "add-outline" },
  { key: "coach", label: "Coach", icon: "person-outline" },
  { key: "messages", label: "Chat", icon: "chatbubble-ellipses-outline" },
];

const TRAINING_STATUS = [
  { value: "completed", label: "Done" },
  { value: "in_progress", label: "Partial" },
  { value: "skipped", label: "Missed" },
  { value: "rest", label: "Rest" },
] as const;
type SessionStatusValue = (typeof TRAINING_STATUS)[number]["value"];
const WORKOUT_TYPES = TRAINING_CATEGORIES;
const CATEGORY_CHOICES = TRAINING_CATEGORIES;
const RECOVERY_OPTIONS = ["Stretching", "Ice bath", "Mobility", "Physio", "Hydration"];

/**
 * Web-style dropdown for React Native: a compact field showing the selected
 * value that opens a modal option list on tap — mirrors the web app's <select>
 * for workout type / RPE category instead of a long inline list of chips.
 */
function Dropdown({
  value,
  options,
  onChange,
  placeholder = "Select…",
  title,
  compact,
}: {
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
  placeholder?: string;
  title?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable onPress={() => setOpen(true)} style={[styles.dropdownField, compact ? styles.dropdownFieldCompact : null]} accessibilityRole="button">
        <Text style={[styles.dropdownValue, compact ? styles.dropdownValueCompact : null, !value ? { color: colors.inkFaint } : null]} numberOfLines={1}>
          {value || placeholder}
        </Text>
        <Ionicons name="chevron-down" size={compact ? 13 : 16} color={colors.inkMuted} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.dropdownBackdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.dropdownSheet} onPress={(e) => e.stopPropagation()}>
            {title ? <Text style={styles.dropdownSheetTitle}>{title}</Text> : null}
            <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ paddingVertical: 2 }}>
              {options.map((opt) => {
                const sel = opt === value;
                return (
                  <Pressable
                    key={opt}
                    onPress={() => {
                      onChange(opt);
                      setOpen(false);
                    }}
                    style={[styles.dropdownItem, sel ? styles.dropdownItemOn : null]}
                  >
                    <Text style={[styles.dropdownItemText, sel ? styles.dropdownItemTextOn : null]} numberOfLines={2}>
                      {opt}
                    </Text>
                    {sel ? <Ionicons name="checkmark" size={16} color={theme.accentStrong} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
const WEEKDAY_LETTER = ["S", "M", "T", "W", "T", "F", "S"] as const;
const WATER_QUICK_ADD = [250, 500, 750];
const WATER_GOAL_PRESETS = [2000, 2500, 3000, 3500];
const WATER_REMINDER_KEY = "scp.hydration.reminders";
const WATER_REMINDER_ID = "scp.hydration.reminder";
type ReminderMinutes = 60 | 90 | 120;

function dash(v: string | number | null | undefined) {
  return v === null || v === undefined || v === "" ? "-" : String(v);
}

function displayDash(v: string | number | null | undefined) {
  return v === null || v === undefined || v === "" ? "--" : String(v);
}

function wellnessFiveToTen(value: number | null | undefined): string {
  if (value === null || value === undefined) return "--";
  return String(Math.max(1, Math.min(10, Math.round(1 + ((value - 1) * 9) / 4))));
}

// Wellness sliders are shown out of 10 but stored on the 1–5 scale (fractional,
// so values round-trip cleanly and the readiness engine is unchanged). Mirrors
// the athlete check-in's wellnessFiveToTen / wellnessTenToFive pair on web.
function wellnessTenFromStored(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return 5;
  return Math.max(1, Math.min(10, Math.round(1 + ((Number(value) - 1) * 9) / 4)));
}
function wellnessStoredFromTen(value: number): number {
  const v = Math.max(1, Math.min(10, Number(value) || 5));
  return 1 + ((v - 1) * 4) / 9;
}

function sleepQualityFromDurationHours(hours: number): number {
  if (hours >= 7.5 && hours <= 9) return wellnessStoredFromTen(9);
  if (hours >= 7 && hours < 7.5) return wellnessStoredFromTen(8);
  if (hours >= 6.5 && hours < 7) return wellnessStoredFromTen(7);
  if (hours >= 6 && hours < 6.5) return wellnessStoredFromTen(6);
  if (hours >= 5.5 && hours < 6) return wellnessStoredFromTen(5);
  if (hours > 9 && hours <= 10) return wellnessStoredFromTen(7);
  return wellnessStoredFromTen(4);
}

function firstNameOf(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/).filter(Boolean)[0] ?? "Athlete";
}

function localDateFromKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function dateKeyFromLocal(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(key: string, days: number) {
  const date = localDateFromKey(key);
  date.setDate(date.getDate() + days);
  return dateKeyFromLocal(date);
}

function parseAskDateCommand(text: string, currentDate: string): string | null {
  const lower = text.toLowerCase().trim();
  if (isCoachMessageIntent(lower) || /\b(send|tell|message|note|text)\b/.test(lower)) return null;
  if (!/\b(open|show|go to|move|switch|change|set|previous|prev|next|yesterday|tomorrow|today|calendar|calender|date|day)\b/.test(lower)) return null;
  if (/\byesterday\b/.test(lower) && /^(?:open|show|go to|move|switch|change|set)?\s*(?:to\s+)?yesterday\b|\byesterday(?:'s)?\s+(?:log|day|date|screen|page)\b/.test(lower)) return addDays(today(), -1);
  if (/\btomorrow\b/.test(lower) && /^(?:open|show|go to|move|switch|change|set)?\s*(?:to\s+)?tomorrow\b|\btomorrow(?:'s)?\s+(?:log|day|date|screen|page)\b/.test(lower)) return addDays(today(), 1);
  if (/^(today|open today|show today|go to today|move to today|switch to today|change to today)\b/.test(lower)) return today();
  if (/\b(previous|prev|back)\s+day\b|\bday\s+before\b/.test(lower)) return addDays(currentDate, -1);
  if (/\b(next)\s+day\b|\bday\s+after\b/.test(lower)) return addDays(currentDate, 1);

  const iso = lower.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) {
    const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Number.isNaN(date.getTime()) ? null : dateKeyFromLocal(date);
  }

  const slash = lower.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](20\d{2}))?\b/);
  if (slash) {
    const year = slash[3] ? Number(slash[3]) : localDateFromKey(currentDate).getFullYear();
    const date = new Date(year, Number(slash[1]) - 1, Number(slash[2]));
    return Number.isNaN(date.getTime()) ? null : dateKeyFromLocal(date);
  }
  return null;
}

function bandFor(score: number | null): Band {
  if (score == null) return "amber";
  if (score >= 80) return "green";
  if (score >= 60) return "amber";
  return "red";
}

function bandColor(band: Band) {
  if (band === "green") return colors.ok;
  if (band === "amber") return colors.warn;
  return colors.bad;
}

function readinessGuidance(score: number | null) {
  if (score === null) return { word: "No check-in", line: "Complete your check-in to get your readiness score and daily insights." };
  const band = bandFor(score);
  if (band === "green") return { word: "Ready to train", line: "Readiness indicator looks strong - cleared for full training." };
  if (band === "amber") return { word: "Caution", line: "Moderate readiness - manage load and listen to your body." };
  return { word: "Needs attention", line: "Low readiness indicator - prioritise recovery and tell your coach." };
}

function sleepQualityWord(scoreOutOfTen: number) {
  if (scoreOutOfTen >= 8) return "Good";
  if (scoreOutOfTen >= 6) return "Fair";
  return "Low";
}

function loadBandWord(band: Band) {
  if (band === "green") return "Low";
  if (band === "amber") return "Medium";
  return "High";
}

function shortDate(date: string) {
  const [, m, d] = date.split("-");
  return `${m}-${d}`;
}

function litres(ml: number) {
  return (ml / 1000).toFixed(ml % 1000 === 0 ? 0 : 1);
}

function wellnessTenToFive(raw: unknown): number {
  const value = Math.max(1, Math.min(10, Number(raw) || 5));
  return 1 + ((value - 1) * 4) / 9;
}

/**
 * `spoken` is a fresh 1-10 value from the voice interpreter and needs
 * wellnessTenToFive; `stored` is the existing check-in's own 1-5 value and
 * must NOT be converted again — passing it through wellnessTenToFive a
 * second time silently corrupts it (bug fixed here: previously any field
 * the athlete didn't mention got its already-stored value re-run through
 * the 10->5 formula on every voice check-in).
 */
function resolveWellnessField(spoken: unknown, stored: string): number | undefined {
  if (typeof spoken === "number") {
    return Number.isFinite(spoken) && spoken >= 1 && spoken <= 10 ? wellnessTenToFive(spoken) : undefined;
  }
  const n = Number(stored);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function resolveSessionWellnessField(spoken: unknown, displayed: number | string | undefined): number | undefined {
  if (typeof spoken === "number") {
    return Number.isFinite(spoken) && spoken >= 1 && spoken <= 10 ? wellnessTenToFive(spoken) : undefined;
  }
  const n = Number(displayed);
  return Number.isFinite(n) ? wellnessStoredFromTen(n) : undefined;
}

// Maps the server's `{error: "invalid_x"}` codes (see server/src/routes/athlete.ts)
// to a message an athlete can actually act on, instead of a blanket "save failed".
const API_ERROR_MESSAGES: Record<string, string> = {
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
  invalid_status: "That status isn't recognized.",
  invalid_attended: "That value isn't recognized.",
  invalid_workoutType: "Workout type is too long.",
  invalid_reps: "Reps value is too long.",
  invalid_sets: "Sets must be between 0 and 200.",
  invalid_actualDurationMin: "Duration must be between 0 and 600 minutes.",
  invalid_effortRating: "Effort/RPE must be between 1 and 10.",
  no_updates: "Nothing to update.",
  invalid_slot: "That session slot isn't recognized.",
  invalid_sessionType: "Session must be AM, afternoon, or PM.",
  invalid_trainingCategory: "That training category isn't recognized.",
  invalid_plannedIntensityPercent: "Planned intensity must be between 0 and 100 percent.",
  invalid_rpe: "RPE must be between 0 and 10.",
  invalid_muscleSoreness: "Soreness is out of range.",
  invalid_moodMotivation: "Mood is out of range.",
  invalid_restingHeartRate: "Resting heart rate must be between 20 and 220 bpm.",
  body_required: "Note can't be empty.",
  athlete_profile_not_found: "Your athlete profile could not be found.",
  coach_not_assigned: "First link with coach then you can enable to send message.",
};

const LINK_COACH_BEFORE_MESSAGE = "First link with coach then you can enable to send message.";

async function readApiError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
  if (body?.message) return body.message;
  const code = body?.error;
  if (!code) return "Save failed. Check your connection and try again.";
  return API_ERROR_MESSAGES[code] ?? `Save failed (${code}).`;
}

function latest<T>(arr: T[]): T | undefined {
  return arr.length ? arr[arr.length - 1] : undefined;
}

function sectionFromParam(value: string | undefined): Section {
  if (value === "today" || value === "progress" || value === "log" || value === "coach" || value === "messages") return value;
  if (value === "trends" || value === "water" || value === "achievements") return "progress";
  if (value === "chat") return "messages";
  return "today";
}

function progressTabFromParam(value: string | undefined): ProgressTab {
  if (value === "water") return "water";
  if (value === "trends") return "trends";
  return "goals";
}

function isWaterWriteCommand(text: string) {
  const lower = text.toLowerCase();
  return /\b(add|log|record|drink|drank|consumed)\b/.test(lower) && /\b(water|drink|hydrat|ml|millilit(?:er|re)s?|l|lit(?:er|re)s?)\b/.test(lower);
}

function parseWaterAmountMl(text: string): number | null {
  const lower = text.toLowerCase();
  const ml = lower.match(/(\d+(?:\.\d+)?)\s*(?:ml|millilit(?:er|re)s?)\b/);
  if (ml) return Math.round(Number(ml[1]));
  const litresMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:l|lit(?:er|re)s?)\b/);
  if (litresMatch) return Math.round(Number(litresMatch[1]) * 1000);
  const plainAmount = lower.match(/\b(\d{2,4})\b/);
  if (plainAmount) return Math.round(Number(plainAmount[1]));
  return null;
}

type TrainingCommandPatch = {
  status?: SessionStatusValue;
  workoutType?: string;
  actualDurationMin?: number;
  effortRating?: number;
  notes?: string;
  plannedIntensityPercent?: number;
  rpe?: number;
  moodMotivation?: number;
  muscleSoreness?: number;
  fatigue?: number;
  sleepQuality?: number;
  restingHeartRate?: number;
  bodyConditionFeedback?: string;
};
type TrainingCommand = { slot: SessionSlot | null; patch: TrainingCommandPatch };

function parseCommandSlot(text: string): SessionSlot | null {
  const lower = text.toLowerCase().replace(/\ba\.?\s*m\.?/g, "am").replace(/\bp\.?\s*m\.?/g, "pm");
  if (/\b(am|morning|strength)\b/.test(lower)) return "AM";
  if (/\b(aft|afternoon|after\s*noon|conditioning)\b/.test(lower) || /\bafter\b(?=.*\b(session|section|training)\b)/.test(lower)) return "AFT";
  if (/\b(pm|evening|night|skill)\b/.test(lower)) return "PM";
  return null;
}

function isOpenEndedSessionUpdateCommand(text: string) {
  const lower = text.toLowerCase();
  return /\b(update|save|fill|complete)\b/.test(lower) && /\b(section|session|training|workout)\b/.test(lower);
}

function isAskAcknowledgement(text: string) {
  return /^(?:ok|okay|yes|yeah|yep|done|fine|good|thanks|thank you)\.?$/i.test(text.trim());
}

const ASK_METRIC_FIELD_LABEL_PATTERN: Record<Exclude<AskSessionWizardField, "trainingCategory">, RegExp> = {
  rpe: /\brpe\b|\brpm\b|\beffort\b/,
  plannedIntensityPercent: /\bplanned\s+intensity\b|\bintensity\b|\bpercent\b|\bpercentage\b/,
  muscleSoreness: /\bsoreness\b|\bsore\b/,
  fatigue: /\bfatigue\b|\btired\b/,
  moodMotivation: /\bmood\b/,
};

/**
 * True when `text` names a DIFFERENT metric than `current` and does not also
 * name `current`'s own label — used to stop a wizard/follow-up question about
 * one field from grabbing a bare number that actually belongs to a different
 * field mentioned in the same reply (e.g. answering an RPE question with
 * "soreness is 6"). An explicit mention of `current`'s own label always wins
 * even if other field words also appear (e.g. "high intensity plyos, RPE 8" —
 * training-category names legitimately contain "intensity"). Never call this
 * with "trainingCategory" — it has no fixed label to check against.
 */
function isAskMetricFieldMismatch(current: Exclude<AskSessionWizardField, "trainingCategory">, text: string): boolean {
  const lower = text.toLowerCase();
  if (ASK_METRIC_FIELD_LABEL_PATTERN[current].test(lower)) return false;
  return (Object.keys(ASK_METRIC_FIELD_LABEL_PATTERN) as (keyof typeof ASK_METRIC_FIELD_LABEL_PATTERN)[]).some(
    (field) => field !== current && ASK_METRIC_FIELD_LABEL_PATTERN[field].test(lower)
  );
}

/** Anchored to the whole utterance (minus trailing punctuation/filler) so it never matches a longer command like "cancel rest day". */
function isAskCancelCommand(text: string) {
  const normalized = text.trim().toLowerCase().replace(/[!.?]+$/, "");
  return /^(?:ok(?:ay)?[,\s]+)?(?:no[,\s]+)?(?:never\s*mind|nevermind|cancel(?:\s+that)?|forget\s+it|scratch\s+that|stop(?:\s+that)?|abort|skip\s+(?:it|that)|not\s+now|nvm)$/.test(
    normalized
  );
}

function isSetRestDayCommand(text: string) {
  return /\b(set|mark|make|turn)\b.*\b(today|day)\b.*\brest\s*day\b/i.test(text) ||
    /\b(set|mark|make|turn)\b.*\brest\s*day\b.*\b(today|day)\b/i.test(text);
}

function isClearRestDayCommand(text: string) {
  return /\b(remove|clear|unset|cancel|disable)\b.*\brest\s*day\b/i.test(text) ||
    /\b(rest\s*day)\b.*\b(remove|clear|unset|cancel|disable)\b/i.test(text) ||
    /\b(turn|switch)\s+off\b.*\brest\s*day\b/i.test(text) ||
    /\brest\s*day\b.*\b(turn|switch)\s+off\b/i.test(text);
}

function valueNear(text: string, label: RegExp): number | null {
  const source = `(?:${label.source})`;
  const after = text.match(new RegExp(`${source}[^0-9]{0,24}(\\d{1,3})`, "i"));
  if (after) return Number(after[1]);
  const before = text.match(new RegExp(`(\\d{1,3})[^a-z0-9]{0,12}${source}`, "i"));
  return before ? Number(before[1]) : null;
}

function valueInRange(value: number | null, min: number, max: number): number | undefined {
  if (value === null || !Number.isFinite(value) || value < min || value > max) return undefined;
  return value;
}

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
};

function parseSpokenNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const text = raw.toLowerCase().trim().replace(/-/g, " ");
  const numeric = Number(text);
  if (Number.isFinite(numeric)) return numeric;
  const pointMatch = text.match(/^([a-z]+)\s+(?:point|dot)\s+([a-z]+|\d)$/);
  if (pointMatch) {
    const whole = NUMBER_WORDS[pointMatch[1]];
    const decimal = NUMBER_WORDS[pointMatch[2]] ?? Number(pointMatch[2]);
    if (whole !== undefined && Number.isFinite(decimal)) return whole + decimal / 10;
  }
  return NUMBER_WORDS[text] ?? null;
}

type SleepUpdateCommand =
  | { kind: "duration"; hours: number }
  | { kind: "missing_duration" }
  | { kind: "invalid_duration"; value: number };

function sleepDurationValue(text: string): number | null {
  const lower = text.toLowerCase();
  const numberToken = "(\\d+(?:\\.\\d+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen)\\s+(?:point|dot)\\s+(?:zero|one|two|three|four|five|six|seven|eight|nine|\\d))";
  const patterns = [
    new RegExp(`\\b(?:my\\s+|your\\s+)?sleep\\s+(?:duration|hours?)\\s*(?:to|as|is|=|:)?\\s*${numberToken}(?:\\s*(?:hours?|hrs?|mani|neram))?\\b`, "i"),
    new RegExp(`${numberToken}\\s*(?:hours?|hrs?|mani|neram)\\s+(?:of\\s+)?(?:sleep|thookam|tookam|urakkam)\\b`, "i"),
    new RegExp(`\\b(?:slept|thoongi\\w*|thoonginen)\\s*(?:for\\s*)?${numberToken}(?:\\s*(?:hours?|hrs?|mani|neram))?\\b`, "i"),
  ];
  for (const pattern of patterns) {
    const match = lower.match(pattern);
    const value = parseSpokenNumber(match?.[1]);
    if (value !== null) return value;
  }
  return null;
}

// Only duration phrases land here. Sleep score/quality phrases fall through to
// parseWellnessCommand so they update sleepQuality instead of sleepHours.
function parseSleepUpdateCommand(text: string): SleepUpdateCommand | null {
  const lower = text.toLowerCase();
  if (!/\b(?:sleep|slept|thoongi\w*|thoonginen)\b/.test(lower)) return null;
  if (/\bsleep\s+(?:score|quality|rating)\b|\bquality\b|\bscore\b/.test(lower)) return null;
  const isUpdate = /\b(change|update|set|save|log|record)\b/.test(lower);
  if (!isUpdate && !/\bslept\b/.test(lower)) return null;
  const value = sleepDurationValue(lower);
  if (value === null) return { kind: "missing_duration" };
  if (!Number.isFinite(value) || value < 0 || value > 14) return { kind: "invalid_duration", value };
  return { kind: "duration", hours: value };
}

function isExplicitDataViewQuery(text: string) {
  return /\b(show|view|display|inspect|list|see|open)\b.*\b(data|metric|metrics|score|scores|record|records|details|stats)\b/i.test(text) ||
    /\b(show|view|display|inspect|list|see|open)\b.*\b(readiness|recovery|sleep|load|water|hydration|fatigue|soreness|mood|stress|heart\s*rate|heartbeat|pulse|streak)\b/i.test(text);
}

function parseTrainingCommand(text: string): TrainingCommand | null {
  const lower = text.toLowerCase();
  const slot = parseCommandSlot(lower);
  const patch: TrainingCommandPatch = {};

  const effort = valueInRange(valueNear(lower, /\beffort\b/), 1, 10);
  if (effort !== undefined) patch.effortRating = effort;
  const rpe = valueInRange(valueNear(lower, /\b(?:session\s+)?rpm\b|\brpe\b/), 0, 10);
  if (rpe !== undefined) patch.rpe = rpe;
  const intensity = valueInRange(valueNear(lower, /\bplanned\s+intensity\b|\bintensity\b/), 0, 100);
  if (intensity !== undefined) patch.plannedIntensityPercent = intensity;
  const mood = valueInRange(valueNear(lower, /\bmood\b/), 1, 10);
  if (mood !== undefined) patch.moodMotivation = mood;
  const soreness = valueInRange(valueNear(lower, /\bsoreness\b|\bsore\b/), 1, 10);
  if (soreness !== undefined) patch.muscleSoreness = soreness;
  const fatigue = valueInRange(valueNear(lower, /\bfatigue\b|\btired\b/), 1, 10);
  if (fatigue !== undefined) patch.fatigue = fatigue;
  const duration = valueInRange(valueNear(lower, /\bduration\b|\bminutes?\b|\bmins?\b/), 0, 600);
  if (duration !== undefined) patch.actualDurationMin = duration;
  const restingHeartRate = valueInRange(valueNear(lower, /\bresting\s+(?:heart\s+)?rate\b|\bresting\s+hr\b|\bhr\b/), 20, 220);
  if (restingHeartRate !== undefined) patch.restingHeartRate = restingHeartRate;
  const sleepQuality = valueInRange(valueNear(lower, /\bsleep\s+quality\b|\bsleep\s+score\b/), 1, 10);
  if (sleepQuality !== undefined) patch.sleepQuality = sleepQuality;

  if (/\b(done|complete|completed|finish|finished)\b/.test(lower)) patch.status = "completed";
  if (/\b(partial|in progress)\b/.test(lower)) patch.status = "in_progress";
  if (/\b(missed|skip|skipped)\b/.test(lower)) patch.status = "skipped";
  if (/\b(rest|rest day)\b/.test(lower)) patch.status = "rest";

  const category = TRAINING_CATEGORIES.find((item) => lower.includes(item.toLowerCase()));
  if (category) patch.workoutType = category;

  const bodyCondition = text.match(/\bbody\s*(?:condition|feeling|feels?)\s*(?:is|was|:|-)?\s*(.+)$/i)?.[1]?.trim();
  if (bodyCondition) patch.bodyConditionFeedback = bodyCondition;

  const notes = text.match(/\b(?:add|set|update|write|create)?\s*(?:session|season|rd)?\s*(?:note|notes)\s*(?:for|is|are|to|:|-)?\s*(.+)$/i)?.[1]?.trim();
  if (notes && !bodyCondition) patch.notes = notes;

  return Object.keys(patch).length ? { slot, patch } : null;
}

type WellnessCommandFields = Partial<{
  sleepHours: number;
  sleepQuality: number;
  mood: number;
  stress: number;
  soreness: number;
  fatigue: number;
}>;

/**
 * Daily check-in (Wellness model) — distinct from parseTrainingCommand's
 * per-session RPE report. Only fires when there's no session context (no
 * AM/afternoon/PM slot, no rpe/rpm/intensity/effort keyword), so "AM sleep
 * quality 8" still routes to the session report as before, while a bare
 * "sleep 8 hours", "update mood to 7", or "log my check-in" routes here
 * instead — any of the five daily fields (sleep/mood/stress/soreness/fatigue)
 * is enough to claim the command, so a standalone "update mood" never falls
 * through to the per-session parser and gets misfiled against a training slot.
 */
function parseWellnessCommand(text: string): WellnessCommandFields | null {
  const lower = text.toLowerCase();
  const hasSessionContext =
    parseCommandSlot(lower) !== null || /\brpe\b|\brpm\b|\bintensity\b|\beffort\b|\bresting\s+(?:heart\s+)?rate\b/.test(lower);
  const isCheckIn = /\bcheck.?in\b/.test(lower);
  const mentionsWellnessField = /\b(sleep|slept|thookam|tookam|urakkam|thoongi|thoonginen|mood|stress|soreness|sore|fatigue|tired|sorvu|vali|azhutham)\b/.test(lower);
  if (hasSessionContext || (!isCheckIn && !mentionsWellnessField)) return null;

  const fields: WellnessCommandFields = {};
  // Bidirectional like the quality/mood/etc extraction below (valueNear) —
  // the old version only matched "8 hours" (number before the unit) and
  // silently dropped phrasings like "sleep hours to 8" or "hours: 8" (unit
  // before the number), which is exactly why some users saw quality update
  // but hours stay "--": their phrasing just happened to put the number
  // after the word "hours". Kept as its own regex (not valueNear) so the
  // decimal point in values like "7.5 hours" isn't lost.
  const hoursBefore = lower.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|mani|neram)\b/);
  const hoursAfter = lower.match(/(?:hours?|hrs?|mani|neram)[^0-9]{0,20}(\d+(?:\.\d+)?)/);
  const hoursValue = Number(hoursBefore?.[1] ?? hoursAfter?.[1]);
  if (hoursBefore || hoursAfter) {
    if (Number.isFinite(hoursValue) && hoursValue >= 0 && hoursValue <= 14) fields.sleepHours = hoursValue;
  }
  const quality = valueInRange(
    valueNear(lower, /\bsleep\s+quality\b|\bsleep\s+score\b|\bsleep\s+rating\b|\bthookam\s+quality\b|\bthookam\s+score\b|\btookam\s+quality\b|\btookam\s+score\b|\burakkam\s+quality\b|\burakkam\s+score\b|\bquality\b/),
    1,
    10
  );
  if (quality !== undefined) fields.sleepQuality = quality;
  const mood = valueInRange(valueNear(lower, /\bmood\b/), 1, 10);
  if (mood !== undefined) fields.mood = mood;
  const stress = valueInRange(valueNear(lower, /\bstress\b/), 1, 10);
  if (stress !== undefined) fields.stress = stress;
  const soreness = valueInRange(valueNear(lower, /\bsoreness\b|\bsore\b/), 1, 10);
  if (soreness !== undefined) fields.soreness = soreness;
  const fatigue = valueInRange(valueNear(lower, /\bfatigue\b|\btired\b/), 1, 10);
  if (fatigue !== undefined) fields.fatigue = fatigue;

  return Object.keys(fields).length || isCheckIn ? fields : null;
}

/**
 * A targeted single-field update ("update mood to 7") gets its own
 * confirmation naming the value ("Today's check-in: mood 7 updated.") instead
 * of the generic "Today's check-in saved.", reserved for genuine multi-field/
 * "check-in" commands. Always prefixed with "Today's check-in" so it can't be
 * confused with sessionRpeUpdateMessage's "Saved to your <slot> session" —
 * the two write to different records and both now state the saved value.
 */
function wellnessUpdateMessage(fields: WellnessCommandFields, isExplicitCheckIn: boolean): string {
  const parts: string[] = [];
  if (fields.sleepHours !== undefined) parts.push(`sleep ${fields.sleepHours}h`);
  if (fields.sleepQuality !== undefined) parts.push(`sleep quality ${fields.sleepQuality}`);
  if (fields.mood !== undefined) parts.push(`mood ${fields.mood}`);
  if (fields.stress !== undefined) parts.push(`stress ${fields.stress}`);
  if (fields.soreness !== undefined) parts.push(`soreness ${fields.soreness}`);
  if (fields.fatigue !== undefined) parts.push(`fatigue ${fields.fatigue}`);
  if (!parts.length) return "Today's check-in saved.";
  if (!isExplicitCheckIn && parts.length === 1) return `Today's check-in: ${parts[0]} updated.`;
  return `Today's check-in saved: ${parts.join(", ")}.`;
}

/** Wake/bed resting heart rate — distinct from parseTrainingCommand's per-session restingHeartRate. */
function parseHeartRateCommand(text: string): { key: "wakeHr" | "bedHr"; value: number } | null {
  const lower = text.toLowerCase();
  if (!/\bheart\s*rate\b/.test(lower)) return null;
  const isWake = /\bwake|waking|morning\b/.test(lower);
  const isBed = /\bbed|night|sleeping\b/.test(lower);
  if (!isWake && !isBed) return null;
  const match = lower.match(/(\d{2,3})/);
  if (!match) return null;
  const value = Number(match[1]);
  if (value < 25 || value > 220) return null;
  return { key: isWake ? "wakeHr" : "bedHr", value };
}

/** A private note to self — distinct from extractCoachMessage (never fires when "coach"/"couch" is mentioned). */
function parseNoteCommand(text: string): string | null {
  const lower = text.toLowerCase();
  if (/\bcoach\b|\bcouch\b/.test(lower)) return null;
  const match = text.match(/^(?:please\s+)?(?:add|save|write|create)?\s*(?:a\s+)?note\s*(?:to\s+myself|for\s+myself)?\s*(?:that|saying|:|-)?\s*(.+)$/i);
  const body = match?.[1]?.trim();
  return body || null;
}

/**
 * "press/tap/save <button>" — for commands like "press save AM button" that
 * name an on-screen action rather than dictating values. Only meaningful
 * when parseTrainingCommand found no fields (checked by the caller), since a
 * command carrying real values (e.g. "AM effort 8") should just write those
 * values directly rather than pressing a button that saves whatever is
 * already on screen.
 */
function parsePressCommand(text: string): { id: string; label: string } | null {
  const lower = text.toLowerCase();
  if (!/\b(press|tap|click|hit|push|save)\b/.test(lower)) return null;
  if (/\brecovery\b/.test(lower)) return { id: "press:save-recovery", label: "Save recovery" };
  if (/\bcheck.?in\b/.test(lower)) return { id: "press:save-checkin", label: "Save check-in" };
  const slot = parseCommandSlot(lower);
  if (slot === "AM") return { id: "press:save-am", label: "Save AM" };
  if (slot === "AFT") return { id: "press:save-aft", label: "Save afternoon" };
  if (slot === "PM") return { id: "press:save-pm", label: "Save PM" };
  return null;
}

function isDailyInfoQuery(text: string) {
  const lower = text.toLowerCase();
  return (
    /\b(show|what|which|how|how many|any|list|tell|find|summary|status|pending|left|remaining|today|daily|activities|activity|tasks?|todos?|to-dos?|updates?)\b/.test(lower) &&
    /\b(today|daily|activities|activity|tasks?|todos?|to-dos?|updates?|pending|left|remaining|done|completed|readiness|recovery|coach|feedback|training|log)\b/.test(lower)
  );
}

function isMetricInfoQuery(text: string) {
  const lower = text.toLowerCase();
  return /\b(readiness|recovery|sleep|load|water|hydrat|streak|fatigue|soreness|sore|mood|stress|heart\s*rate|heart\s*beat|heartbeat|pulse|bpm|rpm|rpe|score|scores|metric|metrics|stats|data|details)\b/.test(lower);
}

function isBareImproveQuery(text: string) {
  const lower = text.toLowerCase().trim();
  return /^(?:need\s+to\s+improve|improvement|improve|better)$/.test(lower);
}

function isPersonalInfoQuery(text: string) {
  const lower = text.toLowerCase();
  return /\b(my name|who am i|what is my name|email|profile|personal|account|using this app|days.*app|joined|member since|how many days)\b/.test(lower);
}

function isNotificationInfoQuery(text: string) {
  return /\b(notification|notifications|alert|alerts|reminder|reminders|unread)\b/i.test(text);
}

function daysSince(isoDate: string | null | undefined): number | null {
  if (!isoDate) return null;
  const started = new Date(isoDate).getTime();
  if (Number.isNaN(started)) return null;
  return Math.max(1, Math.floor((Date.now() - started) / 86400000) + 1);
}

function indiaHour(date = new Date()): number {
  try {
    const hour = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      hour12: false,
    }).formatToParts(date).find((part) => part.type === "hour")?.value;
    const parsed = Number(hour);
    if (Number.isFinite(parsed)) return parsed === 24 ? 0 : parsed;
  } catch {
    // Fall through to a fixed IST offset when Intl timezone data is unavailable.
  }
  return new Date(date.getTime() + 5.5 * 60 * 60 * 1000).getUTCHours();
}

function indiaGreeting(date = new Date()) {
  const hour = indiaHour(date);
  if (hour < 5) return "Good night,";
  if (hour < 12) return "Good morning,";
  if (hour < 17) return "Good afternoon,";
  if (hour < 21) return "Good evening,";
  return "Good night,";
}

function askInfoToneColor(tone: AskInfoRow["tone"]) {
  if (tone === "ok") return colors.ok;
  if (tone === "warn") return colors.warn;
  if (tone === "bad") return colors.bad;
  return colors.inkMuted;
}

function avg(values: (number | null | undefined)[]) {
  const nums = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!nums.length) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function rounded(value: number | null, digits = 0) {
  if (value === null) return "--";
  return value.toFixed(digits);
}

function metricText(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "--";
  const roundedValue = Number(value.toFixed(digits));
  return Number.isInteger(roundedValue) ? String(roundedValue) : roundedValue.toFixed(digits);
}

/** Metrics rankable via "which day/training was worst/best/average" — higherIsBetter flips which end counts as "worst". */
const DAY_EXTREMUM_METRICS: Record<ReportMetric, { label: string; unit: string; higherIsBetter: boolean; getValue: (card: DailyCard) => number | null }> = {
  readiness: { label: "Readiness", unit: "/100", higherIsBetter: true, getValue: (card) => card.readinessScore },
  sleep: { label: "Sleep", unit: "h", higherIsBetter: true, getValue: (card) => card.sleep.hours },
  recovery: { label: "Recovery", unit: "", higherIsBetter: true, getValue: (card) => card.recovery.score },
  soreness: { label: "Soreness", unit: "/10", higherIsBetter: false, getValue: (card) => card.soreness },
  training: {
    label: "Training load",
    unit: "",
    higherIsBetter: true,
    getValue: (card) => {
      const entries = SESSION_SLOTS.map((slot) => card.rpeEntries?.[slot]).filter((entry): entry is RpeEntry => Boolean(entry));
      if (!entries.length) return null;
      return entries.reduce((sum, entry) => sum + entry.calculatedTrainingLoad, 0) / entries.length;
    },
  },
  heartRate: {
    label: "Heart rate",
    unit: " bpm",
    higherIsBetter: false,
    getValue: (card) => card.heartRate.wakeHr ?? card.heartRate.bedHr,
  },
};

/**
 * Always prefixed with "Saved to your <slot> session" so it can't be
 * confused with wellnessUpdateMessage's "Today's check-in" — the two write to
 * different records (per-session RpeMonitoring vs. daily Wellness) and both
 * now state the saved value(s).
 */
function sessionRpeUpdateMessage(slot: SessionSlot, patch: TrainingCommandPatch): string {
  const parts: string[] = [];
  const rpeValue = patch.rpe ?? patch.effortRating;
  if (rpeValue !== undefined) parts.push(`RPE ${rpeValue}`);
  if (patch.plannedIntensityPercent !== undefined) parts.push(`planned intensity ${patch.plannedIntensityPercent}%`);
  if (patch.muscleSoreness !== undefined) parts.push(`soreness ${patch.muscleSoreness}`);
  if (patch.fatigue !== undefined) parts.push(`fatigue ${patch.fatigue}`);
  if (patch.sleepQuality !== undefined) parts.push(`sleep quality ${patch.sleepQuality}`);
  if (patch.moodMotivation !== undefined) parts.push(`mood ${patch.moodMotivation}`);
  if (patch.restingHeartRate !== undefined) parts.push(`resting heart rate ${patch.restingHeartRate} bpm`);
  if (patch.bodyConditionFeedback !== undefined) parts.push("body condition");
  if (!parts.length) return `Saved to your ${SLOT_LABEL[slot]} session.`;
  return `Saved to your ${SLOT_LABEL[slot]} session: ${parts.join(", ")}.`;
}

function buildDailyInfoResult({
  query,
  card,
  latestRpe,
  coachComments,
  activity,
}: {
  query: string;
  card: DailyCard | null;
  latestRpe?: RpeEntry;
  coachComments: CoachComment[];
  activity: FeedItem[];
}): AskInfoResult | null {
  if (!card || !isDailyInfoQuery(query)) return null;
  const lower = query.toLowerCase();
  const pendingOnly = /\b(pending|left|remaining|not done|incomplete|open|need(?:s)?\s+(?:to\s+)?update|will\s+i\s+update|should\s+i\s+update|to\s+update)\b/.test(lower);
  const rows: AskInfoRow[] = [];
  const hasCheckIn = card.readinessScore !== null || card.sleep.quality !== null;
  const recDone = card.recovery.score !== null || Boolean(card.recovery.status);

  rows.push({
    id: "check-in",
    icon: "pulse-outline",
    label: "Check-in",
    status: hasCheckIn ? "Done" : "Pending",
    detail: hasCheckIn ? `Readiness ${card.readinessScore ?? "--"}` : "Quick check-in is still open.",
    tone: hasCheckIn ? "ok" : "warn",
    action: { type: "section", section: "log" },
  });

  for (const slot of SESSION_SLOTS) {
    const session = card.sessions[slot];
    const rpe = card.rpeEntries?.[slot] ?? null;
    const done = Boolean(card.isRestDay) || Boolean(rpe) || sessionComplete(session);
    rows.push({
      id: `session-${slot}`,
      icon: done ? "checkmark-circle-outline" : "barbell-outline",
      label: `${SLOT_LABEL[slot]} session`,
      status: done ? "Done" : "Pending",
      detail: done
        ? `${session.workoutType ?? session.type ?? rpe?.trainingCategory ?? "Training"} logged`
        : `${session.workoutType ?? session.type ?? "Training"} needs log/RPE.`,
      tone: done ? "ok" : "warn",
      action: { type: "section", section: "log", slot },
    });
  }

  rows.push({
    id: "recovery",
    icon: "heart-outline",
    label: "Recovery",
    status: recDone ? "Done" : "Optional",
    detail: recDone ? `${card.recovery.status ?? "Recovery"} ${card.recovery.score ?? ""}`.trim() : "No recovery entry yet.",
    tone: recDone ? "ok" : "neutral",
    action: { type: "section", section: "log" },
  });

  if (card.injury.active) {
    rows.push({
      id: "injury",
      icon: "shield-outline",
      label: "Injury flag",
      status: "Active",
      detail: `${card.injury.bodyPart ?? "Body"}${card.injury.restriction ? ` - ${card.injury.restriction}` : ""}`,
      tone: "bad",
      action: { type: "section", section: "today" },
    });
  }

  if (latestRpe) {
    rows.push({
      id: "load",
      icon: "flame-outline",
      label: "Training load",
      status: `${latestRpe.calculatedTrainingLoad}`,
      detail: `${latestRpe.trainingCategory} · RPE ${latestRpe.rpe} · ${latestRpe.plannedIntensityPercent}%`,
      tone: latestRpe.riskFlag === "green" ? "ok" : latestRpe.riskFlag === "amber" ? "warn" : "bad",
      action: { type: "section", section: "log", slot: latestRpe.sessionType },
    });
  }

  if (coachComments.length) {
    rows.push({
      id: "coach-feedback",
      icon: "chatbubble-ellipses-outline",
      label: "Coach feedback",
      status: `${coachComments.length}`,
      detail: coachComments[0].body,
      tone: "neutral",
      action: { type: "section", section: "coach" },
    });
  }

  const activityRows: AskInfoRow[] = activity.slice(0, 4).map((item) => ({
    id: `activity-${item.id}`,
    icon: item.kind === "comment" ? "chatbubble-outline" : item.kind === "note" ? "document-text-outline" : "time-outline",
    label: item.title,
    status: relativeDate(item.at),
    detail: item.detail ?? item.subtitle ?? "Activity logged",
    tone: item.band === "green" ? "ok" : item.band === "amber" ? "warn" : item.band === "red" ? "bad" : "neutral",
    action: { type: "section", section: "coach" },
  }));

  const visibleRows = pendingOnly ? rows.filter((row) => row.status === "Pending" || row.status === "Active") : [...rows, ...activityRows];
  const pendingCount = rows.filter((row) => row.status === "Pending" || row.status === "Active").length;
  return {
    title: pendingOnly ? "Activities To Update Today" : "Today Summary",
    subtitle: card.date,
    summary: pendingOnly
      ? pendingCount
        ? `${pendingCount} item${pendingCount === 1 ? "" : "s"} need attention.`
        : "No activities need updating today."
      : `${rows.filter((row) => row.status === "Done").length} done · ${pendingCount} pending/flagged.`,
    rows: visibleRows.length ? visibleRows : [{
      id: "empty",
      icon: "checkmark-done-outline",
      label: "All clear",
      status: "Done",
      detail: "No activities need updating today.",
      tone: "ok",
    }],
  };
}

function cleanCoachMessageBody(text: string): string | null {
  const body = text
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

function isCoachMessageIntent(text: string): boolean {
  const lower = text.toLowerCase();
  return /\b(coach|couch|house)\b/.test(lower) && /\b(send|sending|sent|tell|message|note|text)\b/.test(lower);
}

function extractCoachMessage(text: string): string | null {
  const cleaned = text.trim();
  const lower = cleaned.toLowerCase();
  if (!/\b(coach|couch|house)\b/.test(lower) || !/\b(send|sending|sent|tell|message|note)\b/.test(lower)) return null;
  const patterns = [
    /^(?:now\s+)?(?:i\s+)?(?:want|need|would\s+like)\s+to\s+(?:send|tell|message|note|text)\s+(?:the\s+|a\s+|this\s+)?(?:message|note|text)?\s*(?:to\s+)?(?:my\s+)?(?:coach|couch|house)\s*(?:stating|setting|saying|that|:|-)?\s*(.*)$/i,
    /^(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:send|tell|message|note|text)\s+(?:the\s+|a\s+|this\s+)?(?:message|note|text)?\s*(?:to\s+)?(?:my\s+)?(?:coach|couch|house)\s*(?:stating|setting|saying|that|:|-)?\s*(.*)$/i,
    /^(?:please\s+)?(?:send|tell|message|note|text)\s+(?:the\s+|a\s+|this\s+)?(?:message|note|text)?\s*(?:to\s+)?(?:my\s+)?(?:coach|couch|house)\s*(?:stating|setting|saying|that|:|-)?\s*(.*)$/i,
    /^(.+?)\s+(?:send|sending|sent)\s+(?:this\s+)?(?:message|note)\s+to\s+(?:my\s+)?(?:coach|couch|house)$/i,
    /^(.+?)\s+(?:message|note)\s+to\s+(?:my\s+)?(?:coach|couch|house)$/i,
    /^(.+?)\s+(?:send|sending|sent)\s+(?:a\s+)?(?:message|note)\s+to\s+(?:my\s+)?(?:coach|couch|house)$/i,
    /^(?:send|sending|sent)\s+(.+?)\s+(?:message|note)\s+to\s+(?:my\s+)?(?:coach|couch|house)$/i,
    /^(?:send|sending|sent)\s+(?:a\s+)?(?:message|note)\s+to\s+(?:my\s+)?(?:coach|couch|house)\s*(?:for|that|saying|:|-)?\s*(.+)$/i,
    /^(?:send|sending|sent)\s+(?:my\s+)?(?:coach|couch|house)\s+(?:a\s+)?(?:message|note)\s*(?:for|that|saying|:|-)?\s*(.+)$/i,
    /^(?:tell|message|note)\s+(?:my\s+)?(?:coach|couch|house)\s*(?:that|saying|:|-)?\s*(.+)$/i,
  ];
  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    const body = match?.[1] ? cleanCoachMessageBody(match[1]) : null;
    if (body) return body;
  }
  const body = cleanCoachMessageBody(cleaned.replace(/\s+(?:message|note)?\s*to\s+(?:my\s+)?(?:coach|couch|house)$/i, ""));
  return body;
}

function extractLeaveCoachMessage(text: string): string | null {
  const lower = text.toLowerCase();
  const hasLeaveContext = /\b(leave|absent|absence|not attend|did not attend|can't attend|cannot attend|wont attend|won't attend|miss class|missed class|not available)\b/.test(lower);
  const hasClassContext = /\b(class|training|session|practice|coaching|today|tomorrow)\b/.test(lower);
  if (!hasLeaveContext || !hasClassContext) return null;
  return cleanCoachMessageBody(text);
}

export default function AthleteDashboard() {
  useAutoStartMobileTour("athlete");
  const { highlightStyle: headerHighlight } = useTourHighlight("mobile-athlete-header");
  const { highlightStyle: readinessHighlight } = useTourHighlight("mobile-athlete-readiness");
  const { highlightStyle: trainingHighlight } = useTourHighlight("mobile-athlete-training");
  const { highlightStyle: progressHighlight } = useTourHighlight("mobile-athlete-progress");
  const { highlightStyle: logHighlight } = useTourHighlight("mobile-athlete-log");
  const { highlightStyle: coachHighlight } = useTourHighlight("mobile-athlete-coach");
  const { highlightStyle: chatHighlight } = useTourHighlight("mobile-athlete-chat");
  const { highlightStyle: agentHighlight } = useTourHighlight("mobile-athlete-agent");
  const router = useRouter();
  const params = useLocalSearchParams<{ section?: string; coachId?: string; slot?: string }>();
  const requestedCoachId = typeof params.coachId === "string" ? params.coachId : null;
  const [section, setSection] = useState<Section>(() => sectionFromParam(params.section));
  const [progressTab, setProgressTab] = useState<ProgressTab>(() => progressTabFromParam(params.section));
  useTourAction("athlete:section:today", useCallback(() => setSection("today"), []));
  useTourAction("athlete:section:progress", useCallback(() => setSection("progress"), []));
  useTourAction("athlete:section:log", useCallback(() => setSection("log"), []));
  useTourAction("athlete:section:coach", useCallback(() => setSection("coach"), []));
  useTourAction("athlete:section:messages", useCallback(() => setSection("messages"), []));
  const [date, setDate] = useState(today());
  const [card, setCard] = useState<DailyCard | null>(null);
  const [coachComments, setCoachComments] = useState<CoachComment[]>([]);
  const [announcements, setAnnouncements] = useState<TeamAnnouncement[]>([]);
  const [coachCount, setCoachCount] = useState<number | null>(null);
  const [messageUnread, setMessageUnread] = useState(0);
  const [rpeEntries, setRpeEntries] = useState<RpeEntry[]>([]);
  const [water, setWater] = useState<WaterDay | null>(null);
  const [weekLoad, setWeekLoad] = useState<{ label: string; value: number | null }[]>([]);
  const [activity, setActivity] = useState<FeedItem[]>([]);
  const [achievements, setAchievements] = useState<AchievementsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // Auto-dismiss the top banner — a fresh timer starts each time the message
  // actually changes, and is cancelled (not fired) if it changes again first.
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 3000);
    return () => clearTimeout(timer);
  }, [error]);
  useEffect(() => {
    if (!info) return;
    const timer = setTimeout(() => setInfo(null), 3000);
    return () => clearTimeout(timer);
  }, [info]);
  const [messageHeader, setMessageHeader] = useState<MessageHeader>({ title: "Messages", subtitle: "Direct message" });
  const [logFocusSlot, setLogFocusSlot] = useState<SessionSlot | null>(null);
  const [currentLogSlot, setCurrentLogSlot] = useState<SessionSlot>("AM");

  const [wellness, setWellness] = useState<WellnessForm>(emptyWellness);
  const [hrForm, setHrForm] = useState({ wakeHr: "", bedHr: "" });
  const [recoveryModalities, setRecoveryModalities] = useState<string[]>([]);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [daily, commentsRes, rpeRes, activityRes, annRes, achievementsRes, waterRes, threadsRes] = await Promise.all([
        apiJson<DailyResponse>(`/api/athlete/daily?date=${date}`),
        apiJson<{ comments: CoachComment[] }>(`/api/athlete/coach-comments?date=${date}`).catch(() => ({ comments: [] })),
        apiJson<{ entries: RpeEntry[] }>(`/api/athlete/rpe-monitoring?date=${date}`).catch(() => ({ entries: [] })),
        apiJson<{ items: FeedItem[] }>("/api/athlete/activity?limit=30").catch(() => ({ items: [] })),
        apiJson<{ announcements?: TeamAnnouncement[]; coachCount?: number }>("/api/athlete/announcements").catch(() => ({
          announcements: [],
          coachCount: 0,
        })),
        apiJson<AchievementsResponse>("/api/athlete/achievements?days=60").catch(() => null),
        apiJson<WaterDay>(`/api/athlete/water?date=${date}`).catch(() => null),
        apiJson<{ threads: MessageThreadSummary[] }>("/api/athlete/messages/threads").catch(() => ({ threads: [] })),
      ]);

      setCard(daily.card);
      setCoachComments(commentsRes.comments ?? []);
      setRpeEntries(rpeRes.entries ?? []);
      setActivity(activityRes.items ?? []);
      setWater(waterRes);
      setAnnouncements(annRes.announcements ?? []);
      setCoachCount(annRes.coachCount ?? null);
      setMessageUnread((threadsRes.threads ?? []).reduce((sum, thread) => sum + (thread.unreadCount || 0), 0));
      setAchievements(achievementsRes);
      setWellness({
        sleepHours: daily.card.sleep.hours?.toString() ?? "",
        sleepQuality: daily.card.sleep.quality?.toString() ?? "3",
        mood: "3",
        stress: "3",
        soreness: daily.card.soreness?.toString() ?? "3",
        fatigue: "3",
      });
      setHrForm({
        wakeHr: daily.card.heartRate.wakeHr?.toString() ?? "",
        bedHr: daily.card.heartRate.bedHr?.toString() ?? "",
      });
    } catch {
      setError("Unable to load your day.");
      setCard((current) => current ?? emptyDailyCard(date));
      setCoachComments((current) => (current.length > 0 ? current : []));
      setRpeEntries((current) => (current.length > 0 ? current : []));
      setActivity((current) => (current.length > 0 ? current : []));
      setAnnouncements((current) => (current.length > 0 ? current : []));
      setCoachCount((current) => current ?? 0);
      setMessageUnread((current) => current || 0);
      setAchievements((current) => current ?? null);
      setWater((current) => current ?? null);
      setWeekLoad((current) => (current.length > 0 ? current : emptyWeekLoad(date)));
      setWellness(emptyWellness);
      setHrForm({ wakeHr: "", bedHr: "" });
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  // Last 7 days of training load for the mini bar chart on the Today tab.
  // Fetched separately from the main daily-card load so a slow week-of-history
  // request never blocks the primary Today content from rendering.
  useEffect(() => {
    let cancelled = false;
    const dates = Array.from({ length: 7 }, (_, index) => addDays(date, index - 6));
    Promise.all(
      dates.map((day) =>
        apiJson<{ entries: RpeEntry[] }>(`/api/athlete/rpe-monitoring?date=${day}`)
          .then((res) => (res.entries ?? []).reduce((sum, entry) => sum + (entry.calculatedTrainingLoad || 0), 0))
          .catch(() => null)
      )
    ).then((totals) => {
      if (cancelled) return;
      setWeekLoad(
        dates.map((day, index) => ({ label: WEEKDAY_LETTER[new Date(`${day}T00:00:00`).getDay()], value: totals[index] }))
      );
    });
    return () => {
      cancelled = true;
    };
  }, [date]);

  useEffect(() => {
    if (
      params.section === "today" ||
      params.section === "progress" ||
      params.section === "trends" ||
      params.section === "log" ||
      params.section === "water" ||
      params.section === "achievements" ||
      params.section === "coach" ||
      params.section === "messages" ||
      params.section === "chat"
    ) {
      setSection(sectionFromParam(params.section));
      setProgressTab(progressTabFromParam(params.section));
    }
  }, [params.section]);

  useEffect(() => {
    const slot = typeof params.slot === "string" ? params.slot.toUpperCase() : "";
    if (slot === "AM" || slot === "AFT" || slot === "PM") {
      setLogFocusSlot(slot);
      setCurrentLogSlot(slot);
      setSection("log");
    }
  }, [params.slot]);

  async function postJson(path: string, body: unknown, success: string): Promise<{ ok: boolean; message: string }> {
    setError(null);
    setInfo(null);
    try {
      const res = await apiFetch(path, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) {
        const message = await readApiError(res);
        setError(message);
        return { ok: false, message };
      }
      setInfo(success);
      await load(true);
      return { ok: true, message: success };
    } catch {
      const message = "Network error. Check your connection and try again.";
      setError(message);
      return { ok: false, message };
    }
  }

  async function submitWellness() {
    const result = await postJson(
      "/api/athlete/wellness",
      {
        date,
        sleepHours: wellness.sleepHours ? Number(wellness.sleepHours) : undefined,
        sleepQuality: Number(wellness.sleepQuality),
        mood: Number(wellness.mood),
        stress: Number(wellness.stress),
        soreness: Number(wellness.soreness),
        fatigue: Number(wellness.fatigue),
      },
      "Check-in saved."
    );
    fireMascotReaction(result.ok ? "athlete.checkin.success" : "athlete.checkin.error");
    return result;
  }

  async function submitHeartRate() {
    const payload: Record<string, number | string> = { date };
    for (const key of ["wakeHr", "bedHr"] as const) {
      const raw = hrForm[key].trim();
      if (!raw) continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 25 || n > 220) {
        setInfo("Heart rate must be between 25 and 220 bpm.");
        return false;
      }
      payload[key] = n;
    }
    if (!("wakeHr" in payload) && !("bedHr" in payload)) {
      // Heart rate is optional — leaving it blank (e.g. in Quick check-in) is
      // a normal skip, not an error worth surfacing.
      return true;
    }
    return postJson("/api/athlete/heart-rate", payload, "Heart rate saved.");
  }

  function toggleRecovery(value: string) {
    setRecoveryModalities((prev) => prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]);
  }

  const readiness = card?.readinessScore ?? null;
  const latestRpe = latest(rpeEntries);
  const isMessages = section === "messages";
  const nav = useMemo(
    () =>
      NAV.map((item) =>
        item.key === "coach"
          ? { ...item, badge: coachComments.length || undefined }
          : item.key === "messages"
            ? { ...item, badge: messageUnread || undefined }
            : item
      ),
    [coachComments.length, messageUnread]
  );

  const [rewardGoal, setRewardGoal] = useState<AchievementGoal | null>(null);
  const [quickCheckInOpen, setQuickCheckInOpen] = useState(false);
  const [askInputOpen, setAskInputOpen] = useState(false);
  const [askDraft, setAskDraft] = useState("");
  const [askConversationActive, setAskConversationActive] = useState(false);
  const [askConversationMode, setAskConversationMode] = useState<"voice" | "execute" | null>(null);
  const [askListening, setAskListening] = useState(false);
  const [askSpeaking, setAskSpeaking] = useState(false);
  const [askBusy, setAskBusy] = useState(false);
  const [askInfoResult, setAskInfoResult] = useState<AskInfoResult | null>(null);
  const [calendarOpenSignal, setCalendarOpenSignal] = useState(0);
  const blurTargetRef = useRef<View | null>(null);
  const tourScrollRef = useTourScrollView<ScrollView>();
  const askHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const askLongPressRef = useRef(false);
  const askPendingIntentRef = useRef<VoiceIntentName | null>(null);
  // Synchronous (unlike askListening state, which only updates on the next
  // render) guard against starting a second overlapping recognition session
  // — set the instant the button is pressed, before any async permission
  // check or recognition.start() even runs.
  const askVoiceActiveRef = useRef(false);
  const askConversationRef = useRef<VoiceConversationHandle | null>(null);
  // Same idea for typed submission: TextInput's onSubmitEditing can trigger
  // a blur as a side effect, firing onBlur (also wired to submit) with the
  // still-stale draft before React re-renders the cleared value — without a
  // synchronous lock that reads as one extra submission of the same text.
  const askSubmitLockRef = useRef(false);
  // Driven by real mic input level (see lib/voiceSession) — powers the glow
  // that pulses around the FAB while the user is actually speaking.
  const askGlow = useSharedValue(0);
  const [askLog, setAskLog] = useState<AskLogEntry[]>([]);
  const askLogSeqRef = useRef(0);
  const askLastReplyRef = useRef<string | null>(null);
  const askPendingConfirmationRef = useRef<{ command: string; prompt: string } | null>(null);
  const askPendingGeminiRef = useRef<AskPendingGeminiIntent | null>(null);
  const askPendingCoachMessageRef = useRef(false);
  const askSessionWizardRef = useRef<AskSessionWizard | null>(null);
  const askFallbackShownRef = useRef(false);

  // Conversation log shown above the Ask Agent button — every voice or typed
  // command, and what the agent actually did with it (or why it failed), so
  // the athlete isn't left guessing whether a command silently no-op'd.
  function logAskTurn(role: "user" | "agent", text: string, ok?: boolean) {
    if (role === "agent") askLastReplyRef.current = text;
    askLogSeqRef.current += 1;
    const id = `ask-${askLogSeqRef.current}`;
    setAskLog((prev) => [...prev.slice(-99), { id, role, text, ok }]);
  }
  function sayInfo(message: string) {
    setError(null);
    setInfo(message);
    logAskTurn("agent", message, true);
  }
  function sayError(message: string) {
    setInfo(null);
    setError(message);
    logAskTurn("agent", message, false);
  }
  async function runAsk(path: string, body: unknown, success: string): Promise<boolean> {
    const result = await postJson(path, body, success);
    logAskTurn("agent", result.message, result.ok);
    return result.ok;
  }

  // Lets a "press <button>" voice/text command trigger the SAME handler a
  // real on-screen button uses — needed for buttons like Save AM/AFT/PM,
  // whose form values (effort, sets, reps, ...) live entirely in
  // SessionLogSection's own local state and aren't reachable from here any
  // other way. Mirrors the tour system's useTourAction registration pattern.
  const askActionsRef = useRef(new Map<string, () => void | boolean | Promise<void | boolean>>());
  function registerAskAction(id: string, fn: () => void | boolean | Promise<void | boolean>) {
    askActionsRef.current.set(id, fn);
    return () => {
      if (askActionsRef.current.get(id) === fn) askActionsRef.current.delete(id);
    };
  }
  async function pressAskButton(id: string, label: string): Promise<boolean> {
    const fn = askActionsRef.current.get(id);
    if (!fn) {
      sayError(`I can't find a "${label}" button here.`);
      return false;
    }
    try {
      const result = await fn();
      const ok = result !== false;
      logAskTurn("agent", ok ? `Pressed ${label}.` : `Couldn't press ${label}.`, ok);
      return ok;
    } catch {
      logAskTurn("agent", `Couldn't press ${label}.`, false);
      return false;
    }
  }

  // Visible while a voice/text command is active, and for a short grace
  // period afterward so the final "done"/"issue" turn is actually readable
  // instead of vanishing the instant the request settles.
  const [askLogVisible, setAskLogVisible] = useState(false);
  const askLogHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const active = askConversationActive || askListening || askSpeaking || askBusy || askInputOpen;
    if (active && askLog.length > 0) setAskLogVisible(true);
    if (askLogHideTimerRef.current) clearTimeout(askLogHideTimerRef.current);
    if (!active && askLog.length > 0) {
      askLogHideTimerRef.current = setTimeout(() => setAskLogVisible(false), 6000);
    }
    return () => {
      if (askLogHideTimerRef.current) clearTimeout(askLogHideTimerRef.current);
    };
  }, [askConversationActive, askListening, askSpeaking, askBusy, askInputOpen, askLog.length]);

  function applyAskNavigation(command: AthleteNavigationCommand) {
    setAskInfoResult(null);
    if (command.kind === "notifications") {
      router.push("/notifications" as never);
      return;
    }
    if (command.kind === "calendar") {
      setCalendarOpenSignal((value) => value + 1);
      return;
    }
    if (command.slot) {
      openAskSessionSlot(command.slot);
      return;
    }
    setProgressTab(progressTabFromParam(command.section));
    setSection(sectionFromParam(command.section));
  }

  function handleAskNavigate(target: string) {
    const command = parseAthleteNavigationCommand(`open ${target}`);
    if (command) applyAskNavigation(command);
  }

  function openAskSessionSlot(slot: SessionSlot) {
    setAskInfoResult(null);
    setLogFocusSlot(slot);
    setCurrentLogSlot(slot);
    setSection("log");
    requestAnimationFrame(() => {
      setLogFocusSlot(slot);
      setCurrentLogSlot(slot);
    });
  }

  function handleAskInfoRowPress(row: AskInfoRow) {
    const action = row.action;
    if (!action) return;
    setAskInfoResult(null);
    if (action.type === "notifications") {
      router.push("/notifications" as never);
      return;
    }
    if (action.type === "coachThread") {
      if (action.coachId) {
        router.push({ pathname: "/athlete/dashboard", params: { section: "chat", coachId: action.coachId } } as never);
      } else {
        setSection("messages");
      }
      return;
    }
    if (action.slot) {
      setLogFocusSlot(action.slot);
      setCurrentLogSlot(action.slot);
    }
    if (action.progressTab) setProgressTab(action.progressTab);
    setSection(action.section);
  }

  async function sendCoachMessageFromAsk(body: string) {
    const messageBody = cleanCoachMessageBody(body);
    if (!messageBody) {
      askPendingCoachMessageRef.current = true;
      setSection("messages");
      if (!askConversationActive && !askListening && !askSpeaking) setAskInputOpen(true);
      sayInfo("What message would you like to send?");
      return;
    }
    const coachRes = await apiJson<{ coaches: AssignedCoach[] }>("/api/athlete/coaches");
    const coachId = requestedCoachId ?? coachRes.coaches?.[0]?.coachId;
    if (!coachId) {
      setSection("messages");
      sayInfo(LINK_COACH_BEFORE_MESSAGE);
      return;
    }
    const res = await apiFetch(`/api/athlete/messages/${coachId}`, {
      method: "POST",
      body: JSON.stringify({ body: messageBody }),
    });
    if (!res.ok) {
      sayError(await readApiError(res));
      return;
    }
    setSection("messages");
    sayInfo("Message sent to coach.");
  }

  async function saveTrainingCommandFromAsk(command: TrainingCommand) {
    if (!card) throw new Error("missing_daily_card");
    const slot = command.slot ?? (section === "log" ? currentLogSlot : logFocusSlot) ?? "AM";
    const form = makeSessionForms(card)[slot];
    const patch = command.patch;
    openAskSessionSlot(slot);

    const trainingPayload: Record<string, unknown> = { date };
    if (patch.status !== undefined) {
      trainingPayload.status = patch.status;
      if (patch.status === "completed") trainingPayload.attended = true;
      if (patch.status === "skipped") trainingPayload.attended = false;
    }
    if (patch.workoutType !== undefined) trainingPayload.workoutType = patch.workoutType;
    if (patch.actualDurationMin !== undefined) trainingPayload.actualDurationMin = patch.actualDurationMin;
    if (patch.effortRating !== undefined) trainingPayload.effortRating = patch.effortRating;
    if (patch.notes !== undefined) trainingPayload.notes = patch.notes;

    const hasTrainingPayload = Object.keys(trainingPayload).length > 1;
    if (hasTrainingPayload) {
      const ok = await runAsk(`/api/athlete/training/${slot}`, trainingPayload, `${SLOT_LABEL[slot]} session updated.`);
      if (!ok) return;
      openAskSessionSlot(slot);
    }

    const hasRpePayload =
      patch.plannedIntensityPercent !== undefined ||
      patch.rpe !== undefined ||
      patch.moodMotivation !== undefined ||
      patch.muscleSoreness !== undefined ||
      patch.fatigue !== undefined ||
      patch.sleepQuality !== undefined ||
      patch.restingHeartRate !== undefined ||
      patch.bodyConditionFeedback !== undefined;
    if (!hasRpePayload) return;

    const rpePayload = {
      date,
      sessionType: slot,
      trainingCategory: normalizeTrainingCategory(patch.workoutType ?? form.trainingCategory ?? form.workoutType),
      plannedIntensityPercent: patch.plannedIntensityPercent ?? form.plannedIntensityPercent,
      rpe: patch.rpe ?? patch.effortRating ?? form.rpe,
      sleepQuality: wellnessStoredFromTen(patch.sleepQuality ?? form.sleepQuality),
      muscleSoreness: wellnessStoredFromTen(patch.muscleSoreness ?? form.soreness),
      fatigue: wellnessStoredFromTen(patch.fatigue ?? form.fatigue),
      moodMotivation: wellnessStoredFromTen(patch.moodMotivation ?? form.moodMotivation),
      ...(patch.restingHeartRate !== undefined ? { restingHeartRate: patch.restingHeartRate } : {}),
      ...(patch.bodyConditionFeedback !== undefined ? { bodyConditionFeedback: patch.bodyConditionFeedback } : {}),
    };
    const ok = await runAsk("/api/athlete/rpe-monitoring", rpePayload, sessionRpeUpdateMessage(slot, patch));
    if (ok) openAskSessionSlot(slot);
  }

  function askSessionWizardQuestion(field: AskSessionWizardField) {
    if (field === "trainingCategory") return "What training category did you do?";
    if (field === "rpe") return "What was your session RPE from 1 to 10?";
    if (field === "plannedIntensityPercent") return "What was the planned intensity percent?";
    if (field === "muscleSoreness") return "What was your soreness from 1 to 10?";
    if (field === "fatigue") return "What was your fatigue from 1 to 10?";
    return "What was your mood from 1 to 10?";
  }

  function askSessionWizardValue(field: AskSessionWizardField, text: string): number | null {
    const lower = text.toLowerCase();
    const direct =
      field === "rpe" ? valueNear(lower, /\brpe\b|\brpm\b|\beffort\b/) :
      field === "plannedIntensityPercent" ? valueNear(lower, /\bplanned\s+intensity\b|\bintensity\b|\bpercent\b|\bpercentage\b/) :
      field === "muscleSoreness" ? valueNear(lower, /\bsoreness\b|\bsore\b/) :
      field === "fatigue" ? valueNear(lower, /\bfatigue\b|\btired\b/) :
      valueNear(lower, /\bmood\b/);
    const fallback = direct ?? Number(text.match(/\b(\d{1,3}(?:\.\d+)?)\b/)?.[1] ?? NaN);
    if (!Number.isFinite(fallback)) return null;
    if (field === "plannedIntensityPercent") return Math.max(0, Math.min(100, fallback));
    return Math.max(1, Math.min(10, fallback));
  }

  async function finishAskSessionWizard(wizard: AskSessionWizard) {
    askSessionWizardRef.current = null;
    await saveTrainingCommandFromAsk({ slot: wizard.slot, patch: wizard.patch });
  }

  async function handleAskSessionWizardAnswer(transcript: string): Promise<boolean> {
    const wizard = askSessionWizardRef.current;
    if (!wizard) return false;
    if (isLikelyNewAskCommand(transcript)) {
      askSessionWizardRef.current = null;
      return false;
    }
    const [field, ...rest] = wizard.remaining;
    if (!field) {
      await finishAskSessionWizard(wizard);
      return true;
    }
    const value = askSessionWizardValue(field, transcript);
    if (field === "trainingCategory") {
      if (/^\s*\d/.test(transcript)) {
        sayInfo(askSessionWizardQuestion(field));
        return true;
      }
      const patch: TrainingCommandPatch = { ...wizard.patch, workoutType: normalizeTrainingCategory(transcript) };
      const nextWizard = { ...wizard, patch, remaining: rest };
      askSessionWizardRef.current = nextWizard;
      if (rest.length) {
        sayInfo(askSessionWizardQuestion(rest[0]));
        return true;
      }
      await finishAskSessionWizard(nextWizard);
      return true;
    }
    if (isAskMetricFieldMismatch(field, transcript)) {
      askSessionWizardRef.current = null;
      return false;
    }
    if (value === null) {
      sayInfo(askSessionWizardQuestion(field));
      return true;
    }
    const patch: TrainingCommandPatch = { ...wizard.patch };
    if (field === "rpe") {
      patch.rpe = value;
      patch.effortRating = value;
    } else if (field === "plannedIntensityPercent") patch.plannedIntensityPercent = value;
    else if (field === "muscleSoreness") patch.muscleSoreness = value;
    else if (field === "fatigue") patch.fatigue = value;
    else patch.moodMotivation = value;

    const nextWizard = { ...wizard, patch, remaining: rest };
    askSessionWizardRef.current = nextWizard;
    if (rest.length) {
      sayInfo(askSessionWizardQuestion(rest[0]));
      return true;
    }
    await finishAskSessionWizard(nextWizard);
    return true;
  }

  function startAskSessionWizard(slot: SessionSlot, initial: TrainingCommandPatch = {}) {
    openAskSessionSlot(slot);
    const required: AskSessionWizardField[] = ["trainingCategory", "rpe", "plannedIntensityPercent", "muscleSoreness", "fatigue", "moodMotivation"];
    const remaining = required.filter((field) => {
      if (field === "trainingCategory") return initial.workoutType === undefined;
      if (field === "rpe") return initial.rpe === undefined && initial.effortRating === undefined;
      if (field === "plannedIntensityPercent") return initial.plannedIntensityPercent === undefined;
      if (field === "muscleSoreness") return initial.muscleSoreness === undefined;
      if (field === "fatigue") return initial.fatigue === undefined;
      return initial.moodMotivation === undefined;
    });
    if (!remaining.length) {
      void saveTrainingCommandFromAsk({ slot, patch: initial });
      return;
    }
    askPendingGeminiRef.current = null;
    askPendingIntentRef.current = null;
    setAskInputOpen(false);
    askSessionWizardRef.current = { slot, patch: initial, remaining };
    sayInfo(askSessionWizardQuestion(remaining[0]));
  }

  function shouldNavigateFromAsk(text: string) {
    return Boolean(parseAthleteNavigationCommand(text));
  }

  function isAskWriteCommand(text: string) {
    return isSetRestDayCommand(text) ||
      isClearRestDayCommand(text) ||
      Boolean(parseWellnessCommand(text)) ||
      Boolean(parseHeartRateCommand(text)) ||
      Boolean(parseTrainingCommand(text)) ||
      Boolean(parsePressCommand(text)) ||
      Boolean(extractCoachMessage(text)) ||
      Boolean(parseNoteCommand(text)) ||
      isWaterWriteCommand(text);
  }

  async function resolvePendingAskFollowUp(transcript: string): Promise<boolean> {
    const pending = askPendingGeminiRef.current;
    if (!pending || isLikelyNewAskCommand(transcript)) return false;

    const lower = transcript.toLowerCase();
    const numeric = transcript.match(/\b(\d+(?:\.\d+)?)\b/);
    const value = numeric ? Number(numeric[1]) : null;
    const slotFromText = parseCommandSlot(transcript);
    const collected = { ...pending.collected };
    if (slotFromText) collected.slot = slotFromText;

    if (pending.intent === "fill_rpe") {
      const slot = SESSION_SLOTS.includes(collected.slot as SessionSlot) ? (collected.slot as SessionSlot) : currentLogSlot;
      const form = card ? makeSessionForms(card)[slot] : null;
      const categoryFromText = TRAINING_CATEGORIES.find((item) => lower.includes(item.toLowerCase()));
      if (categoryFromText) collected.trainingCategory = categoryFromText;
      const rpeMismatch = isAskMetricFieldMismatch("rpe", transcript);
      if (!rpeMismatch && value !== null && value >= 0 && value <= 10) {
        collected.effortRating = value;
        collected.rpe = value;
      }

      const rpe =
        typeof collected.effortRating === "number"
          ? collected.effortRating
          : typeof collected.rpe === "number"
            ? collected.rpe
            : null;
      if (rpe === null) {
        if (rpeMismatch) {
          askPendingGeminiRef.current = null;
          return false;
        }
        askPendingGeminiRef.current = { ...pending, collected };
        sayError("Tell me the RPE as a number from 1 to 10.");
        return true;
      }

      askPendingGeminiRef.current = null;
      askPendingIntentRef.current = null;
      openAskSessionSlot(slot);
      await runAsk(
        "/api/athlete/rpe-monitoring",
        {
          date,
          sessionType: slot,
          trainingCategory: normalizeTrainingCategory(
            typeof collected.trainingCategory === "string" ? collected.trainingCategory : (form?.trainingCategory ?? form?.workoutType)
          ),
          plannedIntensityPercent:
            typeof collected.plannedIntensityPercent === "number" ? collected.plannedIntensityPercent : form?.plannedIntensityPercent,
          rpe,
          sleepQuality: resolveSessionWellnessField(collected.sleepQuality, form?.sleepQuality),
          muscleSoreness: resolveSessionWellnessField(collected.soreness, form?.soreness),
          fatigue: resolveSessionWellnessField(collected.fatigue, form?.fatigue),
          moodMotivation: resolveSessionWellnessField(collected.mood, form?.moodMotivation),
          ...(typeof collected.restingHeartRate === "number" ? { restingHeartRate: collected.restingHeartRate } : {}),
          ...(typeof collected.bodyConditionFeedback === "string" ? { bodyConditionFeedback: collected.bodyConditionFeedback } : {}),
        },
        sessionRpeUpdateMessage(slot, {
          rpe,
          plannedIntensityPercent: typeof collected.plannedIntensityPercent === "number" ? collected.plannedIntensityPercent : undefined,
          sleepQuality: typeof collected.sleepQuality === "number" ? collected.sleepQuality : undefined,
          muscleSoreness: typeof collected.soreness === "number" ? collected.soreness : undefined,
          fatigue: typeof collected.fatigue === "number" ? collected.fatigue : undefined,
          moodMotivation: typeof collected.mood === "number" ? collected.mood : undefined,
          restingHeartRate: typeof collected.restingHeartRate === "number" ? collected.restingHeartRate : undefined,
          bodyConditionFeedback: typeof collected.bodyConditionFeedback === "string" ? collected.bodyConditionFeedback : undefined,
        })
      );
      openAskSessionSlot(slot);
      return true;
    }

    if (pending.intent === "fill_training") {
      if (value !== null && !isAskMetricFieldMismatch("rpe", transcript)) {
        const slot = SESSION_SLOTS.includes(collected.slot as SessionSlot) ? (collected.slot as SessionSlot) : currentLogSlot;
        askPendingGeminiRef.current = null;
        askPendingIntentRef.current = null;
        await saveTrainingCommandFromAsk({ slot, patch: { effortRating: Math.max(1, Math.min(10, value)) } });
        return true;
      }
      if (value !== null) {
        askPendingGeminiRef.current = null;
        return false;
      }
    }

    return false;
  }

  async function buildHydrationInfoResult(): Promise<AskInfoResult> {
    const day = await apiJson<WaterDay>(`/api/athlete/water?date=${date}`);
    const remaining = Math.max(0, day.goalMl - day.totalMl);
    const pct = day.goalMl ? Math.min(100, Math.round((day.totalMl / day.goalMl) * 100)) : 0;
    const rows: AskInfoRow[] = [
      {
        id: "water-total",
        icon: "water-outline",
        label: "Consumed",
        status: `${day.totalMl} ml`,
        detail: `${litres(day.totalMl)} L logged today.`,
        tone: day.totalMl >= day.goalMl ? "ok" : "warn",
        action: { type: "section", section: "progress", progressTab: "water" },
      },
      {
        id: "water-goal",
        icon: "flag-outline",
        label: "Daily goal",
        status: `${day.goalMl} ml`,
        detail: `${pct}% complete.`,
        tone: day.totalMl >= day.goalMl ? "ok" : "neutral",
        action: { type: "section", section: "progress", progressTab: "water" },
      },
      {
        id: "water-remaining",
        icon: remaining ? "timer-outline" : "checkmark-done-outline",
        label: "Remaining",
        status: `${remaining} ml`,
        detail: remaining ? `${litres(remaining)} L left to hit your goal.` : "Goal reached for today.",
        tone: remaining ? "warn" : "ok",
        action: { type: "section", section: "progress", progressTab: "water" },
      },
      ...day.entries.slice(-4).reverse().map((entry) => ({
        id: `water-${entry.id}`,
        icon: "add-circle-outline" as keyof typeof Ionicons.glyphMap,
        label: "Water entry",
        status: `${entry.amountMl} ml`,
        detail: relativeDate(entry.loggedAt),
        tone: "neutral" as const,
        action: { type: "section" as const, section: "progress" as const, progressTab: "water" as const },
      })),
    ];
    return {
      title: "Hydration Today",
      subtitle: day.date,
      summary: remaining ? `${remaining} ml remaining today.` : "You reached today's water goal.",
      rows,
    };
  }

  async function buildMetricInfoResult(query: string): Promise<AskInfoResult | null> {
    const lower = query.toLowerCase();
    if (!isMetricInfoQuery(query) || isWaterWriteCommand(query)) return null;
    if (parseSleepUpdateCommand(query)) return null;
    const wantsAll = /\b(all|details|detail|data|stats|metric|metrics|scores|summary|overview|everything)\b/.test(lower);
    if (!wantsAll && /\b(water|drink|hydrat|consume|consumed)\b/.test(lower)) return buildHydrationInfoResult();
    if (!card) return null;

    const water = wantsAll ? await apiJson<WaterDay>(`/api/athlete/water?date=${date}`).catch(() => null) : null;
    const bestStreak = achievements?.summary.bestStreak;
    const matchingStreak = achievements?.goals.find((goal) =>
      (/\bwater|hydrat\b/.test(lower) && goal.key === "hydration") ||
      (/\btraining|session|load|rpm|rpe\b/.test(lower) && goal.key === "training") ||
      (/\bcheck.?in|readiness|sleep|fatigue|soreness|mood|stress\b/.test(lower) && goal.key === "check_in")
    );
    const fatigue = latestRpe?.fatigue ?? null;
    const soreness = latestRpe?.muscleSoreness ?? card.soreness ?? null;
    const rows: AskInfoRow[] = [];

    const addReadiness = () => rows.push({
      id: "metric-readiness",
      icon: "pulse-outline",
      label: "Readiness",
      status: metricText(card.readinessScore, 0),
      detail: card.readinessScore === null ? "No readiness score yet. Log today's check-in first." : readinessGuidance(card.readinessScore).line,
      tone: card.readinessScore === null ? "neutral" : card.readinessScore >= 75 ? "ok" : card.readinessScore >= 60 ? "warn" : "bad",
      action: { type: "section", section: "today" },
    });
    const addSleep = () => rows.push({
      id: "metric-sleep",
      icon: "moon-outline",
      label: "Sleep",
      status: card.sleep.quality === null ? "--" : `${metricText(card.sleep.quality)}/10`,
      detail: card.sleep.hours === null ? "Sleep hours are not logged." : `${metricText(card.sleep.hours)} hours logged today.`,
      tone: card.sleep.quality === null ? "neutral" : card.sleep.quality >= 7 ? "ok" : card.sleep.quality >= 5 ? "warn" : "bad",
      action: { type: "section", section: "today" },
    });
    const addRecovery = () => rows.push({
      id: "metric-recovery",
      icon: "heart-outline",
      label: "Recovery",
      status: metricText(card.recovery.score),
      detail: card.recovery.status ? `Recovery status is ${card.recovery.status}.` : "No recovery status logged today.",
      tone: card.recovery.score === null ? "neutral" : card.recovery.score >= 70 ? "ok" : card.recovery.score >= 50 ? "warn" : "bad",
      action: { type: "section", section: "log" },
    });
    const addLoad = () => rows.push({
      id: "metric-load",
      icon: "flame-outline",
      label: "Training load",
      status: latestRpe ? metricText(latestRpe.calculatedTrainingLoad) : "--",
      detail: latestRpe ? `${latestRpe.trainingCategory} · RPE ${metricText(latestRpe.rpe)} · ${latestRpe.riskFlag} flag.` : "No RPE/load entry logged today.",
      tone: latestRpe ? latestRpe.riskFlag === "green" ? "ok" : latestRpe.riskFlag === "amber" ? "warn" : "bad" : "neutral",
      action: { type: "section", section: "log", slot: latestRpe?.sessionType },
    });
    const addFatigue = () => rows.push({
      id: "metric-fatigue",
      icon: "battery-dead-outline",
      label: "Fatigue",
      status: fatigue === null ? "--" : `${metricText(fatigue)}/10`,
      detail: fatigue === null ? "No fatigue score logged in today's RPE entries." : "Higher fatigue means you may need more recovery.",
      tone: fatigue === null ? "neutral" : fatigue <= 4 ? "ok" : fatigue <= 7 ? "warn" : "bad",
      action: { type: "section", section: "log", slot: latestRpe?.sessionType },
    });
    const addSoreness = () => rows.push({
      id: "metric-soreness",
      icon: "body-outline",
      label: "Soreness",
      status: soreness === null ? "--" : `${metricText(soreness)}/10`,
      detail: soreness === null ? "No soreness score logged today." : "Use this with fatigue and readiness to judge recovery needs.",
      tone: soreness === null ? "neutral" : soreness <= 4 ? "ok" : soreness <= 7 ? "warn" : "bad",
      action: { type: "section", section: "today" },
    });
    const addHeartRate = () => {
      const wake = card.heartRate.wakeHr;
      const bed = card.heartRate.bedHr;
      const status = wake !== null ? `${metricText(wake, 0)} bpm` : bed !== null ? `${metricText(bed, 0)} bpm` : "--";
      const detail = wake !== null || bed !== null
        ? `Wake ${wake === null ? "--" : `${metricText(wake, 0)} bpm`} · Bed ${bed === null ? "--" : `${metricText(bed, 0)} bpm`}.`
        : "No heart-rate value logged today.";
      rows.push({
        id: "metric-heart-rate",
        icon: "heart-circle-outline",
        label: "Heart rate",
        status,
        detail,
        tone: wake !== null || bed !== null ? "neutral" : "warn",
        action: { type: "section", section: "today" },
      });
    };
    const addWater = () => {
      if (!water) return;
      const pct = water.goalMl ? Math.min(100, Math.round((water.totalMl / water.goalMl) * 100)) : 0;
      rows.push({
        id: "metric-water",
        icon: "water-outline",
        label: "Water",
        status: `${pct}%`,
        detail: `${litres(water.totalMl)} L logged, ${litres(Math.max(0, water.goalMl - water.totalMl))} L remaining.`,
        tone: pct >= 100 ? "ok" : pct >= 60 ? "warn" : "bad",
        action: { type: "section", section: "progress", progressTab: "water" },
      });
    };
    const addStreak = () => rows.push({
      id: "metric-streak",
      icon: "trophy-outline",
      label: "Streak",
      status: matchingStreak ? `${matchingStreak.currentStreak} day${matchingStreak.currentStreak === 1 ? "" : "s"}` : bestStreak ? `${bestStreak.days} day${bestStreak.days === 1 ? "" : "s"}` : "--",
      detail: matchingStreak ? `${matchingStreak.title}: longest ${matchingStreak.longestStreak} day${matchingStreak.longestStreak === 1 ? "" : "s"}.` : bestStreak ? `Best streak: ${bestStreak.title}.` : "No streak data available yet.",
      tone: matchingStreak || bestStreak ? "ok" : "neutral",
      action: { type: "section", section: "progress", progressTab: "goals" },
    });

    if (wantsAll) {
      addReadiness(); addSleep(); addRecovery(); addLoad(); addWater(); addStreak(); addFatigue(); addSoreness(); addHeartRate();
    } else if (/\bheart\s*rate|heart\s*beat|heartbeat|pulse|bpm\b/.test(lower)) addHeartRate();
    else if (/\breadiness\b/.test(lower)) addReadiness();
    else if (/\bsleep\b/.test(lower)) addSleep();
    else if (/\brecovery\b/.test(lower)) addRecovery();
    else if (/\bload|rpm|rpe\b/.test(lower)) addLoad();
    else if (/\bfatigue|tired\b/.test(lower)) addFatigue();
    else if (/\bsoreness|sore\b/.test(lower)) addSoreness();
    else if (/\bstreak\b/.test(lower)) addStreak();
    else return null;

    const primary = rows[0];
    return {
      title: wantsAll ? "Your Data Today" : primary.label,
      subtitle: card.date,
      summary: wantsAll
        ? rows.map((row) => `${row.label} ${row.status}`).join(" · ")
        : `${primary.label}: ${primary.status}. ${primary.detail}`,
      rows,
    };
  }

  async function buildCoachMessageInfoResult(): Promise<AskInfoResult> {
    const threadRes = await apiJson<{ threads: MessageThreadSummary[] }>("/api/athlete/messages/threads").catch(() => ({ threads: [] }));
    const threadRows: AskInfoRow[] = (threadRes.threads ?? []).slice(0, 5).map((thread) => ({
      id: `thread-${thread.partyId}`,
      icon: thread.unreadCount ? "mail-unread-outline" : "chatbubble-outline",
      label: thread.partyName || "Coach",
      status: thread.unreadCount ? `${thread.unreadCount} new` : "Seen",
      detail: thread.lastMessage || "No recent message.",
      tone: thread.unreadCount ? "warn" : "neutral",
      action: { type: "coachThread", coachId: thread.partyId },
    }));
    const feedbackRows: AskInfoRow[] = coachComments.slice(0, 3).map((comment) => ({
      id: `feedback-${comment._id}`,
      icon: "clipboard-outline",
      label: "Coach feedback",
      status: relativeDate(comment.createdAt),
      detail: comment.body,
      tone: "neutral",
      action: { type: "section", section: "coach" },
    }));
    const rows = [...threadRows, ...feedbackRows];
    return {
      title: "Coach Messages",
      subtitle: "Direct chat and feedback",
      summary: rows.length
        ? `${threadRows.filter((row) => row.status !== "Seen").length} unread chat update${threadRows.filter((row) => row.status !== "Seen").length === 1 ? "" : "s"}.`
        : "No coach messages or feedback found.",
      rows: rows.length ? rows : [{
        id: "no-coach-messages",
        icon: "chatbubble-ellipses-outline",
        label: "Coach messages",
        status: "None",
        detail: "No direct chat or coach feedback is available right now.",
        tone: "neutral",
        action: { type: "section", section: "messages" },
      }],
    };
  }

  async function buildPersonalInfoResult(query: string): Promise<AskInfoResult | null> {
    if (!isPersonalInfoQuery(query)) return null;
    const [sessionUser, profileRes] = await Promise.all([
      loadSession().catch(() => null),
      apiJson<{ athlete: AthleteSelfProfile }>("/api/athlete/me").catch(() => null),
    ]);
    const athlete = profileRes?.athlete;
    const name = athlete?.name || sessionUser?.name || card?.name || "your profile name";
    const email = athlete?.email || sessionUser?.email || "";
    const appDays = daysSince(athlete?.createdAt);
    const profileParts = [
      athlete?.sport ? `sport ${athlete.sport}` : null,
      athlete?.position ? `position ${athlete.position}` : null,
      athlete?.hydrationGoalMl ? `water goal ${athlete.hydrationGoalMl} ml` : null,
      athlete?.timezone ? `timezone ${athlete.timezone}` : null,
    ].filter(Boolean);
    const lower = query.toLowerCase();

    let summary = `Your name is ${name}.`;
    if (/\b(email|mail)\b/.test(lower)) {
      summary = email ? `Your email is ${email}.` : "I could not find an email on this session.";
    } else if (/\b(how many days|using this app|days.*app|joined|member since|account age)\b/.test(lower)) {
      summary = appDays ? `You have been using this app for ${appDays} day${appDays === 1 ? "" : "s"}.` : "I could not confirm when this account was created.";
    } else if (/\b(profile|personal|account|who am i)\b/.test(lower)) {
      summary = profileParts.length ? `${name}: ${profileParts.join(", ")}.` : `Your profile name is ${name}.`;
    }

    return {
      title: "Your Profile",
      subtitle: "Ask Agent profile lookup",
      summary,
      rows: [
        {
          id: "profile-name",
          icon: "person-outline",
          label: "Name",
          status: name,
          detail: email ? email : "Signed-in athlete profile.",
          tone: "neutral",
        },
        {
          id: "profile-app-days",
          icon: "calendar-outline",
          label: "Using app",
          status: appDays ? `${appDays} day${appDays === 1 ? "" : "s"}` : "--",
          detail: athlete?.createdAt ? `Account started ${athlete.createdAt.slice(0, 10)}.` : "Account start date is not available.",
          tone: appDays ? "ok" : "neutral",
        },
        {
          id: "profile-sport",
          icon: "fitness-outline",
          label: "Sport",
          status: athlete?.sport || card?.sport || "--",
          detail: athlete?.position ? `Position: ${athlete.position}.` : "No position saved.",
          tone: "neutral",
        },
      ],
    };
  }

  async function buildNotificationInfoResult(query: string): Promise<AskInfoResult | null> {
    if (!isNotificationInfoQuery(query)) return null;
    const result = await apiJson<{ notifications: NotificationView[]; unreadCount: number; hasUrgentUnread: boolean }>("/api/notifications?limit=5")
      .catch(() => null);
    if (!result) {
      return {
        title: "Notifications",
        subtitle: "Latest alerts",
        summary: "I could not load notifications right now.",
        rows: [{
          id: "notifications-error",
          icon: "notifications-outline",
          label: "Notifications",
          status: "Unavailable",
          detail: "Try opening notifications from the header.",
          tone: "neutral",
          action: { type: "notifications" },
        }],
      };
    }
    const unreadText = `${result.unreadCount} unread notification${result.unreadCount === 1 ? "" : "s"}`;
    const latest = result.notifications?.[0];
    const rows: AskInfoRow[] = (result.notifications ?? []).map((item) => ({
      id: `notification-${item.id}`,
      icon: item.read ? "notifications-outline" : "notifications",
      label: item.title || "Notification",
      status: item.read ? "Read" : item.priority === "high" ? "Urgent" : "Unread",
      detail: item.body || relativeDate(item.createdAt),
      tone: item.read ? "neutral" : item.priority === "high" ? "bad" : "warn",
      action: { type: "notifications" },
    }));
    return {
      title: "Notifications",
      subtitle: result.hasUrgentUnread ? "Urgent unread alert" : "Latest alerts",
      summary: latest ? `You have ${unreadText}. Latest: ${latest.title}.` : `You have ${unreadText}.`,
      rows: rows.length ? rows : [{
        id: "notifications-empty",
        icon: "notifications-outline",
        label: "Notifications",
        status: "None",
        detail: "No notifications found.",
        tone: "ok",
        action: { type: "notifications" },
      }],
    };
  }

  async function buildReportInfoResult(query: string): Promise<AskInfoResult> {
    const lower = query.toLowerCase();
    const days = requestedHistoryDays(query, 7);
    const mode: "weekly" | "improve" | "down" = /\b(suggest|suggestion|advice|recommend|recommendation|improve|improvement|better|next\s+steps?)\b/.test(lower)
      ? "improve"
      : /\b(down|low|weak|weaker|drop|dropped|struggle|struggling)\b/.test(lower)
        ? "down"
        : "weekly";
    const dates = Array.from({ length: days }, (_, index) => addDays(date, index - (days - 1)));
    const dailyCards = await Promise.all(
      dates.map((day) => apiJson<DailyResponse>(`/api/athlete/daily?date=${day}`).then((res) => res.card).catch(() => null))
    );
    const cards = dailyCards.filter((item): item is DailyCard => Boolean(item));
    const water = await apiJson<WaterSeries>(`/api/athlete/analytics/water?days=${days}`).catch(() => null);
    const allRpeEntries = cards.flatMap((item) => SESSION_SLOTS.map((slot) => item.rpeEntries?.[slot]).filter((entry): entry is RpeEntry => Boolean(entry)));
    const readinessAvg = avg(cards.map((item) => item.readinessScore));
    const recoveryAvg = avg(cards.map((item) => item.recovery.score));
    const sleepAvg = avg(cards.map((item) => item.sleep.hours));
    const sleepScoreAvg = avg(cards.map((item) => {
      const parsed = Number(wellnessFiveToTen(item.sleep.quality));
      return Number.isFinite(parsed) ? parsed : null;
    }));
    const loadAvg = avg(allRpeEntries.map((entry) => entry.calculatedTrainingLoad));
    const rpmAvg = avg(allRpeEntries.map((entry) => entry.rpe));
    const waterPct = water?.series?.length
      ? avg(water.series.map((point) => point.totalMl == null ? null : Math.min(100, Math.round((point.totalMl / Math.max(1, water.goalMl)) * 100))))
      : null;
    const sessionsDone = cards.reduce(
      (sum, item) => sum + SESSION_SLOTS.filter((slot) => Boolean(item.rpeEntries?.[slot]) || sessionComplete(item.sessions[slot])).length,
      0
    );
    const sessionsPlanned = cards.length * SESSION_SLOTS.length;
    const lowReadinessDays = cards.filter((item) => (item.readinessScore ?? 100) < 60).length;
    const highRiskLoads = allRpeEntries.filter((entry) => entry.riskFlag === "red" || entry.riskFlag === "amber").length;
    const injuryDays = cards.filter((item) => item.injury.active).length;
    const missingDataDays = cards.filter((item) => item.readinessScore === null && item.sleep.hours === null && !Object.values(item.rpeEntries ?? {}).some(Boolean)).length;
    const sleepDays = cards.filter((item) => typeof item.sleep.hours === "number");
    const sleepConsistency = sleepDays.length >= 2
      ? avg(sleepDays.map((item) => Math.abs((item.sleep.hours ?? 0) - (sleepAvg ?? 0))))
      : null;
    const bestSleep = sleepDays.reduce<DailyCard | null>((best, item) => best === null || (item.sleep.hours ?? 0) > (best.sleep.hours ?? 0) ? item : best, null);
    const worstSleep = sleepDays.reduce<DailyCard | null>((worst, item) => worst === null || (item.sleep.hours ?? 0) < (worst.sleep.hours ?? 0) ? item : worst, null);
    const firstReadiness = cards.find((item) => typeof item.readinessScore === "number")?.readinessScore ?? null;
    const lastReadiness = [...cards].reverse().find((item) => typeof item.readinessScore === "number")?.readinessScore ?? null;
    const readinessDirection = firstReadiness !== null && lastReadiness !== null
      ? lastReadiness > firstReadiness + 3 ? "up"
        : lastReadiness < firstReadiness - 3 ? "down"
          : "steady"
      : "unknown";
    const rangeLabel = `${dates[0]} to ${dates[dates.length - 1]}`;
    const focus = highRiskLoads
      ? "training load control"
      : sleepAvg !== null && sleepAvg < 7
        ? "sleep consistency"
        : waterPct !== null && waterPct < 90
          ? "hydration consistency"
          : lowReadinessDays
            ? "recovery before hard sessions"
            : null;
    const overviewText = [
      readinessAvg === null
        ? `Readiness history is incomplete over the last ${days} days, so treat this as a partial picture.`
        : `Readiness ${readinessDirection === "down" ? "fell" : readinessDirection === "up" ? "improved" : "held steady"} over the last ${days} days and is currently averaging ${rounded(readinessAvg)}/100${lowReadinessDays ? `, with ${lowReadinessDays} day${lowReadinessDays === 1 ? "" : "s"} below the recovery zone` : ""}.`,
      missingDataDays ? `${missingDataDays} of ${days} day${days === 1 ? "" : "s"} had no check-in, so some of this is inferred.` : null,
    ].filter(Boolean).join(" ");
    const focusText = highRiskLoads
      ? `Training load is the main concern: ${highRiskLoads} session${highRiskLoads === 1 ? "" : "s"} carried an amber or red RPE flag this week (average load ${rounded(loadAvg)}, average RPE ${rounded(rpmAvg, 1)}). Stacking hard sessions without recovery in between is what's most likely to push readiness lower.`
      : lowReadinessDays
        ? `Recovery is the main concern: ${lowReadinessDays} day${lowReadinessDays === 1 ? "" : "s"} this week sat below the target recovery zone, which limits how much load the body can safely absorb right now.`
        : sleepAvg !== null && sleepAvg < 7
          ? `Sleep is the main limiter: averaging ${rounded(sleepAvg, 1)}h at a ${rounded(sleepScoreAvg, 1)}/10 quality score, short of the 7-8h recovery target${worstSleep ? ` — the lowest night was ${worstSleep.date} at ${metricText(worstSleep.sleep.hours)}h` : ""}.`
          : waterPct !== null && waterPct < 90
            ? `Hydration consistency is the main limiter: averaging ${rounded(waterPct)}% of the daily goal across the week rather than a steady habit.`
            : `No improvement priority was generated because the recorded data did not cross the report thresholds for load risk, low readiness, short sleep, or hydration consistency.`;

    function actionPlan(kind: "weekly" | "improve" | "down"): string {
      const lines: string[] = [];
      if (highRiskLoads) {
        lines.push("Treat the next hard session as controlled work — cut planned intensity by 10-15%.");
        lines.push("Avoid stacking two high-load days back to back; add a recovery day between them.");
        lines.push("Flag the amber/red sessions to your coach before the next training block.");
      } else if (lowReadinessDays) {
        lines.push("Prioritise recovery habits (sleep, stretching, hydration) before adding load.");
        lines.push("Hold off increasing training intensity until readiness stabilises for 2-3 days.");
      } else if (sleepAvg !== null && sleepAvg < 7) {
        lines.push("Fix a consistent bedtime and target 7-8 hours for the next 3 nights.");
        lines.push("Avoid late or high-intensity sessions on short-sleep days.");
      } else if (waterPct !== null && waterPct < 90) {
        lines.push("Spread water intake across morning, afternoon, and evening instead of catching up late.");
        lines.push("Log every drink so the trend is accurate for the next report.");
      } else {
        lines.push("No action plan was generated from this data window.");
        lines.push("Keep logging check-ins, RPE, recovery, and hydration so the next analysis has enough signal.");
      }
      lines.push(
        kind === "down"
          ? "Use the next two check-ins to confirm whether the trend is improving before changing anything else."
          : "Keep logging every check-in and session so the next report stays reliable."
      );
      return lines.map((line) => `• ${line}`).join("\n");
    }

    function sectionsToBody(sections: { heading: string; text: string }[]): string {
      return sections.map((section) => `${section.heading}\n${section.text}`).join("\n\n");
    }

    const weeklySections = [
      { heading: "Overview", text: overviewText },
      { heading: "What's driving it", text: focusText },
      { heading: "Focus for the next 3 days", text: actionPlan("weekly") },
    ];
    const improveSections = [
      { heading: "Overview", text: overviewText },
      { heading: "Why this is the priority", text: focusText },
      { heading: "Action plan for the next 3 days", text: actionPlan("improve") },
    ];
    const downSections = [
      { heading: "What's trending down", text: overviewText },
      { heading: "Why", text: focusText },
      { heading: "What to do now", text: actionPlan("down") },
    ];

    const rows: AskInfoRow[] = [];
    if (mode === "weekly") {
      rows.push(
        {
          id: "weekly-readiness",
          icon: "pulse-outline",
          label: "Readiness average",
          status: rounded(readinessAvg),
          detail: `${lowReadinessDays} low-readiness day${lowReadinessDays === 1 ? "" : "s"}; trend ${readinessDirection}.`,
          tone: readinessAvg === null ? "neutral" : readinessAvg >= 75 ? "ok" : readinessAvg >= 60 ? "warn" : "bad",
          action: { type: "section", section: "today" },
        },
        {
          id: "weekly-sleep",
          icon: "moon-outline",
          label: "Sleep pattern",
          status: sleepAvg === null ? "--" : `${rounded(sleepAvg, 1)} h · ${rounded(sleepScoreAvg, 1)}/10`,
          detail: sleepConsistency === null
            ? "Sleep history is incomplete."
            : `Best ${bestSleep?.date ?? "--"} (${metricText(bestSleep?.sleep.hours)} h), lowest ${worstSleep?.date ?? "--"} (${metricText(worstSleep?.sleep.hours)} h).`,
          tone: sleepAvg === null ? "neutral" : sleepAvg >= 7 ? "ok" : sleepAvg >= 6 ? "warn" : "bad",
          action: { type: "section", section: "today" },
        },
        {
          id: "weekly-training",
          icon: "barbell-outline",
          label: "Training logged",
          status: `${sessionsDone}/${sessionsPlanned}`,
          detail: `${allRpeEntries.length} RPE entr${allRpeEntries.length === 1 ? "y" : "ies"} captured.`,
          tone: sessionsPlanned && sessionsDone / sessionsPlanned >= 0.8 ? "ok" : "warn",
          action: { type: "section", section: "log" },
        },
        {
          id: "weekly-load",
          icon: "flame-outline",
          label: "Average load",
          status: rounded(loadAvg),
          detail: `Average RPE ${rounded(rpmAvg, 1)} with ${highRiskLoads} flagged load${highRiskLoads === 1 ? "" : "s"}.`,
          tone: highRiskLoads ? "warn" : "ok",
          action: { type: "section", section: "log" },
        },
        {
          id: "weekly-water",
          icon: "water-outline",
          label: "Hydration goal",
          status: `${rounded(waterPct)}%`,
          detail: water ? `${water.series.filter((point) => (point.totalMl ?? 0) >= water.goalMl).length} of ${days} days reached the water goal.` : "Water history unavailable.",
          tone: waterPct === null ? "neutral" : waterPct >= 90 ? "ok" : waterPct >= 60 ? "warn" : "bad",
          action: { type: "section", section: "progress", progressTab: "water" },
        },
        {
          id: "weekly-next-step",
          icon: "checkmark-circle-outline",
          label: "Next-step plan",
          status: highRiskLoads || lowReadinessDays ? "Adjust" : "Maintain",
          detail: highRiskLoads
            ? "Reduce intensity after flagged RPE days and add recovery before the next hard session."
            : sleepAvg !== null && sleepAvg < 7
              ? "Move bedtime earlier until sleep average is at least 7 hours."
              : "No threshold-based next step was generated from this report window.",
          tone: highRiskLoads || lowReadinessDays ? "warn" : "ok",
          action: { type: "section", section: "log" },
        }
      );
      return {
        kind: "report",
        title: days === 7 ? "Last Week Report" : `${days}-Day Report`,
        subtitle: rangeLabel,
        summary: readinessDirection === "down"
          ? "Readiness is trending down — protect recovery before increasing load."
          : readinessDirection === "up"
            ? "Readiness is improving — keep the routine controlled and consistent."
            : "Recent history is mostly steady — the next step is consistency.",
        sections: weeklySections,
        body: sectionsToBody(weeklySections),
        rows,
      };
    }

    const opportunities: AskInfoRow[] = [
      {
        id: "improve-recovery",
        icon: "heart-outline",
        label: "Recovery",
        status: rounded(recoveryAvg),
        detail: recoveryAvg === null ? "Recovery entries are missing. Add recovery after sessions." : "Aim for steady recovery scoring after hard days.",
        tone: recoveryAvg === null || recoveryAvg < 70 ? "warn" : "ok",
        action: { type: "section", section: "log" },
      },
      {
        id: "improve-sleep",
        icon: "moon-outline",
        label: "Sleep",
        status: sleepAvg === null ? "--" : `${rounded(sleepAvg, 1)} h · ${rounded(sleepScoreAvg, 1)}/10`,
        detail: sleepAvg === null
          ? "Sleep is not logged consistently."
          : sleepAvg < 7
            ? "Set a fixed sleep window and target at least 7 hours before high-load days."
            : `Sleep is usable; keep variation within about 1 hour. Current average variation ${sleepConsistency === null ? "--" : `${rounded(sleepConsistency, 1)} h`}.`,
        tone: sleepAvg === null || sleepAvg < 7 ? "warn" : "ok",
        action: { type: "section", section: "log" },
      },
      {
        id: "improve-hydration",
        icon: "water-outline",
        label: "Hydration",
        status: `${rounded(waterPct)}%`,
        detail: "Use smaller water logs through the day to reach the daily goal.",
        tone: waterPct === null || waterPct < 90 ? "warn" : "ok",
        action: { type: "section", section: "progress", progressTab: "water" },
      },
      {
        id: "improve-load",
        icon: "speedometer-outline",
        label: "Load control",
        status: `${highRiskLoads} flags`,
        detail: highRiskLoads ? "Review amber/red load sessions and adjust intensity with your coach." : "Load is controlled; keep logging RPE.",
        tone: highRiskLoads ? "bad" : "ok",
        action: { type: "section", section: "log" },
      },
      {
        id: "improve-next-step",
        icon: "walk-outline",
        label: "Next-step plan",
        status: readinessDirection === "down" ? "Recover first" : "Build steady",
        detail: highRiskLoads
          ? "Next hard session should be reduced by 10-15% unless recovery improves."
          : sleepAvg !== null && sleepAvg < 7
            ? "For the next 3 nights, prioritise sleep before adding extra load."
            : "Keep training load steady and log every session so trends stay reliable.",
        tone: highRiskLoads || readinessDirection === "down" ? "warn" : "ok",
        action: { type: "section", section: "log" },
      },
    ];
    const sorted = [...opportunities].sort((a, b) => {
      const rank = { bad: 0, warn: 1, neutral: 2, ok: 3 };
      return rank[a.tone ?? "neutral"] - rank[b.tone ?? "neutral"];
    });

    if (mode === "improve") {
      return {
        kind: "suggestion",
        title: "Areas To Improve",
        subtitle: `Last ${days} days · ${rangeLabel}`,
        summary: focus ? `Main focus: ${focus}.` : "No improvement priority found from recorded data.",
        sections: improveSections,
        body: sectionsToBody(improveSections),
        rows: [],
      };
    }

    return {
      kind: "report",
      title: "Areas Trending Down",
      subtitle: `Last ${days} days · ${rangeLabel}`,
      summary: injuryDays
        ? `${injuryDays} injury-flagged day${injuryDays === 1 ? "" : "s"} plus ${highRiskLoads} load flag${highRiskLoads === 1 ? "" : "s"} need review.`
        : `${lowReadinessDays} low-readiness day${lowReadinessDays === 1 ? "" : "s"} and ${highRiskLoads} load flag${highRiskLoads === 1 ? "" : "s"} found.`,
      sections: downSections,
      body: sectionsToBody(downSections),
      rows: sorted.filter((row) => row.tone !== "ok").length ? sorted.filter((row) => row.tone !== "ok") : sorted.slice(0, 2),
    };
  }

  /** Ranks past daily cards by one metric to answer "which day was my worst/best/average". */
  async function buildDayExtremumInfoResult(intent: { direction: ReportDirection; metric: ReportMetric; days: number }): Promise<AskInfoResult> {
    const { direction, metric: metricKey, days } = intent;
    const metric = DAY_EXTREMUM_METRICS[metricKey];
    const dates = Array.from({ length: days }, (_, index) => addDays(date, index - (days - 1)));
    const dailyCards = await Promise.all(
      dates.map((day) => apiJson<DailyResponse>(`/api/athlete/daily?date=${day}`).then((res) => res.card).catch(() => null))
    );
    const cards = dailyCards.filter((item): item is DailyCard => Boolean(item));
    const scored = cards
      .map((item) => ({ item, value: metric.getValue(item) }))
      .filter((entry): entry is { item: DailyCard; value: number } => typeof entry.value === "number");

    const titlePrefix = direction === "worst" ? "Worst" : direction === "best" ? "Best" : "Average";
    if (!scored.length) {
      return {
        kind: "data",
        title: `${titlePrefix} Day`,
        subtitle: `Last ${days} days`,
        summary: `No ${metric.label.toLowerCase()} data was logged in the last ${days} days, so I can't tell which day was the ${direction === "average" ? "most typical" : direction}.`,
        rows: [],
      };
    }

    let target: { item: DailyCard; value: number };
    if (direction === "average") {
      const mean = scored.reduce((sum, entry) => sum + entry.value, 0) / scored.length;
      target = scored.reduce((closest, entry) => (Math.abs(entry.value - mean) < Math.abs(closest.value - mean) ? entry : closest), scored[0]);
    } else {
      target = scored.reduce((acc, entry) => {
        const wantsHigher = direction === "best" ? metric.higherIsBetter : !metric.higherIsBetter;
        const isBetterPick = wantsHigher ? entry.value > acc.value : entry.value < acc.value;
        return isBetterPick ? entry : acc;
      }, scored[0]);
    }

    const dayLabelText = target.item.date === date
      ? "today"
      : target.item.date === addDays(date, -1)
        ? "yesterday"
        : localDateFromKey(target.item.date).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
    const valueText = `${rounded(target.value, metricKey === "sleep" ? 1 : 0)}${metric.unit}`;
    const context = metricKey === "readiness"
      ? [
          target.item.sleep.hours !== null ? `sleep ${rounded(target.item.sleep.hours, 1)}h` : null,
          target.item.soreness !== null ? `soreness ${rounded(target.item.soreness, 1)}/10` : null,
        ].filter(Boolean).join(", ")
      : "";
    const directionWord = direction === "average" ? "closest-to-average" : direction;

    return {
      kind: "data",
      title: `${titlePrefix} Day`,
      subtitle: `Last ${days} days`,
      summary: `Your ${directionWord} ${metric.label.toLowerCase()} day in the last ${days} days was ${dayLabelText} (${target.item.date}) — ${metric.label.toLowerCase()} ${valueText}${context ? `, ${context}` : ""}.`,
      rows: [{
        id: "day-extremum",
        icon: direction === "worst" ? "trending-down-outline" : direction === "best" ? "trending-up-outline" : "analytics-outline",
        label: `${titlePrefix} day`,
        status: dayLabelText,
        detail: `${metric.label} ${valueText}${context ? ` · ${context}` : ""}.`,
        tone: direction === "worst" ? "bad" : direction === "best" ? "ok" : "neutral",
        action: { type: "section", section: "today" },
      }],
    };
  }

  /**
   * A plain average/trend report scoped to ONE named metric — e.g. "give me a
   * report of my heart rate". Distinct from buildReportInfoResult (the general
   * readiness/load overview) and from buildDayExtremumInfoResult (a single-day
   * ranking): this is neither — just "how has X been over the last N days".
   */
  async function buildMetricReportInfoResult(subject: ReportSubject, days: number): Promise<AskInfoResult> {
    const dates = Array.from({ length: days }, (_, index) => addDays(date, index - (days - 1)));

    if (subject === "water") {
      const water = await apiJson<WaterSeries>(`/api/athlete/analytics/water?days=${days}`).catch(() => null);
      const points = (water?.series ?? []).filter((point): point is WaterPoint & { totalMl: number } => typeof point.totalMl === "number");
      if (!water || !points.length) {
        return { kind: "data", title: "Hydration Report", subtitle: `Last ${days} days`, summary: `No water intake was logged in the last ${days} days.`, rows: [] };
      }
      const avgMl = points.reduce((sum, point) => sum + point.totalMl, 0) / points.length;
      const avgPct = Math.round((avgMl / Math.max(1, water.goalMl)) * 100);
      const goalDays = points.filter((point) => point.totalMl >= water.goalMl).length;
      return {
        kind: "data",
        title: "Hydration Report",
        subtitle: `Last ${days} days`,
        summary: `You averaged ${avgPct}% of your ${litres(water.goalMl)} L water goal over the last ${days} days, reaching it on ${goalDays} of ${points.length} logged day${points.length === 1 ? "" : "s"}.`,
        rows: [{
          id: "water-report",
          icon: "water-outline",
          label: "Hydration",
          status: `${avgPct}%`,
          detail: `${goalDays}/${points.length} days at goal.`,
          tone: avgPct >= 90 ? "ok" : avgPct >= 60 ? "warn" : "bad",
          action: { type: "section", section: "progress", progressTab: "water" },
        }],
      };
    }

    if (subject === "mood" || subject === "stress" || subject === "fatigue") {
      const wellness = await apiJson<{ series: WellnessPoint[] }>(`/api/athlete/analytics/wellness?days=${days}`).catch(() => null);
      const values = (wellness?.series ?? [])
        .map((point) => point[subject])
        .filter((value): value is number => typeof value === "number");
      const label = subject === "mood" ? "Mood" : subject === "stress" ? "Stress" : "Fatigue";
      const lowerIsBetter = subject !== "mood";
      if (!values.length) {
        return { kind: "data", title: `${label} Report`, subtitle: `Last ${days} days`, summary: `No ${label.toLowerCase()} check-ins were logged in the last ${days} days.`, rows: [] };
      }
      const avgVal = values.reduce((sum, value) => sum + value, 0) / values.length;
      const first = values[0];
      const last = values[values.length - 1];
      const improving = lowerIsBetter ? last < first - 1 : last > first + 1;
      const worsening = lowerIsBetter ? last > first + 1 : last < first - 1;
      const trend = improving ? "improving" : worsening ? "worsening" : "steady";
      return {
        kind: "data",
        title: `${label} Report`,
        subtitle: `Last ${days} days`,
        summary: `Your ${label.toLowerCase()} has averaged ${rounded(avgVal, 1)}/10 over the last ${days} days and is ${trend}.`,
        rows: [{
          id: `${subject}-report`,
          icon: subject === "mood" ? "happy-outline" : subject === "stress" ? "alert-circle-outline" : "battery-dead-outline",
          label,
          status: `${rounded(avgVal, 1)}/10`,
          detail: `Trend: ${trend}.`,
          tone: worsening ? "bad" : improving ? "ok" : "neutral",
          action: { type: "section", section: "log" },
        }],
      };
    }

    const metricKey: ReportMetric = subject;
    const config = DAY_EXTREMUM_METRICS[metricKey];
    const dailyCards = await Promise.all(
      dates.map((day) => apiJson<DailyResponse>(`/api/athlete/daily?date=${day}`).then((res) => res.card).catch(() => null))
    );
    const cards = dailyCards.filter((item): item is DailyCard => Boolean(item));
    const scored = cards.map((item) => config.getValue(item)).filter((value): value is number => typeof value === "number");
    if (!scored.length) {
      return { kind: "data", title: `${config.label} Report`, subtitle: `Last ${days} days`, summary: `No ${config.label.toLowerCase()} data was logged in the last ${days} days.`, rows: [] };
    }
    const digits = metricKey === "sleep" ? 1 : 0;
    const avgVal = scored.reduce((sum, value) => sum + value, 0) / scored.length;
    const bestVal = config.higherIsBetter ? Math.max(...scored) : Math.min(...scored);
    const worstVal = config.higherIsBetter ? Math.min(...scored) : Math.max(...scored);
    return {
      kind: "data",
      title: `${config.label} Report`,
      subtitle: `Last ${days} days`,
      summary: `Your ${config.label.toLowerCase()} averaged ${rounded(avgVal, digits)}${config.unit} over the last ${days} days — best ${rounded(bestVal, digits)}${config.unit}, lowest ${rounded(worstVal, digits)}${config.unit}.`,
      rows: [{
        id: `${metricKey}-report`,
        icon: metricKey === "heartRate" ? "heart-circle-outline" : metricKey === "training" ? "barbell-outline" : metricKey === "recovery" ? "heart-outline" : metricKey === "soreness" ? "body-outline" : metricKey === "sleep" ? "moon-outline" : "pulse-outline",
        label: config.label,
        status: `${rounded(avgVal, digits)}${config.unit}`,
        detail: `Best ${rounded(bestVal, digits)}${config.unit} · Lowest ${rounded(worstVal, digits)}${config.unit}.`,
        tone: "neutral",
        action: { type: "section", section: "today" },
      }],
    };
  }

  /** Lists past training sessions (not a ranking) to answer "list out my past training/workouts". */
  async function buildTrainingHistoryInfoResult(days: number): Promise<AskInfoResult> {
    const dates = Array.from({ length: days }, (_, index) => addDays(date, index - (days - 1)));
    const dailyCards = await Promise.all(
      dates.map((day) => apiJson<DailyResponse>(`/api/athlete/daily?date=${day}`).then((res) => res.card).catch(() => null))
    );
    const cards = dailyCards.filter((item): item is DailyCard => Boolean(item));
    const rows: AskInfoRow[] = [];
    for (const item of cards) {
      for (const slot of SESSION_SLOTS) {
        const session = item.sessions[slot];
        const rpe = item.rpeEntries?.[slot];
        if (!session.type && !session.status && !rpe) continue;
        const statusLabel = TRAINING_STATUS.find((entry) => entry.value === session.status)?.label ?? (rpe ? "Logged" : "Planned");
        rows.push({
          id: `training-${item.date}-${slot}`,
          icon: "barbell-outline",
          label: `${item.date} · ${SLOT_LABEL[slot]}`,
          status: statusLabel,
          detail: [session.type, rpe ? `RPE ${metricText(rpe.rpe)}` : null].filter(Boolean).join(" · ") || "No details logged.",
          tone: session.status === "completed" ? "ok" : session.status === "skipped" ? "bad" : "neutral",
          action: { type: "section", section: "log", slot },
        });
      }
    }
    rows.reverse();

    return {
      kind: "data",
      title: "Training History",
      subtitle: `Last ${days} days`,
      summary: rows.length
        ? `${rows.length} training entr${rows.length === 1 ? "y" : "ies"} logged in the last ${days} days.`
        : `No training sessions were logged in the last ${days} days.`,
      rows: rows.length ? rows.slice(0, 20) : [{
        id: "training-history-empty",
        icon: "barbell-outline",
        label: "Training history",
        status: "None",
        detail: `No sessions logged in the last ${days} days.`,
        tone: "neutral",
        action: { type: "section", section: "log" },
      }],
    };
  }

  async function buildAskInfoResult(query: string): Promise<AskInfoResult | null> {
    const lower = query.toLowerCase();
    if (/^(send|sent|sending|message|note)\b/.test(lower) || /^tell\s+(?:my\s+)?(?:coach|couch)\b/.test(lower)) return null;
    if (parseSleepUpdateCommand(query)) return null;
    if (isBareImproveQuery(query)) return null;
    const questionStyle = /\b(tell me|what|which|how|how many|any|do i|have i|status|summary|pending|left|remaining)\b/.test(lower);
    const reportIntent = classifyReportQuery(query);
    if (reportIntent.kind === "day_extremum") return buildDayExtremumInfoResult(reportIntent);
    if (reportIntent.kind === "progress_advice") return buildReportInfoResult(`${query} improvement`);
    if (reportIntent.kind === "metric_report") return buildMetricReportInfoResult(reportIntent.subject, reportIntent.days);
    if (reportIntent.kind === "list_training_history") return buildTrainingHistoryInfoResult(reportIntent.days);
    if (reportIntent.kind === "report") return buildReportInfoResult(query);
    if (isDailyInfoQuery(query)) return buildDailyInfoResult({ query, card, latestRpe, coachComments, activity });
    const personalInfo = await buildPersonalInfoResult(query);
    if (personalInfo) return personalInfo;
    const notificationInfo = await buildNotificationInfoResult(query);
    if (notificationInfo) return notificationInfo;
    const metricInfo = isExplicitDataViewQuery(query) || questionStyle ? await buildMetricInfoResult(query) : null;
    if (metricInfo) return metricInfo;
    if (!questionStyle && !isDailyInfoQuery(query)) return null;
    if (/\b(water|drink|hydrat|consume|consumed)\b/.test(lower) && !isWaterWriteCommand(query)) {
      return buildHydrationInfoResult();
    }
    if (/\b(coach|couch|message|messages|chat|feedback)\b/.test(lower) && /\b(any|tell|what|message|messages|feedback|from)\b/.test(lower)) {
      return buildCoachMessageInfoResult();
    }
    return buildDailyInfoResult({ query, card, latestRpe, coachComments, activity });
  }

  async function executeAskCommand(message: string) {
    const transcript = message.trim();
    if (!transcript) return;
    setAskInfoResult(null);
    if (askBusy) return;
    askLastReplyRef.current = null;
    setAskBusy(true);
    setError(null);
    setInfo(null);
    logAskTurn("user", transcript);
    try {
      if (isAskAcknowledgement(transcript)) {
        sayInfo("Okay.");
        return;
      }

      const hasActiveAskFlow = Boolean(
        askSessionWizardRef.current ||
          askPendingGeminiRef.current ||
          askPendingIntentRef.current ||
          askPendingCoachMessageRef.current
      );
      if (hasActiveAskFlow && isAskCancelCommand(transcript)) {
        askSessionWizardRef.current = null;
        askPendingGeminiRef.current = null;
        askPendingIntentRef.current = null;
        askPendingCoachMessageRef.current = false;
        sayInfo("Okay, cancelled.");
        return;
      }

      if (askPendingGeminiRef.current && isLikelyNewAskCommand(transcript)) {
        askPendingGeminiRef.current = null;
      }

      if (askPendingCoachMessageRef.current && !isLikelyNewAskCommand(transcript)) {
        const body = cleanCoachMessageBody(transcript);
        if (!body) {
          if (!askConversationActive && !askListening && !askSpeaking) setAskInputOpen(true);
          setSection("messages");
          sayInfo("What message would you like to send?");
          return;
        }
        askPendingCoachMessageRef.current = false;
        askPendingIntentRef.current = null;
        askPendingGeminiRef.current = null;
        await sendCoachMessageFromAsk(body);
        return;
      }

      if (askPendingIntentRef.current === "add_water") {
        const amountMl = parseWaterAmountMl(transcript);
        if (!amountMl || amountMl < 1 || amountMl > 4000) {
          if (!askConversationActive && !askListening && !askSpeaking) setAskInputOpen(true);
          setProgressTab("water");
          setSection("progress");
          sayInfo("Tell me the water amount, like: 250 ml.");
          return;
        }
        askPendingIntentRef.current = null;
        askPendingGeminiRef.current = null;
        setProgressTab("water");
        setSection("progress");
        await runAsk("/api/athlete/water", { date, amountMl }, `Logged ${amountMl} ml of water.`);
        return;
      }

      if (await handleAskSessionWizardAnswer(transcript)) {
        return;
      }

      if (await resolvePendingAskFollowUp(transcript)) {
        return;
      }

      if (isClearRestDayCommand(transcript)) {
        askPendingIntentRef.current = null;
        setAskInfoResult(null);
        setSection("log");
        await runAsk("/api/athlete/rest-day", { date, enabled: false }, "Rest day removed for today.");
        return;
      }

      if (isSetRestDayCommand(transcript)) {
        askPendingIntentRef.current = null;
        setAskInfoResult(null);
        setSection("log");
        await runAsk("/api/athlete/rest-day", { date, enabled: true }, "Today is set as a rest day.");
        return;
      }

      const leaveCoachMessage = extractLeaveCoachMessage(transcript);
      if (leaveCoachMessage) {
        askPendingIntentRef.current = null;
        askPendingCoachMessageRef.current = false;
        await sendCoachMessageFromAsk(leaveCoachMessage);
        return;
      }

      const askDate = parseAskDateCommand(transcript, date);
      if (askDate) {
        askPendingIntentRef.current = null;
        setAskInfoResult(null);
        setDate(askDate);
        sayInfo(`Opening ${askDate}.`);
        return;
      }

      const updateSessionSlot = parseCommandSlot(transcript);
      if (updateSessionSlot && isOpenEndedSessionUpdateCommand(transcript) && !parseTrainingCommand(transcript)) {
        startAskSessionWizard(updateSessionSlot);
        return;
      }

      const navigation = parseAthleteNavigationCommand(transcript);
      if (navigation) {
        askPendingIntentRef.current = null;
        askPendingGeminiRef.current = null;
        applyAskNavigation(navigation);
        sayInfo(athleteNavigationReply(navigation));
        return;
      }

      const sleepUpdate = parseSleepUpdateCommand(transcript);
      if (sleepUpdate) {
        askPendingIntentRef.current = null;
        askPendingGeminiRef.current = null;
        setAskInfoResult(null);
        if (sleepUpdate.kind === "missing_duration") {
          sayInfo("How many hours of sleep would you like to log?");
          return;
        }
        if (sleepUpdate.kind === "invalid_duration") {
          sayInfo("Sleep must be between 0 and 14 hours.");
          return;
        }
        setSection("today");
        await runAsk(
          "/api/athlete/wellness",
          {
            date,
            sleepHours: sleepUpdate.hours,
            sleepQuality: sleepQualityFromDurationHours(sleepUpdate.hours),
            mood: resolveWellnessField(undefined, wellness.mood),
            stress: resolveWellnessField(undefined, wellness.stress),
            soreness: resolveWellnessField(undefined, wellness.soreness),
            fatigue: resolveWellnessField(undefined, wellness.fatigue),
          },
          "Sleep is updated."
        );
        return;
      }

      if (isBareImproveQuery(transcript)) {
        sayInfo("What area or date range would you like me to analyse?");
        return;
      }

      const contextualSessionMetricCommand = parseTrainingCommand(transcript);
      if (
        contextualSessionMetricCommand &&
        !contextualSessionMetricCommand.slot &&
        section === "log" &&
        !/\bcheck.?in\b/i.test(transcript) &&
        !parseWellnessCommand(transcript) &&
        (
          contextualSessionMetricCommand.patch.muscleSoreness !== undefined ||
          contextualSessionMetricCommand.patch.fatigue !== undefined
        )
      ) {
        askPendingIntentRef.current = null;
        await saveTrainingCommandFromAsk({ ...contextualSessionMetricCommand, slot: currentLogSlot });
        return;
      }

      if (!shouldNavigateFromAsk(transcript) && !isAskWriteCommand(transcript)) {
        const askInfo = await buildAskInfoResult(transcript);
        if (askInfo) {
          askPendingIntentRef.current = null;
          setAskInputOpen(false);
          setAskInfoResult(askInfo);
          logAskTurn("agent", askInfo.summary, true);
          return;
        }
      }

      const wellnessCommand = parseWellnessCommand(transcript);
      if (wellnessCommand) {
        askPendingIntentRef.current = null;
        setSection("today");
        await runAsk(
          "/api/athlete/wellness",
          {
            date,
            sleepHours: wellnessCommand.sleepHours ?? (wellness.sleepHours ? Number(wellness.sleepHours) : undefined),
            sleepQuality: resolveWellnessField(wellnessCommand.sleepQuality, wellness.sleepQuality),
            mood: resolveWellnessField(wellnessCommand.mood, wellness.mood),
            stress: resolveWellnessField(wellnessCommand.stress, wellness.stress),
            soreness: resolveWellnessField(wellnessCommand.soreness, wellness.soreness),
            fatigue: resolveWellnessField(wellnessCommand.fatigue, wellness.fatigue),
          },
          wellnessUpdateMessage(wellnessCommand, /\bcheck.?in\b/i.test(transcript))
        );
        return;
      }

      const heartRateCommand = parseHeartRateCommand(transcript);
      if (heartRateCommand) {
        askPendingIntentRef.current = null;
        setSection("today");
        await runAsk(
          "/api/athlete/heart-rate",
          { date, [heartRateCommand.key]: heartRateCommand.value },
          `${heartRateCommand.key === "wakeHr" ? "Wake" : "Bed"} heart rate saved.`
        );
        return;
      }

      const coachMessage = extractCoachMessage(transcript);
      if (coachMessage) {
        askPendingIntentRef.current = null;
        askPendingCoachMessageRef.current = false;
        await sendCoachMessageFromAsk(coachMessage);
        return;
      }
      if (isCoachMessageIntent(transcript)) {
        askPendingCoachMessageRef.current = true;
        askPendingIntentRef.current = null;
        askPendingGeminiRef.current = null;
        setSection("messages");
        if (!askConversationActive && !askListening && !askSpeaking) setAskInputOpen(true);
        sayInfo("What message would you like to send?");
        return;
      }

      const noteBody = parseNoteCommand(transcript);
      if (noteBody) {
        askPendingIntentRef.current = null;
        await runAsk("/api/athlete/notes", { date, body: noteBody }, "Note saved.");
        return;
      }

      const trainingCommand = parseTrainingCommand(transcript);
      if (trainingCommand) {
        askPendingIntentRef.current = null;
        const openEndedSessionUpdate =
          Boolean(trainingCommand.slot) &&
          /\b(update|save|fill|complete)\b/i.test(transcript) &&
          /\b(section|session|training|workout)\b/i.test(transcript) &&
          Object.keys(trainingCommand.patch).length === 0;
        if (openEndedSessionUpdate && trainingCommand.slot) {
          startAskSessionWizard(trainingCommand.slot, trainingCommand.patch);
        } else {
          await saveTrainingCommandFromAsk(trainingCommand);
        }
        return;
      }

      const pressCommand = parsePressCommand(transcript);
      if (pressCommand) {
        askPendingIntentRef.current = null;
        if (pressCommand.id === "press:save-recovery") {
          setSection("log");
          await runAsk("/api/athlete/recovery", { date, modalities: recoveryModalities }, "Recovery saved.");
        } else if (pressCommand.id === "press:save-checkin") {
          setSection("today");
          const result = await submitWellness();
          logAskTurn("agent", result.message, result.ok);
        } else {
          const slot = pressCommand.id === "press:save-am" ? "AM" : pressCommand.id === "press:save-aft" ? "AFT" : pressCommand.id === "press:save-pm" ? "PM" : null;
          if (slot) openAskSessionSlot(slot);
          else setSection("log");
          await pressAskButton(pressCommand.id, pressCommand.label);
        }
        return;
      }

      if (isWaterWriteCommand(transcript)) {
        const amountMl = parseWaterAmountMl(transcript);
        if (!amountMl || amountMl < 1 || amountMl > 4000) {
          askPendingIntentRef.current = "add_water";
          if (!askConversationActive && !askListening && !askSpeaking) setAskInputOpen(true);
          setProgressTab("water");
          setSection("progress");
          sayInfo("Tell me the water amount, like: add 250 ml water.");
          return;
        }
        askPendingIntentRef.current = null;
        setProgressTab("water");
        setSection("progress");
        await runAsk("/api/athlete/water", { date, amountMl }, `Logged ${amountMl} ml of water.`);
        return;
      }

      const res = await apiFetch("/api/athlete/voice/interpret", {
        method: "POST",
        body: JSON.stringify({ transcript, pendingIntent: askPendingGeminiRef.current ?? undefined }),
      });
      if (!res.ok) throw new Error("interpret_failed");
      const result = (await res.json()) as VoiceInterpretResult;
      const fields = { ...(askPendingGeminiRef.current?.collected ?? {}), ...(result.fields ?? {}) };

      if (result.intent === "navigate") {
        askPendingIntentRef.current = null;
        askPendingGeminiRef.current = null;
        handleAskNavigate(typeof fields.target === "string" ? fields.target : "today");
        sayInfo(result.spokenResponse ?? "Opening.");
        return;
      }
      if (result.intent === "query_status") {
        askPendingIntentRef.current = null;
        askPendingGeminiRef.current = null;
        const infoResult = await buildAskInfoResult(transcript);
        if (infoResult) {
          setAskInfoResult(infoResult);
          logAskTurn("agent", infoResult.summary, true);
          return;
        }
        const topic = typeof fields.topic === "string" ? fields.topic.toLowerCase() : "";
        if (topic === "hydration" || topic === "water") {
          setProgressTab("water");
          setSection("progress");
          sayInfo("Opening water.");
        } else if (topic === "training_plan") {
          setSection("log");
          sayInfo("Opening today’s training log.");
        } else {
          const progressResult = await buildReportInfoResult(`${transcript} improvement`);
          setAskInfoResult(progressResult);
          logAskTurn("agent", progressResult.summary, true);
        }
        return;
      }
      if (result.intent === "unsupported") {
        askPendingIntentRef.current = null;
        askPendingGeminiRef.current = null;
        const infoResult = await buildAskInfoResult(transcript);
        if (infoResult) {
          setAskInfoResult(infoResult);
          logAskTurn("agent", infoResult.summary, true);
          return;
        }
        sayInfo("I couldn't match that request. Ask for a specific metric or task.");
        return;
      }
      if (result.missingFields?.length) {
        askPendingGeminiRef.current = { intent: result.intent, collected: fields, missingFields: result.missingFields };
        if (result.intent === "add_water") {
          askPendingIntentRef.current = "add_water";
          setProgressTab("water");
          setSection("progress");
        }
        if (!askConversationActive && !askListening && !askSpeaking) {
          setAskInputOpen(true);
        }
        sayInfo(result.followUpQuestion ?? "I need one more detail.");
        return;
      }

      if (result.intent === "add_water") {
        const amountMl = Math.round(Number(fields.amountMl ?? 0));
        if (!amountMl) throw new Error("missing_amount");
        askPendingIntentRef.current = null;
        askPendingGeminiRef.current = null;
        setProgressTab("water");
        setSection("progress");
        await runAsk("/api/athlete/water", { date, amountMl }, `Logged ${amountMl} ml of water.`);
        return;
      }
      if (result.intent === "fill_wellness") {
        askPendingGeminiRef.current = null;
        setSection("today");
        await runAsk(
          "/api/athlete/wellness",
          {
            date,
            sleepHours: typeof fields.sleepHours === "number" ? fields.sleepHours : wellness.sleepHours ? Number(wellness.sleepHours) : undefined,
            sleepQuality: resolveWellnessField(fields.sleepQuality, wellness.sleepQuality),
            mood: resolveWellnessField(fields.mood, wellness.mood),
            stress: resolveWellnessField(fields.stress, wellness.stress),
            soreness: resolveWellnessField(fields.soreness, wellness.soreness),
            fatigue: resolveWellnessField(fields.fatigue, wellness.fatigue),
          },
          "Check-in saved."
        );
        return;
      }
      if (result.intent === "fill_attendance") {
        const status = typeof fields.status === "string" ? fields.status : "";
        if (!["present", "absent", "late", "excused", "rest"].includes(status)) throw new Error("bad_attendance");
        askPendingGeminiRef.current = null;
        await runAsk("/api/athlete/attendance", { date, status }, `Attendance marked ${status}.`);
        return;
      }
      if (result.intent === "fill_training") {
        askPendingGeminiRef.current = null;
        const slot = SESSION_SLOTS.includes(fields.slot as SessionSlot) ? (fields.slot as SessionSlot) : "AM";
        openAskSessionSlot(slot);
        await runAsk(
          `/api/athlete/training/${slot}`,
          {
            date,
            status: typeof fields.status === "string" ? fields.status : undefined,
            attended: typeof fields.attended === "boolean" ? fields.attended : undefined,
            workoutType: typeof fields.workoutType === "string" ? fields.workoutType : undefined,
            sets: typeof fields.sets === "number" ? fields.sets : undefined,
            reps: typeof fields.reps === "string" ? fields.reps : undefined,
            actualDurationMin: typeof fields.actualDurationMin === "number" ? fields.actualDurationMin : undefined,
            effortRating: typeof fields.effortRating === "number" ? fields.effortRating : undefined,
            notes: typeof fields.notes === "string" ? fields.notes : undefined,
          },
          `${SLOT_LABEL[slot]} session saved.`
        );
        openAskSessionSlot(slot);
        return;
      }
      if (result.intent === "fill_rpe") {
        askPendingGeminiRef.current = null;
        const slot = SESSION_SLOTS.includes(fields.slot as SessionSlot) ? (fields.slot as SessionSlot) : currentLogSlot;
        const form = card ? makeSessionForms(card)[slot] : null;
        const rpeValue =
          typeof fields.effortRating === "number"
            ? fields.effortRating
            : typeof fields.rpe === "number"
              ? fields.rpe
              : undefined;
        openAskSessionSlot(slot);
        await runAsk(
          "/api/athlete/rpe-monitoring",
          {
            date,
            sessionType: slot,
            trainingCategory: normalizeTrainingCategory(
              typeof fields.trainingCategory === "string" ? fields.trainingCategory : (form?.trainingCategory ?? form?.workoutType)
            ),
            plannedIntensityPercent: typeof fields.plannedIntensityPercent === "number" ? fields.plannedIntensityPercent : form?.plannedIntensityPercent,
            rpe: rpeValue ?? form?.rpe,
            sleepQuality: resolveSessionWellnessField(fields.sleepQuality, form?.sleepQuality),
            muscleSoreness: resolveSessionWellnessField(fields.soreness, form?.soreness),
            fatigue: resolveSessionWellnessField(fields.fatigue, form?.fatigue),
            moodMotivation: resolveSessionWellnessField(fields.mood, form?.moodMotivation),
            ...(typeof fields.restingHeartRate === "number" ? { restingHeartRate: fields.restingHeartRate } : {}),
            ...(typeof fields.bodyConditionFeedback === "string" ? { bodyConditionFeedback: fields.bodyConditionFeedback } : {}),
          },
          sessionRpeUpdateMessage(slot, {
            rpe: rpeValue,
            plannedIntensityPercent: typeof fields.plannedIntensityPercent === "number" ? fields.plannedIntensityPercent : undefined,
            sleepQuality: typeof fields.sleepQuality === "number" ? fields.sleepQuality : undefined,
            muscleSoreness: typeof fields.soreness === "number" ? fields.soreness : undefined,
            fatigue: typeof fields.fatigue === "number" ? fields.fatigue : undefined,
            moodMotivation: typeof fields.mood === "number" ? fields.mood : undefined,
            restingHeartRate: typeof fields.restingHeartRate === "number" ? fields.restingHeartRate : undefined,
            bodyConditionFeedback: typeof fields.bodyConditionFeedback === "string" ? fields.bodyConditionFeedback : undefined,
          })
        );
        openAskSessionSlot(slot);
        return;
      }
      if (result.intent === "fill_heart_rate") {
        askPendingGeminiRef.current = null;
        setSection("today");
        const payload: Record<string, unknown> = { date };
        if (typeof fields.wakeHr === "number") payload.wakeHr = fields.wakeHr;
        if (typeof fields.bedHr === "number") payload.bedHr = fields.bedHr;
        await runAsk("/api/athlete/heart-rate", payload, "Heart rate saved.");
        return;
      }
      if (result.intent === "fill_recovery") {
        askPendingGeminiRef.current = null;
        const modalities = Array.isArray(fields.modalities) ? fields.modalities : [];
        setSection("log");
        await runAsk("/api/athlete/recovery", { date, modalities }, "Recovery saved.");
        return;
      }
      if (result.intent === "add_note") {
        askPendingGeminiRef.current = null;
        const body = typeof fields.body === "string" && fields.body.trim() ? fields.body.trim() : transcript;
        await runAsk("/api/athlete/notes", { date, body }, "Note saved.");
        return;
      }
      if (result.intent === "send_coach_message") {
        askPendingGeminiRef.current = null;
        const body = extractCoachMessage(transcript) ?? (typeof fields.body === "string" ? extractCoachMessage(fields.body) ?? cleanCoachMessageBody(fields.body) : null);
        if (!body) {
          askPendingCoachMessageRef.current = true;
          if (!askConversationActive && !askListening && !askSpeaking) setAskInputOpen(true);
          setSection("messages");
          sayInfo("What message would you like to send?");
          return;
        }
        askPendingCoachMessageRef.current = false;
        await sendCoachMessageFromAsk(body);
        return;
      }
    } catch {
      sayError("Ask agent could not process that command.");
    } finally {
      setAskBusy(false);
    }
  }

  function isLikelyNewAskCommand(command: string) {
    const transcript = command.trim();
    const lower = transcript.toLowerCase().replace(/^(?:and\s+)?(?:also\s+)?(?:please\s+)?(?:can|could|would)\s+you\s+/, "");
    return shouldNavigateFromAsk(lower) ||
      isPersonalInfoQuery(transcript) ||
      isNotificationInfoQuery(transcript) ||
      isReportLikeQuery(transcript) ||
      isDailyInfoQuery(transcript) ||
      isWaterWriteCommand(transcript) ||
      /\b(open|show|go to|change|update|set|log|add|tell|ask|message|note|what|which|how|status|summary)\b/i.test(transcript);
  }

  async function executeAskConversationCommand(message: string) {
    const transcript = message.trim();
    if (!transcript) return;
    setAskInfoResult(null);
    askLastReplyRef.current = null;
    askPendingConfirmationRef.current = null;
    await executeAskCommand(transcript);
  }

  function stopAskConversation() {
    askConversationRef.current?.stop();
    askConversationRef.current = null;
    askVoiceActiveRef.current = false;
    setAskConversationActive(false);
    setAskConversationMode(null);
    setAskListening(false);
    setAskSpeaking(false);
    askPendingConfirmationRef.current = null;
    askSessionWizardRef.current = null;
    askPendingCoachMessageRef.current = false;
    askFallbackShownRef.current = false;
  }

  function startAskVoice(mode: "voice" | "execute") {
    askFallbackShownRef.current = false;
    setAskInputOpen(false);
    setAskConversationMode(mode);
    askConversationRef.current = startVoiceConversation({
      onActiveChange: (value) => {
        setAskConversationActive(value);
        if (!value) {
          askConversationRef.current = null;
          askVoiceActiveRef.current = false;
          setAskConversationMode(null);
        }
      },
      onListeningChange: (value) => {
        setAskListening(value);
      },
      onSpeakingChange: setAskSpeaking,
      onVolume: (level) => {
        askGlow.value = withTiming(level, { duration: 80 });
      },
      onResult: async (text) => {
        await executeAskConversationCommand(text);
        if (mode === "execute" && !askPendingConfirmationRef.current) {
          setTimeout(stopAskConversation, 50);
          return undefined;
        }
        return askLastReplyRef.current ?? undefined;
      },
      onError: () => {
        sayError("I could not hear that command.");
      },
      onTimeout: () => undefined,
      onNeedsFallback: () => {
        if (askFallbackShownRef.current) return;
        askFallbackShownRef.current = true;
        askVoiceActiveRef.current = false;
        setAskInputOpen(true);
        const message =
          Platform.OS === "web"
            ? "Voice commands aren't available here. Type the command instead."
            : "Microphone permission is needed for voice commands. Type the command instead.";
        sayInfo(message);
        void speakAgentReply(message);
      },
      speakReplies: mode === "voice",
    });
  }

  function openAskInput() {
    setAskInputOpen(true);
  }

  function beginAskHold() {
    askLongPressRef.current = false;
    if (askHoldTimerRef.current) clearTimeout(askHoldTimerRef.current);
    askHoldTimerRef.current = setTimeout(() => {
      askLongPressRef.current = true;
      stopAskConversation();
      openAskInput();
    }, 3000);
  }

  function endAskHold() {
    if (askHoldTimerRef.current) clearTimeout(askHoldTimerRef.current);
    askHoldTimerRef.current = null;
  }

  function triggerAskTextInput() {
    askLongPressRef.current = true;
    if (askHoldTimerRef.current) clearTimeout(askHoldTimerRef.current);
    askHoldTimerRef.current = null;
    stopAskConversation();
    openAskInput();
  }

  function pressAskAgent() {
    if (askConversationActive || askConversationRef.current?.isActive()) {
      stopAskConversation();
      return;
    }
    if (askBusy) return;
    if (askLongPressRef.current) {
      askLongPressRef.current = false;
      return;
    }
    askVoiceActiveRef.current = true;
    startAskVoice("voice");
  }

  function pressAskExecute() {
    if (askBusy) return;
    stopAskConversation();
    askVoiceActiveRef.current = true;
    setTimeout(() => startAskVoice("execute"), 80);
  }

  // Dismisses the visual surfaces (input row, result sheet, conversation log)
  // only — it must NOT stop an in-progress voice conversation. Closing the
  // result sheet (or tapping outside it) is how the athlete clears a report
  // card while continuing to talk to the agent; ending the mic session is a
  // separate, explicit action (the FAB toggle in pressAskAgent).
  function closeAskAgentSurfaces() {
    setAskInputOpen(false);
    setAskInfoResult(null);
    setAskLogVisible(false);
  }

  function submitAskInput() {
    const text = askDraft.trim();
    if (!text || askSubmitLockRef.current) return;
    askSubmitLockRef.current = true;
    setAskDraft("");
    setAskInputOpen(false);
    void executeAskConversationCommand(text).then(() => speakAgentReply(askLastReplyRef.current ?? "")).finally(() => {
      askSubmitLockRef.current = false;
    });
  }

  const askExecuteActive = askConversationMode === "execute";
  const askStatusText = askExecuteActive
    ? askBusy ? "Executing" : null
    : askSpeaking ? "Speaking" : askBusy ? "Working" : askListening ? "Listening" : askConversationActive ? "Tap to stop" : null;
  const showAskAgentFloatingButton = !isMessages && !askInputOpen;

  return (
    <View style={{ flex: 1 }}>
    <BlurTargetView ref={blurTargetRef} style={{ flex: 1 }}>
    <AppFrame
      role="athlete"
      title={isMessages ? messageHeader.title : "My day"}
      subtitle={isMessages ? messageHeader.subtitle : undefined}
      nav={nav}
      activeKey={section}
      onNavigate={(key) => setSection(key as Section)}
      renderHeader={
        isMessages
          ? undefined
          : ({ unread, openNotifications }) => (
              <SpotlightTarget id="mobile-athlete-header" style={headerHighlight}>
              <AthleteHomeHeader
                card={card}
                date={date}
                unread={unread}
                onDateChange={setDate}
                onNotifications={openNotifications}
                calendarOpenSignal={calendarOpenSignal}
              />
            </SpotlightTarget>
            )
      }
    >
      {isMessages ? (
        <SpotlightTarget id="mobile-athlete-chat" style={[{ flex: 1 }, chatHighlight]}>
          <AthleteMessagesPanel initialCoachId={requestedCoachId} onHeaderChange={setMessageHeader} />
        </SpotlightTarget>
      ) : (
        <View style={styles.pageShell}>
        <LinearGradient
          pointerEvents="none"
          colors={["#fbfaf6", "#fffefd", "#fbfaf6"]}
          locations={[0, 0.48, 1]}
          style={StyleSheet.absoluteFill}
        />
        <ScrollView
          ref={tourScrollRef}
          key={section}
          style={styles.mainScroll}
          bounces={section !== "today"}
          alwaysBounceVertical={section !== "today"}
          overScrollMode={section === "today" ? "never" : "auto"}
          contentContainerStyle={[styles.content, section === "log" ? styles.logContent : null]}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={theme.accent} />}
        >
          {error ? <Notice tone="bad" text={error} /> : null}
          {info ? <Notice tone="ok" text={info} /> : null}
          {loading && !card ? (
            <ActivityIndicator color={theme.accentStrong} style={{ marginTop: 40 }} />
          ) : null}

          {!loading && section === "today" && card ? (
            <TodaySection
              card={card}
              readiness={readiness}
              latestRpe={latestRpe}
              water={water}
              weekLoad={weekLoad}
              coachCommentCount={coachComments.length}
              onGoLog={() => setSection("log")}
              onOpenSlot={(slot) => {
                setLogFocusSlot(slot);
                setSection("log");
              }}
              onGoWater={() => {
                setSection("progress");
                setProgressTab("water");
              }}
              onQuickCheckIn={() => setQuickCheckInOpen(true)}
              readinessHighlight={readinessHighlight}
              trainingHighlight={trainingHighlight}
            />
          ) : null}

          {!loading && section === "progress" ? (
            <SpotlightTarget id="mobile-athlete-progress" style={progressHighlight}>
            <ProgressSection
              date={date}
              tab={progressTab}
              onTabChange={setProgressTab}
              achievements={achievements}
              loading={loading}
              onCheckIn={() => setSection("log")}
              onOpenLog={() => setSection("log")}
              onOpenReward={setRewardGoal}
            />
            </SpotlightTarget>
          ) : null}

          {!loading && section === "log" && card ? (
            <SpotlightTarget id="mobile-athlete-log" style={logHighlight}>
            <SessionLogSection
              card={card}
              wellness={wellness}
              setWellness={setWellness}
              recoveryModalities={recoveryModalities}
              toggleRecovery={toggleRecovery}
              submitWellness={submitWellness}
              postJson={postJson}
              date={date}
              focusedSlot={logFocusSlot}
              onActiveSlotChange={setCurrentLogSlot}
              registerAskAction={registerAskAction}
            />
            </SpotlightTarget>
          ) : null}

          {!loading && section === "coach" ? (
            <SpotlightTarget id="mobile-athlete-coach" style={coachHighlight}>
            <CoachSection
              announcements={announcements}
              coachComments={coachComments}
              coachCount={coachCount}
              activity={activity}
            />
            </SpotlightTarget>
          ) : null}
        </ScrollView>
        </View>
      )}
    </AppFrame>
    </BlurTargetView>
      {rewardGoal ? (
        <RewardOverlay goal={rewardGoal} onClose={() => setRewardGoal(null)} blurTarget={blurTargetRef} />
      ) : null}
      <QuickCheckInModal
        open={quickCheckInOpen}
        onClose={() => setQuickCheckInOpen(false)}
        wellness={wellness}
        setWellness={setWellness}
        hrForm={hrForm}
        setHrForm={setHrForm}
        onSave={async () => {
          await submitWellness();
          await submitHeartRate();
          setQuickCheckInOpen(false);
        }}
      />
      <AskAgentDismissLayer
        visible={askConversationActive || askInputOpen || Boolean(askInfoResult) || askLogVisible}
        onPress={closeAskAgentSurfaces}
      />
      {!isMessages ? (
        <AskAgentConversationLog visible={askLogVisible} entries={askLog} onClose={() => setAskLogVisible(false)} />
      ) : null}
      {showAskAgentFloatingButton ? (
        <>
          <AskAgentStatusPill text={askStatusText} />
          <AskAgentFloatingButton
            listening={askListening}
            active={askConversationActive}
            execute={askExecuteActive}
            speaking={askSpeaking}
            busy={askBusy}
            glow={askGlow}
            onPress={pressAskAgent}
            onExecutePress={pressAskExecute}
            onPressIn={beginAskHold}
            onPressOut={endAskHold}
            onLongPress={triggerAskTextInput}
            highlightStyle={agentHighlight}
          />
        </>
      ) : null}
      <AskAgentInputOverlay
        open={askInputOpen}
        value={askDraft}
        busy={askBusy}
        onChange={setAskDraft}
        onSubmit={submitAskInput}
        onClose={closeAskAgentSurfaces}
      />
      <AskAgentInfoSheet result={askInfoResult} onClose={closeAskAgentSurfaces} onRowPress={handleAskInfoRowPress} />
    </View>
  );
}

function AthleteHomeHeader({
  card,
  date,
  unread,
  onDateChange,
  onNotifications,
  calendarOpenSignal,
}: {
  card: DailyCard | null;
  date: string;
  unread: number;
  onDateChange: (value: string) => void;
  onNotifications: () => void;
  calendarOpenSignal: number;
}) {
  const athleteName = firstNameOf(card?.name);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);
  const nativeCompact = Platform.OS !== "web";

  return (
    <View style={[styles.todayHeader, nativeCompact ? styles.todayHeaderNative : null]}>
      <View style={styles.todayHeaderTop}>
        <ProfileMenu theme={theme} size={nativeCompact ? 42 : 54} textSize={nativeCompact ? 15 : 19} style={styles.todayAvatar} />
        <View style={styles.todayGreeting}>
          <Text style={[styles.todayRole, { color: theme.accentStrong }]}>Athlete</Text>
          <Text style={[styles.todayGreetingLine, nativeCompact ? styles.todayGreetingLineNative : null]}>{indiaGreeting(now)}</Text>
          <Text style={[styles.todayGreetingName, nativeCompact ? styles.todayGreetingNameNative : null]} numberOfLines={1}>{athleteName}</Text>
        </View>
        <View style={styles.todayHeaderActions}>
          <HeaderIconButton icon="notifications-outline" onPress={onNotifications} badge={unread} />
          <DatePickerPill value={date} onChange={onDateChange} iconOnly openSignal={calendarOpenSignal} />
        </View>
      </View>
    </View>
  );
}

function AskWave({ color = colors.ink }: { color?: string }) {
  return (
    <View style={styles.askWave}>
      {[0, 1, 2, 3].map((index) => (
        <Animated.View
          key={index}
          style={[
            styles.askWaveBar,
            {
              backgroundColor: color,
              height: index % 2 === 0 ? 9 : 15,
              opacity: 0.85,
            },
          ]}
        />
      ))}
    </View>
  );
}

const askAgentWebPressProps =
  Platform.OS === "web"
    ? ({
        onContextMenu: (event: { preventDefault?: () => void }) => event.preventDefault?.(),
      } as any)
    : {};

/** Small running transcript above the Ask Agent FAB — what was said, and what the agent did or why it failed. */
function AskAgentDismissLayer({ visible, onPress }: { visible: boolean; onPress: () => void }) {
  if (!visible) return null;
  return <Pressable accessibilityRole="button" accessibilityLabel="Dismiss Ask agent" style={styles.askDismissLayer} onPress={onPress} />;
}

function AskAgentConversationLog({
  visible,
  entries,
  onClose,
}: {
  visible: boolean;
  entries: AskLogEntry[];
  onClose: () => void;
}) {
  if (!visible || entries.length === 0) return null;
  return (
    <View style={styles.askLogWrap} pointerEvents="box-none">
      <View style={styles.askLogCard}>
        <View style={styles.askLogHeader}>
          <Text style={styles.askLogTitle}>Ask Agent</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Hide conversation">
            <Ionicons name="close" size={14} color={colors.inkFaint} />
          </Pressable>
        </View>
        <ScrollView style={styles.askLogScroll} contentContainerStyle={{ gap: 6 }} showsVerticalScrollIndicator>
          {entries.map((entry) => (
            <View
              key={entry.id}
              style={[
                styles.askLogBubble,
                entry.role === "user" ? styles.askLogBubbleUser : styles.askLogBubbleAgent,
                entry.role === "agent" && entry.ok === false ? styles.askLogBubbleError : null,
              ]}
            >
              <Text
                style={[
                  styles.askLogText,
                  entry.role === "user" ? styles.askLogTextUser : null,
                  entry.role === "agent" && entry.ok === false ? styles.askLogTextError : null,
                ]}
              >
                {entry.text}
              </Text>
            </View>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

function AskAgentFloatingButton({
  active,
  execute,
  listening,
  speaking,
  busy,
  glow,
  onPress,
  onExecutePress,
  onPressIn,
  onPressOut,
  onLongPress,
  highlightStyle,
}: {
  active: boolean;
  execute: boolean;
  listening: boolean;
  speaking: boolean;
  busy: boolean;
  /** Real mic input level (0..1, see lib/voiceSession) driving the glow while listening. */
  glow: SharedValue<number>;
  onPress: () => void;
  onExecutePress: () => void;
  onPressIn: () => void;
  onPressOut: () => void;
  onLongPress: () => void;
  /** Guided-tour highlight to apply to this button when it's the active step (see useTourHighlight). */
  highlightStyle?: TourHighlightStyle;
}) {
  // Already absolutely positioned, so measure this ref directly rather than
  // adding a wrapping SpotlightTarget View that would disturb its own layout.
  const { ref: spotlightRef, onLayout: spotlightOnLayout } = useSpotlightRef("mobile-athlete-agent");
  const glowStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + glow.value * 0.7 }],
    opacity: glow.value * 0.55,
  }));
  const stateColor = theme.accentStrong;
  const showExecute = active;
  const executeStyle = useAnimatedStyle(() => {
    return {
      opacity: withTiming(showExecute ? 1 : 0, { duration: 220 }),
      transform: [
        { translateY: withTiming(showExecute ? 0 : 18, { duration: 220 }) },
        { scale: withTiming(showExecute ? 1 : 0.86, { duration: 220 }) },
      ],
    };
  });
  return (
    <>
      <Animated.View pointerEvents={showExecute ? "auto" : "none"} style={[styles.askExecuteFabWrap, executeStyle]}>
        <Pressable
          onPress={onExecutePress}
          disabled={busy}
          style={({ pressed }) => [styles.askExecuteFab, execute ? styles.askExecuteFabActive : null, pressed ? { transform: [{ scale: 0.96 }] } : null]}
          accessibilityRole="button"
          accessibilityLabel="Execute command"
        >
          <Ionicons name="flash-outline" size={20} color="#ffffff" />
        </Pressable>
      </Animated.View>
      {active || listening || speaking ? <Animated.View pointerEvents="none" style={[styles.askFabGlow, { backgroundColor: stateColor }, glowStyle]} /> : null}
      <Pressable
        ref={spotlightRef}
        onLayout={spotlightOnLayout}
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        onLongPress={onLongPress}
        delayLongPress={3000}
        disabled={busy && !active}
        {...askAgentWebPressProps}
        style={({ pressed }) => [
          styles.askFab,
          active || listening || speaking ? styles.askFabActive : null,
          pressed ? { transform: [{ scale: 0.98 }] } : null,
          highlightStyle ? [highlightStyle, { borderRadius: 28 }] : null,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Ask agent"
        accessibilityState={{ selected: active || listening || speaking }}
      >
        {listening && !execute ? <AskWave color={stateColor} /> : <Ionicons name={speaking ? "volume-high-outline" : active ? "stop-outline" : "sparkles-outline"} size={22} color={active || speaking ? stateColor : "#1a0c00"} />}
      </Pressable>
    </>
  );
}

function AskAgentStatusPill({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <View pointerEvents="none" style={styles.askStatusPill}>
      <Text style={styles.askStatusText}>{text}</Text>
    </View>
  );
}

function AskAgentInputOverlay({
  open,
  value,
  busy,
  onChange,
  onSubmit,
  onClose,
}: {
  open: boolean;
  value: string;
  busy: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <View style={styles.askInputOverlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={styles.askInputRow}>
        <TextInput
          autoFocus
          value={value}
          onChangeText={onChange}
          editable={!busy}
          placeholder="Ask agent"
          placeholderTextColor={colors.inkFaint}
          style={styles.askInput}
          returnKeyType="send"
          blurOnSubmit
          onSubmitEditing={onSubmit}
          onBlur={onSubmit}
          onKeyPress={(event) => {
            if (event.nativeEvent.key === "Enter") onSubmit();
          }}
        />
      </View>
    </View>
  );
}

function AskAgentInfoSheet({
  result,
  onClose,
  onRowPress,
}: {
  result: AskInfoResult | null;
  onClose: () => void;
  onRowPress: (row: AskInfoRow) => void;
}) {
  if (!result) return null;
  return (
    <View style={styles.askInfoOverlay} pointerEvents="box-none">
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={styles.askInfoSheet}>
        <View style={styles.askInfoHandle} />
        <View style={styles.askInfoHeader}>
          <View style={styles.askInfoTitleBlock}>
            <Text style={styles.askInfoTitle}>{result.title}</Text>
            <Text style={styles.askInfoSubtitle}>{result.subtitle}</Text>
          </View>
          <Pressable onPress={onClose} style={styles.askInfoClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close result">
            <Ionicons name="close" size={18} color={colors.inkMuted} />
          </Pressable>
        </View>
        <View style={styles.askInfoSummary}>
          <Ionicons name="sparkles-outline" size={15} color={theme.accentStrong} />
          <Text style={styles.askInfoSummaryText}>{result.summary}</Text>
        </View>
        {result.sections?.length ? (
          <ScrollView style={styles.askInfoReportScroll} contentContainerStyle={styles.askInfoReportBody} showsVerticalScrollIndicator>
            {result.sections.map((section, index) => (
              <View key={section.heading} style={index > 0 ? styles.askInfoSectionSpacing : undefined}>
                <Text style={styles.askInfoSectionHeading}>{section.heading}</Text>
                <Text style={styles.askInfoReportText}>{section.text}</Text>
              </View>
            ))}
          </ScrollView>
        ) : result.body ? (
          <ScrollView style={styles.askInfoReportScroll} contentContainerStyle={styles.askInfoReportBody} showsVerticalScrollIndicator>
            <Text style={styles.askInfoReportText}>{result.body}</Text>
          </ScrollView>
        ) : (
          <>
            <View style={styles.askInfoTableHead}>
              <Text style={[styles.askInfoHeadText, { flex: 1.2 }]}>Item</Text>
              <Text style={[styles.askInfoHeadText, styles.askInfoStatusHead]}>Status</Text>
            </View>
            <ScrollView style={styles.askInfoScroll} contentContainerStyle={styles.askInfoRows} showsVerticalScrollIndicator>
              {result.rows.map((row) => {
                const toneColor = askInfoToneColor(row.tone);
                return (
                  <Pressable
                    key={row.id}
                    onPress={() => onRowPress(row)}
                    disabled={!row.action}
                    style={({ pressed }) => [styles.askInfoRow, row.action ? styles.askInfoRowAction : null, pressed ? { opacity: 0.82 } : null]}
                    accessibilityRole={row.action ? "button" : undefined}
                    accessibilityLabel={row.action ? `Open ${row.label}` : undefined}
                  >
                    <View style={[styles.askInfoIconBox, { backgroundColor: `${toneColor}16`, borderColor: `${toneColor}44` }]}>
                      <Ionicons name={row.icon} size={16} color={toneColor} />
                    </View>
                    <View style={styles.askInfoMainCell}>
                      <Text style={styles.askInfoLabel} numberOfLines={1}>{row.label}</Text>
                      <Text style={styles.askInfoDetail} numberOfLines={2}>{row.detail}</Text>
                    </View>
                    <View style={[styles.askInfoStatusPill, { borderColor: `${toneColor}44`, backgroundColor: `${toneColor}12` }]}>
                      <Text style={[styles.askInfoStatusText, { color: toneColor }]} numberOfLines={1}>{row.status}</Text>
                    </View>
                    {row.action ? <Ionicons name="chevron-forward" size={15} color={colors.inkFaint} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </>
        )}
      </View>
    </View>
  );
}

function HeaderIconButton({
  icon,
  onPress,
  badge,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  badge?: number;
}) {
  const nativeCompact = Platform.OS !== "web";
  return (
    <Pressable onPress={onPress} hitSlop={8} style={({ pressed }) => [styles.todayHeaderButton, nativeCompact ? styles.todayHeaderButtonNative : null, pressed ? { opacity: 0.82 } : null]}>
      <Ionicons name={icon} size={nativeCompact ? 20 : 24} color={colors.ink} />
      {badge ? (
        <View style={styles.todayHeaderBadge}>
          <Text style={styles.todayHeaderBadgeText}>{badge > 9 ? "9+" : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function ProgressSection({
  date,
  tab,
  onTabChange,
  achievements,
  loading,
  onCheckIn,
  onOpenLog,
  onOpenReward,
}: {
  date: string;
  tab: ProgressTab;
  onTabChange: (tab: ProgressTab) => void;
  achievements: AchievementsResponse | null;
  loading: boolean;
  onCheckIn: () => void;
  onOpenLog: () => void;
  onOpenReward: (goal: AchievementGoal) => void;
}) {
  return (
    <View style={styles.stack}>
      <View style={styles.progressTabs}>
        {[
          { key: "goals", label: "Goals", icon: "trophy-outline" },
          { key: "water", label: "Water", icon: "water-outline" },
          { key: "trends", label: "Trends", icon: "analytics-outline" },
        ].map((item) => {
          const on = tab === item.key;
          return (
            <Pressable
              key={item.key}
              onPress={() => onTabChange(item.key as ProgressTab)}
              style={[styles.progressTab, on ? styles.progressTabOn : null]}
            >
              <Ionicons name={item.icon as keyof typeof Ionicons.glyphMap} size={11} color={on ? "#fff" : colors.inkMuted} />
              <Text style={[styles.progressTabText, on ? styles.progressTabTextOn : null]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {tab === "goals" ? (
        <AchievementsPanel
          data={achievements}
          loading={loading}
          onCheckIn={onCheckIn}
          onOpenHydration={() => onTabChange("water")}
          onOpenLog={onOpenLog}
          onOpenReward={onOpenReward}
        />
      ) : null}
      {tab === "trends" ? <TrendsSection /> : null}
      {tab === "water" ? <HydrationCard date={date} /> : null}
    </View>
  );
}

function achievementIconName(key: AchievementGoalKey): keyof typeof Ionicons.glyphMap {
  if (key === "check_in") return "flash-outline";
  if (key === "training") return "barbell-outline";
  if (key === "hydration") return "water-outline";
  return "trophy-outline";
}

function achievementActionLabel(key: AchievementGoalKey): string {
  if (key === "check_in") return "Check in";
  if (key === "hydration") return "Water";
  return "Open log";
}

function dayCount(count: number) {
  return `${count} day${count === 1 ? "" : "s"}`;
}

// Design-3 palette: each goal type gets its own accent used consistently
// across its icon badge, day-history cells, and action buttons.
const GOAL_TONE: Record<AchievementGoalKey, { accent: string; soft: string }> = {
  check_in: { accent: "#ff7e1a", soft: "#fff3df" },
  training: { accent: colors.ok, soft: "#e6f6ec" },
  hydration: { accent: "#2563eb", soft: "#e8f0fe" },
  all_rounder: { accent: "#7c3aed", soft: "#f1e9fd" },
};

// Each goal's filled day-cell shows its OWN icon (not a uniform checkmark) —
// same glyph as its card icon (see achievementIconName), so a filled day
// reads as "a lightning bolt / flame / water drop / star", not a generic tick.
const GOAL_CELL_ICON: Record<AchievementGoalKey, keyof typeof Ionicons.glyphMap> = {
  check_in: "flash",
  training: "flame",
  hydration: "water",
  all_rounder: "star",
};

/** Round day-history cell used in the goal streak rows. */
function DayCell({
  size = 26,
  filled,
  color,
  children,
}: {
  size?: number;
  filled: boolean;
  color: string;
  children?: React.ReactNode;
}) {
  return (
    <View
      style={{
        height: size,
        width: size,
        borderRadius: size / 2,
        borderWidth: filled ? 0 : 1,
        borderColor: colors.line,
        backgroundColor: filled ? color : colors.surfaceInset,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
    </View>
  );
}

/** Compact donut ring for the Goal Streaks hero — same SVG-arc technique as HydrationGoalRing, smaller. */
function GoalRing({ pct }: { pct: number }) {
  const size = 92;
  const stroke = 10;
  const ringRadius = (size - stroke) / 2;
  const circ = 2 * Math.PI * ringRadius;
  const offset = circ * (1 - Math.max(0, Math.min(100, pct)) / 100);
  return (
    <View style={{ height: size, width: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={ringRadius} stroke={colors.surfaceInset} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={ringRadius}
          stroke="#ff7e1a"
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <Text style={styles.goalRingPct}>{pct}%</Text>
      <Text style={styles.goalRingLabel}>Complete</Text>
    </View>
  );
}

function AchievementsPanel({
  data,
  loading,
  onCheckIn,
  onOpenHydration,
  onOpenLog,
  onOpenReward,
}: {
  data: AchievementsResponse | null;
  loading: boolean;
  onCheckIn: () => void;
  onOpenHydration: () => void;
  onOpenLog: () => void;
  onOpenReward: (goal: AchievementGoal) => void;
}) {

  if (loading && !data) {
    return (
      <View style={styles.stack}>
        <Card style={styles.achievementsHero}>
          <View style={styles.skeletonLineShort} />
          <View style={styles.skeletonLine} />
          <View style={styles.skeletonBar} />
        </Card>
        <View style={styles.achievementSkeleton} />
        <View style={styles.achievementSkeleton} />
      </View>
    );
  }

  if (!data) {
    return (
      <Card style={styles.achievementsUnavailable}>
        <Ionicons name="trophy-outline" size={22} color={colors.inkFaint} />
        <Text style={styles.achievementTitle}>Achievements unavailable</Text>
        <Text style={styles.achievementDescription}>Try again after your next check-in or training log.</Text>
      </Card>
    );
  }

  const totalGoals = data.goals.length;
  const unlockedPct = totalGoals ? Math.round((data.summary.unlocked / totalGoals) * 100) : 0;
  const best = data.summary.bestStreak;
  const next = data.summary.nextGoal;
  const summaryText = `${data.summary.unlocked} of ${totalGoals} goals unlocked${
    next ? ` - ${next.remaining} ${next.remaining === 1 ? "day" : "days"} to ${next.title}` : ""
  }`;

  return (
    <View style={styles.stack}>
      <Card style={styles.achievementsHero}>
        <View style={styles.achievementHeroRow}>
          <GoalRing pct={unlockedPct} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.achievementHeroTitle}>Goal streaks</Text>
            <Text style={styles.achievementHeroSub} numberOfLines={2}>{summaryText}</Text>
            <View style={styles.achievementHeroChips}>
              <View style={styles.achievementHeroChip}>
                <View style={[styles.achievementHeroChipIcon, { backgroundColor: GOAL_TONE.check_in.soft }]}>
                  <Ionicons name="flame" size={13} color={GOAL_TONE.check_in.accent} />
                </View>
                <View style={{ minWidth: 0 }}>
                  <Text style={styles.achievementHeroChipValue} numberOfLines={1}>{best ? dayCount(best.days) : "0 days"}</Text>
                  <Text style={styles.achievementHeroChipLabel} numberOfLines={1}>Best streak</Text>
                </View>
              </View>
              <View style={styles.achievementHeroChip}>
                <View style={[styles.achievementHeroChipIcon, { backgroundColor: GOAL_TONE.training.soft }]}>
                  <Ionicons name="calendar" size={13} color={GOAL_TONE.training.accent} />
                </View>
                <View style={{ minWidth: 0 }}>
                  <Text style={styles.achievementHeroChipValue} numberOfLines={1}>{data.days} days</Text>
                  <Text style={styles.achievementHeroChipLabel} numberOfLines={1}>Window</Text>
                </View>
              </View>
            </View>
          </View>
        </View>
      </Card>

      {data.goals.map((goal) => (
        <AchievementGoalCard
          key={goal.key}
          goal={goal}
          onAction={goal.key === "check_in" ? onCheckIn : goal.key === "hydration" ? onOpenHydration : onOpenLog}
          onOpenReward={() => onOpenReward(goal)}
        />
      ))}
    </View>
  );
}

function AchievementGoalCard({
  goal,
  onAction,
  onOpenReward,
}: {
  goal: AchievementGoal;
  onAction: () => void;
  onOpenReward: () => void;
}) {
  const remaining = Math.max(0, goal.target - goal.currentStreak);
  const recent = goal.history.slice(-7);
  const tone = GOAL_TONE[goal.key];
  const primaryTextColor = goal.key === "check_in" ? "#1a0c00" : "#fff";

  return (
    <Card style={styles.achievementCard}>
      <View style={styles.achievementCardTop}>
        <View style={[styles.achievementIcon, { backgroundColor: tone.soft }]}>
          <Ionicons name={achievementIconName(goal.key)} size={14} color={tone.accent} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.achievementTitleRow}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.achievementTitle} numberOfLines={1}>{goal.title}</Text>
              <Text style={styles.achievementDescription} numberOfLines={1}>{goal.description}</Text>
            </View>
            <View
              style={[
                styles.achievementBadge,
                { backgroundColor: goal.achieved ? styles.achievementBadgeUnlocked.backgroundColor : `${tone.accent}1f` },
              ]}
            >
              <Text
                style={[
                  styles.achievementBadgeText,
                  { color: goal.achieved ? styles.achievementBadgeTextUnlocked.color : tone.accent },
                ]}
              >
                {goal.achieved ? "Unlocked" : `${remaining} left`}
              </Text>
            </View>
          </View>

          <View style={styles.achievementMetrics}>
            <View style={styles.achievementMetric}>
              <Text style={styles.achievementMetricLabel}>{goal.metricLabel}</Text>
              <Text style={styles.achievementMetricValue}>{goal.currentStreak}</Text>
            </View>
            <View style={styles.achievementMetric}>
              <Text style={styles.achievementMetricLabel}>Count</Text>
              <Text style={styles.achievementMetricValue}>{goal.completedDays}</Text>
            </View>
            <View style={[styles.achievementMetric, { alignItems: "flex-end" }]}>
              <Text style={styles.achievementMetricLabel}>Longest</Text>
              <Text style={styles.achievementMetricLongest}>{dayCount(goal.longestStreak)}</Text>
            </View>
          </View>

          <View style={styles.achievementHistory} accessibilityLabel={`${goal.title} recent history`}>
            {recent.map((day) => {
              const weekday = new Date(`${day.date}T00:00:00`).toLocaleDateString("en-US", { weekday: "narrow" });
              return (
                <View key={day.date} style={styles.achievementHistoryCol}>
                  <DayCell size={26} filled={day.met} color={tone.accent}>
                    {day.met ? <Ionicons name={GOAL_CELL_ICON[goal.key]} size={12} color="#fff" /> : null}
                  </DayCell>
                  <Text style={styles.achievementHistoryDay}>{weekday}</Text>
                </View>
              );
            })}
          </View>

          <View style={styles.achievementActions}>
            <Pressable
              onPress={onAction}
              style={[styles.achievementActionSecondary, { borderColor: `${tone.accent}55`, backgroundColor: tone.soft }]}
            >
              <Text style={[styles.achievementActionSecondaryText, { color: tone.accent }]}>{achievementActionLabel(goal.key)}</Text>
            </Pressable>
            <Pressable
              onPress={onOpenReward}
              disabled={!goal.reward.unlocked}
              style={[
                styles.achievementActionPrimary,
                { backgroundColor: tone.accent },
                !goal.reward.unlocked ? styles.achievementActionDisabled : null,
              ]}
            >
              <Text
                style={[
                  styles.achievementActionPrimaryText,
                  { color: primaryTextColor },
                  !goal.reward.unlocked ? styles.achievementActionDisabledText : null,
                ]}
              >
                {goal.reward.unlocked ? "Open reward" : "Reward locked"}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Card>
  );
}

function RewardOverlay({
  goal,
  onClose,
  blurTarget,
}: {
  goal: AchievementGoal;
  onClose: () => void;
  blurTarget: React.RefObject<View | null>;
}) {
  // Not a Modal, so wire the hardware back button to dismiss it.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  return (
    // Rendered at the screen root (NOT a Modal). BlurView blurs the wrapped
    // BlurTargetView (the app) via blurTarget — the SDK 56 API.
    <View style={styles.rewardOverlay}>
      <BlurView blurTarget={blurTarget} blurMethod="dimezisBlurView" intensity={28} tint="light" style={StyleSheet.absoluteFill} />
      <Pressable style={styles.rewardBackdrop} onPress={onClose}>
        <Pressable style={styles.rewardSheet} onPress={(event) => event.stopPropagation()}>
          <View style={styles.rewardHeader}>
            <View style={styles.achievementHeroIcon}>
              <Ionicons name="trophy-outline" size={18} color={theme.accentStrong} />
            </View>
            <Pressable onPress={onClose} style={styles.rewardClose}>
              <Ionicons name="close" size={18} color={colors.inkMuted} />
            </Pressable>
          </View>
          <Text style={styles.achievementEyebrow}>Reward unlocked</Text>
          <Text style={styles.rewardTitle}>{goal.reward.title}</Text>
          <Text style={styles.rewardDescription}>{goal.reward.description}</Text>
          <View style={styles.rewardBadge}>
            <Text style={styles.rewardBadgeText}>{goal.reward.badgeLabel}</Text>
            <Text style={styles.rewardBadgeNumber}>{goal.currentStreak}</Text>
            <Text style={styles.rewardBadgeSub}>{goal.title}</Text>
          </View>
          <Pressable onPress={onClose} style={styles.rewardDoneBtn}>
            <Text style={styles.rewardDoneText}>Done</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </View>
  );
}

/**
 * Quick check-in — captures Sleep hours + Sleep quality plus the twice-daily
 * resting heart rate. Everything else (RPE, soreness, fatigue, mood) stays in
 * the full per-session Log form instead — mirrors the web app's popup.
 */
function QuickCheckInModal({
  open,
  onClose,
  wellness,
  setWellness,
  hrForm,
  setHrForm,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  wellness: WellnessForm;
  setWellness: (updater: (prev: WellnessForm) => WellnessForm) => void;
  hrForm: { wakeHr: string; bedHr: string };
  setHrForm: (updater: (prev: { wakeHr: string; bedHr: string }) => { wakeHr: string; bedHr: string }) => void;
  onSave: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.quickCheckInBackdrop} onPress={onClose}>
        <Pressable style={styles.quickCheckInSheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.quickCheckInHandle} />
          <View style={styles.quickCheckInHeader}>
            <Text style={styles.quickCheckInTitle}>Quick check-in</Text>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} style={styles.quickCheckInClose}>
              <Ionicons name="close" size={18} color={colors.inkMuted} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.quickCheckInBody}>
            <Text style={styles.inputLabel}>Sleep hours</Text>
            <TextField
              value={wellness.sleepHours}
              onChangeText={(v) => setWellness((s) => ({ ...s, sleepHours: v }))}
              placeholder="e.g. 8"
              keyboardType="decimal-pad"
              style={styles.compactField}
            />
            <View style={{ height: 12 }} />
            <CompactScale
              label="Sleep quality"
              value={wellnessTenFromStored(Number(wellness.sleepQuality))}
              onChange={(v) => setWellness((s) => ({ ...s, sleepQuality: String(wellnessStoredFromTen(v)) }))}
              lowHint="Poor"
              highHint="Great"
              min={1}
              max={10}
            />
            <View style={{ height: 16 }} />
            <Text style={styles.inputLabel}>Waking HR</Text>
            <TextField
              value={hrForm.wakeHr}
              onChangeText={(v) => setHrForm((s) => ({ ...s, wakeHr: v }))}
              placeholder="bpm"
              keyboardType="number-pad"
              style={styles.compactField}
            />
            <View style={{ height: 12 }} />
            <Text style={styles.inputLabel}>Before-bed HR</Text>
            <TextField
              value={hrForm.bedHr}
              onChangeText={(v) => setHrForm((s) => ({ ...s, bedHr: v }))}
              placeholder="bpm"
              keyboardType="number-pad"
              style={styles.compactField}
            />
            <View style={{ height: 16 }} />
            <CompactButton label="Save check-in" onPress={handleSave} disabled={saving} successLabel="Saved" />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Notice({ tone, text }: { tone: "ok" | "bad"; text: string }) {
  const color = tone === "ok" ? colors.ok : colors.bad;
  return (
    <View style={[styles.notice, { borderColor: `${color}55`, backgroundColor: `${color}14` }]}>
      <Text style={[styles.noticeText, { color }]}>{text}</Text>
    </View>
  );
}

function TodaySection({
  card,
  readiness,
  latestRpe,
  water,
  weekLoad,
  coachCommentCount,
  onGoLog,
  onOpenSlot,
  onGoWater,
  onQuickCheckIn,
  readinessHighlight,
  trainingHighlight,
}: {
  card: DailyCard;
  readiness: number | null;
  latestRpe?: RpeEntry;
  water: WaterDay | null;
  weekLoad: { label: string; value: number | null }[];
  coachCommentCount: number;
  onGoLog: () => void;
  onOpenSlot: (slot: SessionSlot) => void;
  onGoWater: () => void;
  onQuickCheckIn: () => void;
  readinessHighlight?: TourHighlightStyle;
  trainingHighlight?: TourHighlightStyle;
}) {
  const { width } = useWindowDimensions();
  const guidance = readinessGuidance(readiness);
  const band = bandFor(readiness);
  const hasCheckIn = readiness !== null;
  const heroButtonStyle = hasCheckIn ? styles.heroButtonSecondary : styles.heroButtonPrimary;
  const heroButtonTextStyle = hasCheckIn ? styles.heroButtonSecondaryText : styles.heroButtonPrimaryText;
  const heroButtonIcon = hasCheckIn ? theme.accentStrong : "#ffffff";
  const heroHeadline = hasCheckIn ? guidance.word : "No check-in yet";
  const statusLabel = hasCheckIn ? guidance.word : "Check-in needed";
  const waterPct = water && water.goalMl ? Math.max(0, Math.min(1, water.totalMl / water.goalMl)) : null;
  const rpeLoadEntries = SESSION_SLOTS.map((slot) => card.rpeEntries?.[slot]).filter((entry): entry is RpeEntry => Boolean(entry));
  const todayLoad = rpeLoadEntries.reduce((sum, entry) => sum + (entry.calculatedTrainingLoad || 0), 0);
  const compactHero = width < 520;
  const metricColumns = 4;
  const nativeCompact = Platform.OS !== "web";
  const loadCardsSplit = width >= 760 && !nativeCompact;
  const metricBasis = Math.max(0, (width - 32 - (metricColumns - 1) * 10) / metricColumns);
  const loadAttentionCardStyle = loadCardsSplit ? styles.loadAttentionCol : styles.loadAttentionColStacked;
  const denseMetrics = true;

  const attentionItems: { id: string; icon: keyof typeof Ionicons.glyphMap; tint: string; title: string; sub: string; onPress: () => void }[] = [];
  if (card.injury.active) {
    attentionItems.push({
      id: "injury",
      icon: "warning-outline",
      tint: colors.warn,
      title: card.injury.bodyPart ?? "Injury reported",
      sub: card.injury.restriction ?? "Report in recovery",
      onPress: onGoLog,
    });
  }
  if (readiness !== null && readiness < 60) {
    attentionItems.push({
      id: "readiness",
      icon: "pulse-outline",
      tint: colors.bad,
      title: "Low readiness",
      sub: `${readiness}/100 - recovery first`,
      onPress: onGoLog,
    });
  }
  const sleepQuality = card.sleep.quality === null ? null : Number(wellnessFiveToTen(card.sleep.quality));
  if ((card.sleep.hours !== null && card.sleep.hours < 6.5) || (sleepQuality !== null && sleepQuality < 6)) {
    attentionItems.push({
      id: "sleep",
      icon: "moon-outline",
      tint: "#4d5fc7",
      title: "Poor sleep",
      sub: card.sleep.hours === null ? `Quality ${sleepQuality}/10` : `${card.sleep.hours} h logged`,
      onPress: onGoLog,
    });
  }
  const flaggedRpe = rpeLoadEntries.find((entry) => entry.riskFlag === "red")
    ?? rpeLoadEntries.find((entry) => entry.riskFlag === "amber")
    ?? rpeLoadEntries.find((entry) => entry.rpe >= 8 || (entry.riskReasons?.length ?? 0) > 0);
  if (flaggedRpe) {
    attentionItems.push({
      id: `rpe-${flaggedRpe.sessionType}`,
      icon: "trending-up-outline",
      tint: flaggedRpe.riskFlag === "red" ? colors.bad : colors.warn,
      title: flaggedRpe.rpe >= 8 ? "Elevated RPE" : "Training load caution",
      sub: flaggedRpe.riskReasons?.[0] ?? `RPE ${flaggedRpe.rpe} - ${flaggedRpe.calculatedTrainingLoad} AU`,
      onPress: () => onOpenSlot(flaggedRpe.sessionType),
    });
  }
  if (water && water.goalMl && water.totalMl < water.goalMl) {
    attentionItems.push({
      id: "hydration",
      icon: "water-outline",
      tint: "#2f7fe0",
      title: "Hydration below goal",
      sub: `${litres(water.totalMl)} L / ${litres(water.goalMl)} L`,
      onPress: onGoWater,
    });
  }
  if (card.recovery.score === null) {
    attentionItems.push({
      id: "recovery",
      icon: "heart-outline",
      tint: "#7c5cd6",
      title: "Recovery not logged",
      sub: "Add recovery details",
      onPress: onGoLog,
    });
  }
  if (coachCommentCount > 0) {
    attentionItems.push({
      id: "coach",
      icon: "chatbubble-ellipses-outline",
      tint: "#7c5cd6",
      title: "Coach feedback",
      sub: `${coachCommentCount} update${coachCommentCount === 1 ? "" : "s"} today`,
      onPress: onGoLog,
    });
  }

  const loadBand = latestRpe?.riskFlag ?? "green";
  const loadValue = todayLoad > 0 ? loadBandWord(loadBand) : "--";
  const loadSub = todayLoad > 0 ? `${todayLoad} AU` : "No RPE today";
  const loadStatusText = todayLoad > 0 ? `${loadBandWord(loadBand)} load logged today` : "No session logged today";
  const loadStatusDotColor = todayLoad > 0 ? bandColor(loadBand) : "#cfcfcf";

  return (
    <View style={[styles.todayStack, nativeCompact ? styles.todayStackNative : null]}>
      {card.injury.active ? (
        <View style={styles.warnStrip}>
          <Ionicons name="shield-outline" size={14} color={colors.warn} />
          <Text style={styles.warnText}>
            {card.injury.bodyPart}
            {card.injury.restriction ? ` - ${card.injury.restriction}` : ""}
          </Text>
        </View>
      ) : null}

      <SpotlightTarget id="mobile-athlete-readiness" style={readinessHighlight}>
        <LinearGradient
          colors={["#fffaf1", "#fffefa", "#fff6e9"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.heroCard, nativeCompact ? styles.heroCardNative : null]}
        >
          <View style={[styles.heroRingCol, nativeCompact ? styles.heroRingColNative : null]}>
            <ReadinessDial score={readiness} color={hasCheckIn ? bandColor(band) : colors.inkFaint} status={statusLabel} compact={nativeCompact} />
          </View>
          <View style={[styles.heroCopy, compactHero ? styles.heroCopyCompact : null]}>
            <Text style={[styles.heroHeadline, nativeCompact ? styles.heroHeadlineNative : null, { color: hasCheckIn ? bandColor(band) : "#d45b00" }]} numberOfLines={2}>
              {heroHeadline}
            </Text>
            <Text style={[styles.heroText, nativeCompact ? styles.heroTextNative : null]}>{guidance.line}</Text>
            <Pressable onPress={onQuickCheckIn} style={[styles.heroButton, nativeCompact ? styles.heroButtonNative : null, heroButtonStyle]}>
              <Ionicons name="add" size={nativeCompact ? 16 : 18} color={heroButtonIcon} />
              <Text style={[styles.heroButtonText, nativeCompact ? styles.heroButtonTextNative : null, heroButtonTextStyle]}>{readiness === null ? "Quick check-in" : "Update check-in"}</Text>
            </Pressable>
          </View>
          <RunnerIllustration
            style={compactHero ? styles.heroIllustrationCompact : styles.heroIllustration}
            compact={compactHero}
          />
        </LinearGradient>
      </SpotlightTarget>

      <View style={styles.statGrid}>
        <StatTile
          label="Sleep"
          value={displayDash(card.sleep.hours)}
          unit={card.sleep.hours === null ? undefined : "h"}
          sub={card.sleep.quality === null ? "--" : sleepQualityWord(Number(wellnessFiveToTen(card.sleep.quality)))}
          icon="moon-outline"
          tint="#4d5fc7"
          subTint={card.sleep.quality === null ? undefined : "#7250d8"}
          onPress={onGoLog}
          basis={metricBasis}
          dense={denseMetrics}
          nativeCompact={nativeCompact}
        />
        <StatTile
          label="Recovery"
          value={displayDash(card.recovery.score)}
          unit={card.recovery.score === null ? undefined : "%"}
          sub={card.recovery.status ?? "--"}
          icon="heart-outline"
          tint={colors.ok}
          subTint={card.recovery.score === null && !card.recovery.status ? undefined : colors.ok}
          onPress={onGoLog}
          basis={metricBasis}
          dense={denseMetrics}
          nativeCompact={nativeCompact}
        />
        <StatTile
          label="Hydration"
          value={water ? litres(water.totalMl) : "--"}
          unit={water ? `L / ${litres(water.goalMl)} L` : undefined}
          sub={waterPct === null ? "--" : `${Math.round(waterPct * 100)}% of goal`}
          icon="water-outline"
          tint="#2f7fe0"
          onPress={onGoWater}
          progress={waterPct}
          progressColor="#2f7fe0"
          basis={metricBasis}
          dense={denseMetrics}
          nativeCompact={nativeCompact}
        />
        <StatTile
          label="Load"
          value={loadValue}
          sub={loadSub}
          icon="bar-chart-outline"
          tint="#ff7e1a"
          subTint={todayLoad > 0 ? "#f26a0a" : undefined}
          onPress={onGoLog}
          basis={metricBasis}
          dense={denseMetrics}
          nativeCompact={nativeCompact}
        />
      </View>

      <SpotlightTarget id="mobile-athlete-training" style={trainingHighlight}>
        <Card style={[styles.sessionsCard, nativeCompact ? styles.sessionsCardNative : null]}>
        <View style={[styles.cardTitleRow, nativeCompact ? styles.cardTitleRowNative : null, nativeCompact ? styles.sessionsHeaderNative : null]}>
            <CardTitle style={nativeCompact ? styles.sessionsTitleNative : undefined}>Today&apos;s sessions</CardTitle>
          <Pressable onPress={onGoLog} hitSlop={8}>
            <Text style={[styles.viewFullPlanLink, nativeCompact ? styles.sessionsViewFullPlanLinkNative : null]}>View full plan →</Text>
          </Pressable>
        </View>
        <View style={[styles.trainingSummaryList, nativeCompact ? styles.trainingSummaryListNative : null]}>
          {SESSION_SLOTS.map((slot, index) => (
            <TrainingSummaryRow
              key={slot}
              slot={slot}
              session={card.sessions[slot]}
              rpe={card.rpeEntries?.[slot] ?? null}
              isRestDay={Boolean(card.isRestDay)}
              isNextUp={SESSION_SLOTS.slice(0, index).every((s) => {
                const status = sessionStatusMeta(card.sessions[s], card.rpeEntries?.[s] ?? null, Boolean(card.isRestDay), false).text;
                return status === "Completed" || status === "Skipped" || status === "Rest";
              })}
              onPress={() => onOpenSlot(slot)}
              compact={nativeCompact}
            />
          ))}
        </View>
        </Card>
      </SpotlightTarget>

      <View style={[styles.loadAttentionRow, loadCardsSplit ? null : styles.loadAttentionRowStacked]}>
        <Card
          style={[
            loadAttentionCardStyle,
            styles.trainingLoadReferenceCard,
            nativeCompact ? styles.trainingLoadReferenceCardNative : null,
          ]}
        >
          <View style={styles.trainingLoadReferenceHeader}>
            <View style={styles.trainingLoadReferenceTitleRow}>
              <View style={[styles.trainingLoadReferenceAccent, nativeCompact ? styles.trainingLoadReferenceAccentNative : null]} />
              <CardTitle style={[styles.trainingLoadReferenceTitle, nativeCompact ? styles.trainingLoadReferenceTitleNative : undefined]}>
                Training load
              </CardTitle>
            </View>
            <View style={[styles.trainingLoadReferenceIcon, nativeCompact ? styles.trainingLoadReferenceIconNative : null]}>
              <Ionicons name="flame-outline" size={nativeCompact ? 16 : 22} color={colors.inkMuted} />
            </View>
          </View>

          <View style={[styles.trainingLoadReferenceMetricRow, nativeCompact ? styles.trainingLoadReferenceMetricRowNative : null]}>
            <Text style={[styles.trainingLoadReferenceValue, nativeCompact ? styles.trainingLoadReferenceValueNative : null]}>{todayLoad}</Text>
            <Text style={[styles.trainingLoadReferenceUnit, nativeCompact ? styles.trainingLoadReferenceUnitNative : null]}>AU</Text>
          </View>
          <Text style={[styles.trainingLoadReferenceSub, nativeCompact ? styles.trainingLoadReferenceSubNative : null]}>Today&apos;s Load</Text>
          <View style={[styles.trainingLoadReferencePill, nativeCompact ? styles.trainingLoadReferencePillNative : null]}>
            <View
              style={[
                styles.trainingLoadReferencePillDot,
                nativeCompact ? styles.trainingLoadReferencePillDotNative : null,
                { backgroundColor: loadStatusDotColor },
              ]}
            />
            <Text
              style={[styles.trainingLoadReferencePillText, nativeCompact ? styles.trainingLoadReferencePillTextNative : null]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.78}
            >
              {loadStatusText}
            </Text>
          </View>

          <View style={[styles.trainingLoadReferenceDivider, nativeCompact ? styles.trainingLoadReferenceDividerNative : null]} />
          <WeekLoadBars data={todayLoad > 0 ? weekLoad : []} compact={nativeCompact} referenceCard />
          <Pressable
            onPress={onGoLog}
            style={[styles.trainingLoadReferenceButton, nativeCompact ? styles.trainingLoadReferenceButtonNative : null]}
            accessibilityRole="button"
          >
            <Text style={[styles.trainingLoadReferenceButtonText, nativeCompact ? styles.trainingLoadReferenceButtonTextNative : null]}>
              {todayLoad > 0 ? "Edit in Log" : "Log session"}
            </Text>
            <Ionicons name="chevron-forward" size={nativeCompact ? 18 : 24} color="#ffffff" style={styles.trainingLoadReferenceButtonIcon} />
          </Pressable>
        </Card>

        <Card style={[loadAttentionCardStyle, nativeCompact ? styles.loadAttentionCardNative : null]}>
          <View style={[styles.cardTitleRow, nativeCompact ? styles.cardTitleRowNative : null]}>
            <Text
              style={[styles.attentionTitle, nativeCompact ? styles.attentionTitleNative : null]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
            >
              Needs attention
            </Text>
          </View>
          {attentionItems.length > 0 ? (
            <>
          <View style={[styles.attentionList, nativeCompact ? styles.attentionListNative : null]}>
            {attentionItems.map((item) => (
              <Pressable key={item.id} onPress={item.onPress} style={[styles.attentionRow, nativeCompact ? styles.attentionRowNative : null]}>
                <View style={[styles.attentionIcon, nativeCompact ? styles.attentionIconNative : null, { backgroundColor: `${item.tint}1a` }]}>
                  <Ionicons name={item.icon} size={nativeCompact ? 14 : 16} color={item.tint} />
                </View>
                <View style={styles.attentionCopy}>
                  <Text style={[styles.attentionItemTitle, nativeCompact ? styles.attentionItemTitleNative : null]} numberOfLines={2}>{item.title}</Text>
                  <Text style={[styles.attentionItemSub, nativeCompact ? styles.attentionItemSubNative : null]} numberOfLines={1}>{item.sub}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.inkFaint} />
              </Pressable>
            ))}
          </View>
          <Pressable onPress={onGoLog} hitSlop={8} style={nativeCompact ? styles.attentionViewAllWrapNative : styles.attentionViewAllWrap}>
            <Text style={[styles.attentionViewAll, nativeCompact ? styles.attentionViewAllNative : null]}>View all →</Text>
          </Pressable>
            </>
          ) : (
            <View style={styles.attentionEmpty}>
              <Ionicons name="checkmark-circle-outline" size={20} color={colors.ok} />
              <Text style={styles.attentionItemTitle}>No current concerns</Text>
              <Text style={styles.attentionItemSub}>Keep logging today as usual.</Text>
            </View>
          )}
        </Card>
      </View>

      <BandLegend compact={nativeCompact} />
    </View>
  );
}

function ReadinessDial({ score, color, status, compact }: { score: number | null; color: string; status: string; compact?: boolean }) {
  const size = compact ? 78 : 112;
  const stroke = compact ? 7 : 9;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = score == null ? 0 : Math.max(0, Math.min(1, score / 100));
  const showProgress = pct > 0;

  return (
    <View style={styles.readinessDial}>
      <Text style={[styles.heroRingLabel, compact ? styles.heroRingLabelCompact : null]}>Readiness</Text>
      <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke="#edf1e9" strokeWidth={stroke} fill="none" />
          {showProgress ? (
            <Circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              stroke={color}
              strokeWidth={stroke}
              fill="none"
              strokeDasharray={circ}
              strokeDashoffset={circ * (1 - pct)}
              strokeLinecap="round"
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          ) : null}
        </Svg>
        <View style={styles.readinessScoreRow}>
          <Text style={[styles.readinessScore, compact ? styles.readinessScoreCompact : null, { color }]}>{score ?? "--"}</Text>
          <Text style={[styles.readinessMax, compact ? styles.readinessMaxCompact : null]}>/100</Text>
        </View>
      </View>
      <View style={[styles.heroStatusPill, compact ? styles.heroStatusPillCompact : null, { backgroundColor: `${color}1a` }]}>
        <View style={[styles.heroStatusDot, { backgroundColor: color }]} />
        <Text style={[styles.heroStatusText, compact ? styles.heroStatusTextCompact : null, { color }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
          {status}
        </Text>
      </View>
    </View>
  );
}

const BAND_LEGEND_ROWS: { color: string; label: string }[] = [
  { color: colors.ok, label: "Good" },
  { color: colors.warn, label: "Moderate" },
  { color: colors.bad, label: "High" },
  { color: "#7c5cd6", label: "Needs attention" },
];

function BandLegend({ compact }: { compact?: boolean }) {
  return (
    <Card style={[styles.bandLegendCard, compact ? styles.bandLegendCardCompact : null]}>
      <View style={[styles.bandLegendHeader, compact ? styles.bandLegendHeaderCompact : null]}>
        <CardTitle style={compact ? styles.bandLegendTitleCompact : undefined}>What the colours mean</CardTitle>
        <View style={[styles.legendLearnPill, compact ? styles.legendLearnPillCompact : null]}>
          <Ionicons name="book-outline" size={compact ? 11 : 14} color={colors.inkMuted} />
          <Text style={[styles.legendLearnText, compact ? styles.legendLearnTextCompact : null]}>Learn more</Text>
        </View>
      </View>
      <View style={[styles.bandLegendInline, compact ? styles.bandLegendInlineCompact : null]}>
        {BAND_LEGEND_ROWS.map((row) => (
          <View key={row.label} style={styles.bandLegendInlineItem}>
            <View style={[styles.bandLegendDot, compact ? styles.bandLegendDotCompact : null, { backgroundColor: row.color }]} />
            <Text style={[styles.bandLegendInlineText, compact ? styles.bandLegendInlineTextCompact : null]}>{row.label}</Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

/** Last 7 days of training load as a tiny bar chart — mirrors WEEKDAY_LETTER order. */
function WeekLoadBars({
  data,
  compact,
  referenceCard,
}: {
  data: { label: string; value: number | null }[];
  compact?: boolean;
  referenceCard?: boolean;
}) {
  if (referenceCard) {
    const labels = ["M", "T", "W", "T", "F", "S", "S"];
    const chartData = data.length > 0 ? data : labels.map((label) => ({ label, value: null }));
    const ticks = [600, 400, 200, 0];
    const hasHistory = chartData.some((d) => (d.value ?? 0) > 0);
    const left = compact ? 25 : 38;
    const right = compact ? 322 : 316;
    const top = compact ? 7 : 14;
    const bottom = compact ? 57 : 104;
    const viewBoxHeight = compact ? 76 : 132;
    const labelBaseline = compact ? 72 : 127;
    const tickFontSize = compact ? "7" : "11";
    const labelFontSize = compact ? "8" : "12";
    const scaleMax = 600;
    const chartHeight = bottom - top;
    return (
      <View style={[styles.weekLoadReferenceChart, compact ? styles.weekLoadReferenceChartNative : null]}>
        <Svg width="100%" height="100%" viewBox={`0 0 330 ${viewBoxHeight}`}>
          {ticks.map((tick) => {
            const y = top + ((scaleMax - tick) / scaleMax) * chartHeight;
            const isZero = tick === 0;
            return (
              <Fragment key={`reference-tick-${tick}`}>
                <SvgText x={0} y={y + 4} fill={colors.inkMuted} fontSize={tickFontSize} fontWeight="700">
                  {tick}
                </SvgText>
                <Line
                  x1={left}
                  x2={right}
                  y1={y}
                  y2={y}
                  stroke={isZero ? "rgba(31,35,32,0.18)" : "rgba(31,35,32,0.11)"}
                  strokeWidth={isZero ? 1 : 0.9}
                  strokeDasharray={isZero ? undefined : "4 5"}
                />
              </Fragment>
            );
          })}
          {hasHistory
            ? chartData.slice(0, labels.length).map((day, index) => {
                const x = left + (index * (right - left)) / (labels.length - 1);
                const raw = Math.max(0, Math.min(scaleMax, day.value ?? 0));
                const barHeight = raw > 0 ? Math.max(4, (raw / scaleMax) * chartHeight) : 0;
                return (
                  <Rect
                    key={`reference-load-${day.label}-${index}`}
                    x={x - 4.5}
                    y={bottom - barHeight}
                    width={9}
                    height={barHeight}
                    rx={4.5}
                    fill="#ff6b10"
                  />
                );
              })
            : null}
          {labels.map((label, index) => {
            const x = left + (index * (right - left)) / (labels.length - 1);
            return (
              <SvgText
                key={`reference-label-${label}-${index}`}
                x={x}
                y={labelBaseline}
                fill={colors.inkMuted}
                fontSize={labelFontSize}
                fontWeight="700"
                textAnchor="middle"
              >
                {label}
              </SvgText>
            );
          })}
        </Svg>
        {!hasHistory ? (
          <View pointerEvents="none" style={[styles.weekLoadReferenceEmpty, compact ? styles.weekLoadReferenceEmptyNative : null]}>
            <View style={[styles.weekLoadReferenceEmptyIcon, compact ? styles.weekLoadReferenceEmptyIconNative : null]}>
              <Ionicons name="trending-up-outline" size={compact ? 15 : 26} color="#9a9a9a" />
            </View>
            <Text style={[styles.weekLoadReferenceEmptyText, compact ? styles.weekLoadReferenceEmptyTextNative : null]}>No data this week</Text>
          </View>
        ) : null}
      </View>
    );
  }
  if (data.length === 0) return null;
  if (compact) {
    const labels = ["M", "T", "W", "T", "F", "S", "S"];
    const ticks = [600, 400, 200, 0];
    const left = 26;
    const right = 184;
    const top = 7;
    const step = 12;
    return (
      <View style={styles.weekGridCompact}>
        <Svg width="100%" height="100%" viewBox="0 0 198 62">
          {ticks.map((tick, index) => {
            const y = top + index * step;
            return (
              <Fragment key={`tick-${tick}`}>
                <SvgText x={2} y={y + 4} fill={colors.inkFaint} fontSize="8.5" fontWeight="700">
                  {tick}
                </SvgText>
                <Line x1={left} x2={right} y1={y} y2={y} stroke={colors.lineStrong} strokeWidth={0.8} strokeDasharray="3 3" />
              </Fragment>
            );
          })}
          {labels.map((label, index) => {
            const x = left + (index * (right - left)) / (labels.length - 1);
            return (
              <SvgText key={`${label}-${index}`} x={x} y={59} fill={colors.inkFaint} fontSize="8.5" fontWeight="800" textAnchor="middle">
                {label}
              </SvgText>
            );
          })}
        </Svg>
      </View>
    );
  }
  const hasHistory = data.some((d) => (d.value ?? 0) > 0);
  if (!hasHistory) {
    return <Text style={[styles.weekBarsEmpty, compact ? styles.weekBarsEmptyCompact : null]}>No weekly load history yet.</Text>;
  }
  const max = Math.max(1, ...data.map((d) => d.value ?? 0));
  const axisTicks = [max, max * 0.67, max * 0.33, 0].map((tick) => Math.round(tick));
  return (
    <View style={[styles.weekBars, compact ? styles.weekBarsCompact : null]}>
      <View style={styles.weekBarsAxis}>
        {axisTicks.map((tick, index) => (
          <Text key={`${tick}-${index}`} style={styles.weekBarsAxisLabel}>{tick}</Text>
        ))}
      </View>
      <View style={styles.weekBarsColumns}>
        {data.map((day, index) => {
          const pct = day.value == null ? 0 : Math.max(0.03, Math.min(1, day.value / max));
          return (
            <View key={`${day.label}-${index}`} style={styles.weekBarCol}>
              <View style={styles.weekBarTrack}>
                <View style={[styles.weekBarFill, { height: `${pct * 100}%` }]} />
              </View>
              <Text style={styles.weekBarLabel}>{day.label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function RunnerIllustration({ style, compact }: { style?: object; compact?: boolean }) {
  return (
    <View style={[styles.heroIllustrationFrame, compact ? styles.heroIllustrationFrameCompact : null, style]}>
      <Image source={HERO_RUNNER} style={styles.heroRunnerImage} resizeMode="contain" />
      <LinearGradient
        pointerEvents="none"
        colors={["#fffaf1", "rgba(255,250,241,0.82)", "rgba(255,250,241,0)"]}
        locations={[0, 0.42, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.heroIllustrationFade}
      />
    </View>
  );
}

function StatTile({
  label,
  value,
  unit,
  sub,
  icon,
  tint,
  subTint,
  onPress,
  progress,
  progressColor,
  basis,
  dense,
  nativeCompact,
}: {
  label: string;
  value: string;
  unit?: string;
  sub: string;
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  subTint?: string;
  onPress?: () => void;
  progress?: number | null;
  progressColor?: string;
  basis: number;
  dense?: boolean;
  nativeCompact?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      android_ripple={onPress ? { color: "rgba(0,0,0,0.06)" } : undefined}
      style={({ pressed }) => [
        styles.statTile,
        dense ? styles.statTileDense : null,
        nativeCompact && dense ? styles.statTileNativeDense : null,
        { flexBasis: basis },
        onPress && pressed ? { opacity: 0.7 } : null,
      ]}
    >
      <View style={[styles.tileLabelRow, dense ? styles.tileLabelRowDense : null]}>
        <View style={[styles.tileIcon, dense ? styles.tileIconDense : null, nativeCompact && dense ? styles.tileIconNativeDense : null, { backgroundColor: `${tint}13` }]}>
          <Ionicons name={icon} size={nativeCompact && dense ? 13 : dense ? 15 : 17} color={tint} />
        </View>
        <Text
          style={[styles.tileLabel, dense ? styles.tileLabelDense : null, { color: tint }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.68}
        >
          {label}
        </Text>
      </View>
      <Text style={[styles.tileValue, dense ? styles.tileValueDense : null, nativeCompact && dense ? styles.tileValueNativeDense : null]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.66}>
        {value}
        {unit ? <Text style={styles.tileUnit}> {unit}</Text> : null}
      </Text>
      <Text style={[styles.tileSub, dense ? styles.tileSubDense : null, nativeCompact && dense ? styles.tileSubNativeDense : null, subTint ? { color: subTint } : null]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.68}>{sub}</Text>
      {progress != null ? (
        <View style={[styles.tileProgressTrack, nativeCompact && dense ? styles.tileProgressTrackNativeDense : null]}>
          <View style={[styles.tileProgressFill, { width: `${Math.round(progress * 100)}%`, backgroundColor: progressColor ?? colors.ok }]} />
        </View>
      ) : null}
    </Pressable>
  );
}

function SlotPill({
  slot,
  session,
  rpe,
  isRestDay,
  onPress,
}: {
  slot: SessionSlot;
  session: DailySession;
  rpe?: RpeEntry | null;
  isRestDay: boolean;
  onPress: () => void;
}) {
  const status = isRestDay ? "rest" : session.status;
  const done = Boolean(rpe || sessionComplete(session));
  const title = isRestDay ? "Rest day" : session.workoutType ?? session.type ?? rpe?.trainingCategory ?? "Open";
  const sub = isRestDay ? "Recovery available" : rpe ? `Done - RPE ${rpe.rpe}` : status ? status.replace("_", " ") : "Open";
  return (
    <Pressable onPress={onPress} style={[styles.slotPill, done ? styles.slotPillDone : null]} accessibilityRole="button">
      <Text style={styles.tileLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
        {SLOT_LABEL[slot]}
      </Text>
      <Text style={styles.slotType} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82}>
        {title}
      </Text>
      <Text style={styles.tileSub}>{sub}</Text>
    </Pressable>
  );
}

function sessionStatusMeta(
  session: DailySession,
  rpe: RpeEntry | null | undefined,
  isRestDay: boolean,
  isNextUp: boolean
) {
  if (isRestDay || session.status === "rest") {
    return { text: "Rest", tone: colors.inkMuted, bg: colors.surfaceInset, icon: "moon-outline" as const };
  }
  if (session.status === "skipped") {
    return { text: "Skipped", tone: colors.bad, bg: `${colors.bad}14`, icon: "close-circle-outline" as const };
  }
  if (session.status === "in_progress") {
    return { text: "Partial", tone: colors.warn, bg: `${colors.warn}18`, icon: "ellipse-outline" as const };
  }
  if (rpe || session.status === "completed" || session.attended === true) {
    return { text: "Completed", tone: colors.ok, bg: `${colors.ok}1a`, icon: "checkmark-circle" as const };
  }
  if (isNextUp) {
    return { text: "Pending", tone: colors.warn, bg: `${colors.warn}1a`, icon: "time-outline" as const };
  }
  return { text: "Upcoming", tone: "#2f7fe0", bg: "#2f7fe01a", icon: "arrow-forward-circle-outline" as const };
}

function workoutIconFor(title: string): keyof typeof Ionicons.glyphMap {
  const lower = title.toLowerCase();
  if (/\b(strength|lift|gym|weights?)\b/.test(lower)) return "barbell-outline";
  if (/\b(mobility|stretch|recovery|yoga)\b/.test(lower)) return "body-outline";
  if (/\b(sprint|speed|run|conditioning)\b/.test(lower)) return "flash-outline";
  return "fitness-outline";
}

function TrainingSummaryRow({
  slot,
  session,
  rpe,
  isRestDay,
  isNextUp,
  onPress,
  compact,
}: {
  slot: SessionSlot;
  session: DailySession;
  rpe?: RpeEntry | null;
  isRestDay: boolean;
  isNextUp: boolean;
  onPress: () => void;
  compact?: boolean;
}) {
  const pill = sessionStatusMeta(session, rpe, isRestDay, isNextUp);
  const done = pill.text === "Completed" || pill.text === "Rest";
  const title = isRestDay ? "Rest day" : session.workoutType ?? session.type ?? rpe?.trainingCategory ?? "Open";
  const isPm = slot === "PM";

  const duration = session.actualDurationMin ?? session.durationMin ?? null;
  const rpeValue = rpe?.rpe ?? null;
  const effort = session.effortRating ?? null;
  const metaParts = [
    "--",
    duration !== null ? `${duration} min` : "--",
    `RPE ${rpeValue ?? "--"}`,
    `Effort ${effort ?? "--"}`,
  ];
  const sub = isRestDay ? "Rest day - recovery available" : metaParts.join("  \u2022  ");
  const workoutIcon = workoutIconFor(title);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.trainingSummaryRow,
        compact ? styles.trainingSummaryRowCompact : null,
        done ? styles.trainingSummaryRowDone : null,
        pressed ? { opacity: 0.86 } : null,
      ]}
      accessibilityRole="button"
    >
      <View style={[styles.trainingSummaryIcon, compact ? styles.trainingSummaryIconCompact : null, isPm ? styles.trainingSummaryIconPm : null]}>
        <Ionicons name={isPm ? "moon-outline" : "sunny-outline"} size={compact ? 16 : 20} color={isPm ? "#5670ad" : "#e97912"} />
        <Text style={[styles.trainingSummaryIconText, compact ? styles.trainingSummaryIconTextCompact : null, isPm ? styles.trainingSummaryIconTextPm : null]}>{slot}</Text>
      </View>
      <View style={styles.trainingSummaryCopy}>
        <View style={styles.trainingTitleLine}>
          <Ionicons name={workoutIcon} size={compact ? 13 : 15} color={colors.inkMuted} />
          <Text style={[styles.trainingSummaryTitle, compact ? styles.trainingSummaryTitleCompact : null]} numberOfLines={1}>
            {title}
          </Text>
        </View>
        <Text style={[styles.trainingSummarySub, compact ? styles.trainingSummarySubCompact : null]} numberOfLines={2}>
          {sub}
        </Text>
      </View>
      <View style={[styles.sessionStatusPill, compact ? styles.sessionStatusPillCompact : null, { backgroundColor: pill.bg }]}>
        <Ionicons name={pill.icon} size={compact ? 11 : 12} color={pill.tone} />
        <Text style={[styles.sessionStatusText, compact ? styles.sessionStatusTextCompact : null, { color: pill.tone }]} numberOfLines={1}>{pill.text}</Text>
      </View>
      <Ionicons name="chevron-forward" size={compact ? 15 : 18} color={colors.inkMuted} />
    </Pressable>
  );
}

const MAX_SCALE_METER_SEGMENTS = 10;
const LOG_SCALE_ORANGE = "#ff6a00";
const LOG_SCALE_ICON_INK = "#3f464c";
const COACH_SECTION_ORANGE = "#ff6a00";

/**
 * Bar count for the meter — one bar per value for small ranges (e.g. a 1-10
 * RPE scale gets 10 bars, each an exact integer step) so every bar maps to a
 * distinct reachable value; capped at 10 for wide ranges (e.g. 0-100%, where
 * each bar represents ~10 units).
 */
function scaleSegmentCount(min: number, max: number): number {
  return Math.max(1, Math.min(MAX_SCALE_METER_SEGMENTS, Math.round(max - min) + 1));
}

function CompactScale({
  label,
  value,
  onChange,
  lowHint,
  highHint,
  min = 1,
  max = 5,
  step,
  icon,
  iconColor = LOG_SCALE_ICON_INK,
  accentColor = LOG_SCALE_ORANGE,
  compactCard,
  dense,
}: {
  label: string;
  value: number | null;
  onChange: (v: number) => void;
  lowHint: string;
  highHint: string;
  min?: number;
  max?: number;
  /** Explicit increment between bars (e.g. 5) — overrides the default 10-bar cap. */
  step?: number;
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  accentColor?: string;
  compactCard?: boolean;
  dense?: boolean;
}) {
  const fallback = Math.round((min + max) / 2);
  const current = Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : fallback));
  const segments = step ? Math.round((max - min) / step) + 1 : scaleSegmentCount(min, max);
  const steps = Math.max(1, segments - 1);
  // Bar i (0-indexed) represents the value at that step, so filling the
  // 1st bar sets/shows the minimum value — not one step above it.
  const filled = max === min ? 1 : Math.round(((current - min) / (max - min)) * steps) + 1;

  function setSegment(i: number) {
    const raw = min + (i / steps) * (max - min);
    onChange(Math.max(min, Math.min(max, Math.round(raw))));
  }

  if (compactCard) {
    return (
      <View style={[styles.scaleCard, dense ? styles.scaleCardDense : null]}>
        <View style={styles.scaleCardHeader}>
          {icon ? (
            <View style={[styles.scaleIcon, dense ? styles.scaleIconDense : null]}>
              <Ionicons name={icon} size={dense ? 12 : 14} color={iconColor} />
            </View>
          ) : null}
          <View style={styles.scaleCardCopy}>
            <Text style={[styles.scaleLabel, styles.scaleLabelCard, dense ? styles.scaleLabelDense : null]} numberOfLines={1}>{label}</Text>
            <Text style={[styles.scaleHint, styles.scaleHintCard, dense ? styles.scaleHintDense : null]} numberOfLines={1}>{lowHint}</Text>
          </View>
          <View style={styles.scaleValueBlock}>
            <Text style={[styles.scaleValue, styles.scaleValueCard, { color: accentColor }, dense ? styles.scaleValueDense : null]}>{current}</Text>
            <Text style={[styles.scaleHint, styles.scaleHintCard, dense ? styles.scaleHintDense : null]} numberOfLines={1}>{highHint}</Text>
          </View>
        </View>
        <View style={[styles.meterRow, styles.meterRowCard, dense ? styles.meterRowDense : null]} accessibilityRole="adjustable" accessibilityLabel={label}>
          {Array.from({ length: segments }).map((_, i) => (
            <Pressable
              key={i}
              onPress={() => setSegment(i)}
              style={[
                styles.meterBar,
                styles.meterBarCard,
                dense ? styles.meterBarDense : null,
                i < filled ? styles.meterBarFilledCard : styles.meterBarEmptyCard,
                i < filled ? { backgroundColor: accentColor } : null,
              ]}
            />
          ))}
        </View>
      </View>
    );
  }

  return (
    <View>
      <View style={styles.scaleHeader}>
        <Text style={styles.scaleLabel}>{label}</Text>
        <Text style={styles.scaleValue}>{current}</Text>
      </View>
      <View style={styles.meterRow} accessibilityRole="adjustable" accessibilityLabel={label}>
        {Array.from({ length: segments }).map((_, i) => (
          <Pressable
            key={i}
            onPress={() => setSegment(i)}
            style={[
              styles.meterBar,
              { height: `${34 + (i * 66) / Math.max(1, segments - 1)}%` },
              i < filled ? styles.meterBarFilled : styles.meterBarEmpty,
            ]}
          />
        ))}
      </View>
      <View style={styles.scaleHints}>
        <Text style={styles.scaleHint}>{lowHint}</Text>
        <Text style={styles.scaleHint}>{highHint}</Text>
      </View>
    </View>
  );
}

function parseReminderMinutes(value: unknown): ReminderMinutes {
  return value === 60 || value === 90 || value === 120 ? value : 120;
}

async function readHydrationReminderSettings(): Promise<{ enabled: boolean; minutes: ReminderMinutes }> {
  try {
    const parsed = JSON.parse((await AsyncStorage.getItem(WATER_REMINDER_KEY)) ?? "{}") as {
      enabled?: boolean;
      minutes?: number;
    };
    return { enabled: Boolean(parsed.enabled), minutes: parseReminderMinutes(parsed.minutes) };
  } catch {
    return { enabled: false, minutes: 120 };
  }
}

async function syncHydrationReminder(enabled: boolean, minutes: ReminderMinutes, remainingMl: number) {
  await Notifications.cancelScheduledNotificationAsync(WATER_REMINDER_ID).catch(() => undefined);
  if (!enabled || remainingMl <= 0) return;
  await Notifications.scheduleNotificationAsync({
    identifier: WATER_REMINDER_ID,
    content: {
      title: "Hydration reminder",
      body: `${litres(remainingMl)} L remaining for today's water goal.`,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: minutes * 60,
      repeats: true,
      channelId: "hydration",
    },
  });
}

function HydrationCard({ date }: { date: string }) {
  const [day, setDay] = useState<WaterDay | null>(null);
  const [historyDays, setHistoryDays] = useState<7 | 30>(7);
  const [history, setHistory] = useState<WaterSeries | null>(null);
  const [busy, setBusy] = useState(false);
  const [goalDraft, setGoalDraft] = useState("");
  const [amountDraft, setAmountDraft] = useState("");
  const [goalError, setGoalError] = useState<string | null>(null);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [remindersEnabled, setRemindersEnabled] = useState(false);
  const [reminderMinutes, setReminderMinutes] = useState<ReminderMinutes>(120);
  const [notificationPermission, setNotificationPermission] = useState("undetermined");
  const [reminderError, setReminderError] = useState<string | null>(null);
  const [reminderReady, setReminderReady] = useState(false);

  const loadDay = useCallback(async () => {
    try {
      const next = await apiJson<WaterDay>(`/api/athlete/water?date=${date}`);
      setDay(next);
      setGoalDraft(String(next.goalMl));
    } catch {
      // Keep last known day if the optional hydration fetch fails.
    }
  }, [date]);

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await apiJson<WaterSeries>(`/api/athlete/analytics/water?days=${historyDays}`));
    } catch {
      // Keep last known chart/history if analytics fails.
    }
  }, [historyDays]);

  useEffect(() => {
    void loadDay();
  }, [loadDay]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    let active = true;
    async function hydrateReminderState() {
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("hydration", {
          name: "Hydration",
          importance: Notifications.AndroidImportance.DEFAULT,
        }).catch(() => undefined);
      }
      const [settings, permission] = await Promise.all([
        readHydrationReminderSettings(),
        Notifications.getPermissionsAsync().catch(() => null),
      ]);
      if (!active) return;
      setRemindersEnabled(settings.enabled);
      setReminderMinutes(settings.minutes);
      setNotificationPermission(permission?.status ?? "unsupported");
      setReminderReady(true);
    }
    void hydrateReminderState();
    return () => {
      active = false;
    };
  }, []);

  const total = day?.totalMl ?? 0;
  const goal = day?.goalMl ?? 3000;
  const remaining = Math.max(0, goal - total);
  const pct = goal > 0 ? Math.min(100, Math.round((total / goal) * 100)) : 0;
  const reached = total >= goal;
  const historyGoal = history?.goalMl ?? goal;
  const achievedDays = useMemo(
    () => (history?.series ?? []).filter((point) => (point.totalMl ?? 0) >= historyGoal).length,
    [history?.series, historyGoal]
  );

  useEffect(() => {
    if (!reminderReady) return;
    void AsyncStorage.setItem(
      WATER_REMINDER_KEY,
      JSON.stringify({ enabled: remindersEnabled, minutes: reminderMinutes })
    );
    if (notificationPermission === "granted") {
      void syncHydrationReminder(remindersEnabled, reminderMinutes, remaining).catch(() => undefined);
    }
  }, [notificationPermission, remaining, reminderMinutes, reminderReady, remindersEnabled]);

  async function mutateWater(run: () => Promise<Response>) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await run();
      if (res.ok) {
        setDay((await res.json()) as WaterDay);
        await loadHistory();
      }
    } finally {
      setBusy(false);
    }
  }

  async function add(amountMl: number) {
    setAmountError(null);
    await mutateWater(() =>
      apiFetch("/api/athlete/water", {
        method: "POST",
        body: JSON.stringify({ date, amountMl }),
      })
    );
  }

  async function addCustomAmount() {
    const amountMl = Number(amountDraft);
    if (!Number.isFinite(amountMl) || amountMl < 50 || amountMl > 3000) {
      setAmountError("Amount must be between 50 and 3000 ml.");
      return;
    }
    await add(Math.round(amountMl));
    setAmountDraft("");
  }

  async function remove(id: string) {
    await mutateWater(() => apiFetch(`/api/athlete/water/${id}`, { method: "DELETE" }));
  }

  async function saveGoal(nextGoal?: number) {
    const goalMl = nextGoal ?? Number(goalDraft);
    if (!Number.isFinite(goalMl) || goalMl < 500 || goalMl > 8000) {
      setGoalError("Goal must be between 500 and 8000 ml.");
      return;
    }
    setBusy(true);
    setGoalError(null);
    try {
      const rounded = Math.round(goalMl);
      const res = await apiFetch("/api/athlete/me", {
        method: "PATCH",
        body: JSON.stringify({ hydrationGoalMl: rounded }),
      });
      if (!res.ok) {
        setGoalError("Could not save goal.");
        return;
      }
      setGoalDraft(String(rounded));
      setDay((current) => current ? { ...current, goalMl: rounded } : current);
      await Promise.all([loadDay(), loadHistory()]);
    } finally {
      setBusy(false);
    }
  }

  async function toggleReminders() {
    setReminderError(null);
    if (remindersEnabled) {
      setRemindersEnabled(false);
      await Notifications.cancelScheduledNotificationAsync(WATER_REMINDER_ID).catch(() => undefined);
      return;
    }
    const permission = await Notifications.requestPermissionsAsync().catch(() => null);
    const status = permission?.status ?? "unsupported";
    setNotificationPermission(status);
    if (status !== "granted") {
      setReminderError(status === "denied" ? "Notifications are blocked on this device." : "Allow notifications to use reminders.");
      return;
    }
    setRemindersEnabled(true);
  }

  return (
    <View style={styles.stack}>
      <Card style={styles.waterGoalCard}>
        <CardTitle>Water goal</CardTitle>
        <View style={styles.waterGoalBody}>
          <HydrationGoalRing pct={pct} reached={reached} />
          <View style={styles.waterMetricGrid}>
            <HydrationMetricTile label="Drunk" value={`${litres(total)} L`} />
            <HydrationMetricTile label="Remaining" value={`${litres(remaining)} L`} good={reached} />
            <HydrationMetricTile label="Goal" value={`${litres(goal)} L`} />
          </View>
          <View style={[styles.waterStatusPanel, reached ? styles.waterStatusPanelGood : null]}>
            <Text style={[styles.waterStatusText, reached ? styles.waterStatusTextGood : null]}>
              {reached ? "Daily hydration achieved" : `${remaining} ml remaining today`}
            </Text>
            <Text style={styles.waterStatusSub}>
              {achievedDays} of last {historyDays} days reached the goal.
            </Text>
          </View>
        </View>
      </Card>

      <Card>
        <CardTitle>Daily water goal</CardTitle>
        <View style={styles.waterPresetGrid}>
          {WATER_GOAL_PRESETS.map((ml) => (
            <Pressable
              key={ml}
              onPress={() => saveGoal(ml)}
              disabled={busy}
              style={[styles.waterPresetButton, goal === ml ? styles.waterPresetButtonOn : null, busy ? styles.controlDisabled : null]}
            >
              <Text style={[styles.waterPresetText, goal === ml ? styles.waterPresetTextOn : null]}>{litres(ml)} L</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.waterInputRow}>
          <TextInput
            value={goalDraft}
            onChangeText={setGoalDraft}
            keyboardType="numeric"
            placeholder="Goal ml"
            placeholderTextColor={colors.inkFaint}
            style={styles.waterInput}
          />
          <Pressable onPress={() => saveGoal()} disabled={busy} style={[styles.waterPrimaryButton, busy ? styles.controlDisabled : null]}>
            <Text style={styles.waterPrimaryText}>Save</Text>
          </Pressable>
        </View>
        {goalError ? <Text style={styles.waterError}>{goalError}</Text> : null}
      </Card>

      <Card>
        <CardTitle>Log water intake</CardTitle>
        <View style={styles.waterPresetGrid}>
          {WATER_QUICK_ADD.map((ml) => (
            <Pressable key={ml} disabled={busy} onPress={() => add(ml)} style={[styles.waterSecondaryButton, busy ? styles.controlDisabled : null]}>
              <Text style={styles.waterSecondaryText}>+{ml} ml</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.waterInputRow}>
          <TextInput
            value={amountDraft}
            onChangeText={setAmountDraft}
            keyboardType="numeric"
            placeholder="Custom ml"
            placeholderTextColor={colors.inkFaint}
            style={styles.waterInput}
          />
          <Pressable
            onPress={addCustomAmount}
            disabled={busy || !amountDraft.trim()}
            style={[styles.waterPrimaryButton, busy || !amountDraft.trim() ? styles.controlDisabled : null]}
          >
            <Text style={styles.waterPrimaryText}>Add</Text>
          </Pressable>
        </View>
        {amountError ? <Text style={styles.waterError}>{amountError}</Text> : null}
      </Card>

      <Card>
        <View style={styles.waterReminderHeader}>
          <View style={styles.waterReminderCopy}>
            <CardTitle>Reminder notifications</CardTitle>
            <Text style={styles.waterReminderTitle}>Hydration reminders</Text>
            <Text style={styles.waterReminderSub}>
              {remindersEnabled ? `Every ${reminderMinutes} minutes while this app is installed.` : "Off"}
            </Text>
          </View>
          <Pressable
            onPress={toggleReminders}
            style={[styles.waterReminderToggle, remindersEnabled ? styles.waterReminderToggleOn : null]}
          >
            <Text style={[styles.waterReminderToggleText, remindersEnabled ? styles.waterReminderToggleTextOn : null]}>
              {remindersEnabled ? "On" : "Enable"}
            </Text>
          </Pressable>
        </View>
        <View style={styles.waterPresetGrid}>
          {[60, 90, 120].map((minutes) => (
            <Pressable
              key={minutes}
              onPress={() => setReminderMinutes(minutes as ReminderMinutes)}
              style={[styles.waterPresetButton, reminderMinutes === minutes ? styles.waterPresetButtonOn : null]}
            >
              <Text style={[styles.waterPresetText, reminderMinutes === minutes ? styles.waterPresetTextOn : null]}>{minutes} min</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.waterPermission}>Status: {notificationPermission}</Text>
        {reminderError ? <Text style={styles.waterError}>{reminderError}</Text> : null}
      </Card>

      <Card>
        <View style={styles.waterChartTitleRow}>
          <CardTitle>{historyDays === 7 ? "Weekly chart" : "Monthly chart"}</CardTitle>
          <View style={styles.waterSegment}>
            {[7, 30].map((days) => (
              <Pressable
                key={days}
                onPress={() => setHistoryDays(days as 7 | 30)}
                style={[styles.waterSegmentButton, historyDays === days ? styles.waterSegmentButtonOn : null]}
              >
                <Text style={[styles.waterSegmentText, historyDays === days ? styles.waterSegmentTextOn : null]}>
                  {days === 7 ? "Week" : "Month"}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
        <HydrationBarsMobile series={history?.series ?? []} goalMl={historyGoal} />
      </Card>

      <Card>
        <CardTitle>Hydration history</CardTitle>
        {history && history.series.length > 0 ? (
          <View style={styles.waterHistoryList}>
            {[...history.series].reverse().slice(0, 10).map((point) => {
              const amount = point.totalMl ?? 0;
              const met = amount >= historyGoal;
              return (
                <View key={point.date} style={styles.waterHistoryRow}>
                  <View>
                    <Text style={styles.waterHistoryDate}>{shortDate(point.date)}</Text>
                    <Text style={styles.waterHistorySub}>
                      {met ? "Goal achieved" : `${Math.max(0, historyGoal - amount)} ml remaining`}
                    </Text>
                  </View>
                  <Text style={[styles.waterHistoryAmount, met ? styles.waterHistoryAmountGood : null]}>
                    {litres(amount)} L
                  </Text>
                </View>
              );
            })}
          </View>
        ) : (
          <Text style={styles.miniMuted}>No hydration history yet.</Text>
        )}
      </Card>

      <Card>
        <CardTitle>{"Today's entries"}</CardTitle>
        {day && day.entries.length > 0 ? (
          <View style={styles.waterEntryWrap}>
            {[...day.entries].reverse().map((entry) => (
              <Pressable
                key={entry.id}
                disabled={busy}
                onPress={() => remove(entry.id)}
                style={({ pressed }) => [styles.waterEntryChip, pressed ? { borderColor: `${colors.bad}66` } : null, busy ? styles.controlDisabled : null]}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${entry.amountMl} ml`}
              >
                <Text style={styles.waterEntryText}>{entry.amountMl} ml x</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <Text style={styles.miniMuted}>No water logged for this date.</Text>
        )}
      </Card>
    </View>
  );
}

function HydrationMetricTile({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <View style={styles.waterMetricTile}>
      <Text style={styles.waterMetricLabel}>{label}</Text>
      <Text style={[styles.waterMetricValue, good ? styles.waterMetricValueGood : null]}>{value}</Text>
    </View>
  );
}

function HydrationGoalRing({ pct, reached }: { pct: number; reached: boolean }) {
  const size = 176;
  const stroke = 16;
  const ringRadius = (size - stroke) / 2;
  const circ = 2 * Math.PI * ringRadius;
  const offset = circ * (1 - Math.max(0, Math.min(100, pct)) / 100);
  return (
    <View style={styles.waterRingWrap}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={ringRadius} stroke={colors.surfaceInset} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={ringRadius}
          stroke={reached ? colors.ok : "#ff7e1a"}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={styles.waterRingInner}>
        <Text style={styles.waterRingPct}>{pct}%</Text>
        <Text style={styles.waterRingLabel}>{reached ? "Goal met" : "Complete"}</Text>
      </View>
    </View>
  );
}

function HydrationBarsMobile({ series, goalMl }: { series: WaterPoint[]; goalMl: number }) {
  const { width } = useWindowDimensions();
  if (series.length === 0) return <Text style={styles.miniMuted}>No chart data yet.</Text>;

  const chartWidth = Math.max(260, Math.min(width - 86, 430));
  const chartHeight = 176;
  const chartData = {
    labels: series.map(() => ""),
    datasets: [
      {
        data: series.map((point) => point.totalMl ?? 0),
        colors: series.map((point) => {
          if (point.totalMl === null) return () => colors.surfaceInset;
          return () => ((point.totalMl ?? 0) >= goalMl ? colors.ok : "#ff7e1a");
        }),
      },
    ],
  };

  return (
    <View>
      <View style={styles.waterChartKitWrap}>
        <BarChart
          data={chartData}
          width={chartWidth}
          height={chartHeight}
          yAxisLabel=""
          yAxisSuffix=""
          fromZero
          withInnerLines={false}
          withHorizontalLabels={false}
          withVerticalLabels={false}
          showBarTops={false}
          withCustomBarColorFromData
          flatColor
          segments={4}
          chartConfig={{
            backgroundGradientFrom: colors.surfaceRaised,
            backgroundGradientFromOpacity: 0,
            backgroundGradientTo: colors.surfaceRaised,
            backgroundGradientToOpacity: 0,
            fillShadowGradient: "#ff7e1a",
            fillShadowGradientOpacity: 1,
            color: () => "#ff7e1a",
            labelColor: () => colors.inkFaint,
            barPercentage: series.length > 14 ? 0.24 : 0.72,
            barRadius: 6,
            decimalPlaces: 0,
            propsForBackgroundLines: { stroke: colors.line },
          }}
          style={styles.waterChartKit}
        />
      </View>
      <View style={styles.waterBarsFooter}>
        <Text style={styles.waterBarsLabel}>{shortDate(series[0].date)}</Text>
        <Text style={styles.waterBarsLabel}>Goal {litres(goalMl)} L</Text>
        <Text style={styles.waterBarsLabel}>{shortDate(series[series.length - 1].date)}</Text>
      </View>
    </View>
  );
}

function HydrationCardLegacy({ date }: { date: string }) {
  const [day, setDay] = useState<WaterDay | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiJson<WaterDay>(`/api/athlete/water?date=${date}`);
      setDay(res);
    } catch {
      // keep last state
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  async function add(amountMl: number) {
    await mutate(() =>
      apiFetch("/api/athlete/water", {
        method: "POST",
        body: JSON.stringify({ date, amountMl }),
      })
    );
  }

  async function remove(id: string) {
    await mutate(() => apiFetch(`/api/athlete/water/${id}`, { method: "DELETE" }));
  }

  async function mutate(run: () => Promise<Response>) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await run();
      if (res.ok) setDay(await res.json());
    } finally {
      setBusy(false);
    }
  }

  const total = day?.totalMl ?? 0;
  const goal = day?.goalMl ?? 3000;
  const pct = Math.min(100, Math.round((total / goal) * 100));
  const reached = total >= goal;

  return (
    <Card>
      <CardTitle>Hydration</CardTitle>
      <View style={styles.hydrationHeader}>
        <Text style={styles.hydrationTotal}>{litres(total)}<Text style={styles.hydrationUnit}> / {litres(goal)} L</Text></Text>
        <Text style={[styles.hydrationPct, reached ? { color: colors.ok } : null]}>{pct}%{reached ? " · goal met" : ""}</Text>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: reached ? colors.ok : "#ff7e1a" }]} />
      </View>
      <View style={styles.quickWaterGrid}>
        {[250, 500, 750].map((ml) => (
          <Pressable key={ml} disabled={busy} onPress={() => add(ml)} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>+{ml} ml</Text>
          </Pressable>
        ))}
      </View>
      {day && day.entries.length > 0 ? (
        <View style={styles.waterEntryWrap}>
          {day.entries.map((entry) => (
            <Pressable
              key={entry.id}
              disabled={busy}
              onPress={() => remove(entry.id)}
              style={({ pressed }) => [styles.waterEntryChip, pressed ? { borderColor: `${colors.bad}55` } : null]}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${entry.amountMl} ml`}
            >
              <Text style={styles.waterEntryText}>{entry.amountMl} ml x</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <Text style={[styles.miniMuted, { marginTop: 12 }]}>Tap a button each time you drink.</Text>
      )}
    </Card>
  );
}

const TREND_TABS = [
  { key: "readiness", label: "Readiness" },
  { key: "hr", label: "Heart rate" },
  { key: "wellness", label: "Wellness" },
  { key: "performance", label: "Performance" },
] as const;
type TrendTab = (typeof TREND_TABS)[number]["key"];

function TrendsSection() {
  const [tab, setTab] = useState<TrendTab>("readiness");
  return (
    <View style={styles.stack}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.trendTabs}>
        {TREND_TABS.map((t) => {
          const on = tab === t.key;
          return (
            <Pressable key={t.key} onPress={() => setTab(t.key)} style={[styles.trendTab, on ? styles.trendTabOn : null]}>
              <Text style={[styles.trendTabText, on ? styles.trendTabTextOn : null]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {tab === "readiness" ? <PerformanceTrendPanel /> : null}
      {tab === "hr" ? <HeartRatePanel /> : null}
      {tab === "wellness" ? <WellnessSignalsPanel /> : null}
      {tab === "performance" ? <PerformanceMetricPanel /> : null}
    </View>
  );
}

/** Big current value + its trend verdict, tinted to match its chart line. */
function TrendTile({
  label,
  value,
  unit,
  color,
  badge,
}: {
  label: string;
  value: string;
  unit?: string;
  color?: string;
  badge?: React.ReactNode;
}) {
  return (
    <View style={styles.trendTile}>
      <Text style={styles.trendTileLabel} numberOfLines={1}>{label}</Text>
      <Text style={[styles.trendTileValue, color ? { color } : null]} numberOfLines={1}>
        {value}
        {unit ? <Text style={styles.trendTileUnit}> {unit}</Text> : null}
      </Text>
      {badge ? <View style={{ marginTop: 6 }}>{badge}</View> : null}
    </View>
  );
}

/**
 * Plain-language verdict pill: "▲ Improving 6%" / "▼ Declining" / "→ Steady".
 * Already direction-aware via summarizeTrend. `neutral` shows Rose/Fell/Steady
 * without a green/red judgement (e.g. training load).
 */
function latestDisplay(values: (number | null)[], unit?: string): string {
  const value = latestVal(values);
  return value === null ? "-" : fmtValue(value, unit);
}

function TrendBadge({
  summary,
  neutral = false,
  unit,
  showMagnitude = true,
}: {
  summary: TrendSummary | null;
  neutral?: boolean;
  unit?: string;
  showMagnitude?: boolean;
}) {
  if (!summary) return <Text style={styles.badgeNoData}>NO DATA</Text>;
  const mag = fmtMagnitude(summary, unit);

  if (neutral) {
    const rose = summary.rose;
    const arrow = rose === null ? "→" : rose ? "▲" : "▼";
    const word = rose === null ? "Steady" : rose ? "Rose" : "Fell";
    return (
      <View style={[styles.badge, { backgroundColor: colors.surfaceInset }]}>
        <Text style={[styles.badgeText, { color: colors.inkMuted }]} numberOfLines={1}>
          {arrow} {word}{showMagnitude && rose !== null ? ` ${mag}` : ""}
        </Text>
      </View>
    );
  }

  const map = {
    improving: { bg: `${colors.ok}22`, fg: colors.ok, arrow: "▲", word: "Improving" },
    declining: { bg: `${colors.bad}22`, fg: colors.bad, arrow: "▼", word: "Declining" },
    steady: { bg: colors.surfaceInset, fg: colors.inkMuted, arrow: "→", word: "Steady" },
  } as const;
  const m = map[summary.dir];
  return (
    <View style={[styles.badge, { backgroundColor: m.bg }]}>
      <Text style={[styles.badgeText, { color: m.fg }]} numberOfLines={1}>
        {m.arrow} {m.word}{showMagnitude && summary.dir !== "steady" ? ` ${mag}` : ""}
      </Text>
    </View>
  );
}

/** Tiny single-series line, colored by whether the metric trends good/bad. */
function Sparkline({ values, color, height = 32 }: { values: (number | null)[]; color: string; height?: number }) {
  const [w, setW] = useState(0);
  const valid = values
    .map((v, i) => ({ v, i }))
    .filter((p): p is { v: number; i: number } => p.v !== null && Number.isFinite(p.v));
  const nums = valid.map((p) => p.v);
  const min = nums.length ? Math.min(...nums) : 0;
  const max = nums.length ? Math.max(...nums) : 1;
  const span = Math.max(1e-6, max - min);
  const pad = 3;
  const x = (i: number) => (values.length <= 1 ? w / 2 : pad + (i / (values.length - 1)) * (w - pad * 2));
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);
  const d = valid.map((p, idx) => `${idx === 0 ? "M" : "L"} ${x(p.i)} ${y(p.v)}`).join(" ");
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ height }}>
      {w > 0 && valid.length > 0 ? (
        <Svg width={w} height={height}>
          <Path d={d} stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      ) : null}
    </View>
  );
}

/** "At a glance" footer: plain verdict + avg / best / range from the loaded series. */
function ChartInsight({
  label,
  values,
  unit = "",
  lowerIsBetter = false,
  periodDays,
}: {
  label: string;
  values: (number | null)[];
  unit?: string;
  lowerIsBetter?: boolean;
  periodDays: number;
}) {
  const valid = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (valid.length < 3) return null;
  const sum = summarizeTrend(values, { lowerIsBetter });
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
  const best = lowerIsBetter ? min : max;
  const verdict =
    !sum || sum.dir === "steady"
      ? { word: "Steady", color: colors.inkMuted }
      : sum.dir === "improving"
      ? { word: "Improving", color: colors.ok }
      : { word: "Needs attention", color: colors.bad };
  const move =
    !sum || sum.dir === "steady"
      ? `barely changed over the last ${periodDays} days`
      : `${sum.rose ? "up" : "down"} ${fmtMagnitude(sum)} over the last ${periodDays} days`;
  const u = unit ? ` ${unit}` : "";
  return (
    <View style={styles.insightBox}>
      <Text style={styles.insightKicker}>At a glance · {label}</Text>
      <Text style={styles.insightBody}>
        <Text style={{ color: verdict.color, fontWeight: "700" }}>{verdict.word}</Text> — {move}.
      </Text>
      <View style={styles.insightStats}>
        <Text style={styles.insightStat}>Avg <Text style={styles.insightStatVal}>{fmtValue(mean)}{u}</Text></Text>
        <Text style={styles.insightStat}>Best <Text style={styles.insightStatVal}>{fmtValue(best)}{u}</Text></Text>
        <Text style={styles.insightStat}>Range <Text style={styles.insightStatVal}>{fmtValue(min)}–{fmtValue(max)}{u}</Text></Text>
      </View>
    </View>
  );
}

/** "How to read this" footer — a plain-language explainer of the chart. */
function ChartAbout({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.aboutBox}>
      <Text style={styles.insightKicker}>How to read this</Text>
      <Text style={styles.aboutBody}>{children}</Text>
    </View>
  );
}

function PerformanceTrendPanel() {
  const [days, setDays] = useState(30);
  const [series, setSeries] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiJson<{ series: TrendPoint[] }>(`/api/athlete/trends?days=${days}`)
      .then((res) => setSeries(res.series ?? []))
      .catch(() => setSeries([]))
      .finally(() => setLoading(false));
  }, [days]);

  const readinessCol = column(series, "readiness");
  const recoveryCol = column(series, "recoveryScore");
  const loadCol = column(series, "load");
  const rSum = summarizeTrend(readinessCol);
  const recSum = summarizeTrend(recoveryCol);
  const loadSum = summarizeTrend(loadCol);

  return (
    <View style={styles.stack}>
      <ChartPanel
        title="Readiness & recovery"
        subtitle="Higher is better (0-100). Missing days show as gaps."
        action={<DaysToggle value={days} options={[7, 14, 30]} onChange={setDays} />}
        loading={loading}
      >
        <View style={styles.tileRow}>
          <TrendTile label="Readiness" value={latestDisplay(readinessCol)} color="#6bbd2a" badge={<TrendBadge summary={rSum} />} />
          <TrendTile label="Recovery" value={latestDisplay(recoveryCol)} color="#2f7df6" badge={<TrendBadge summary={recSum} />} />
        </View>
        <MultiSeriesChart
          data={series}
          series={[
            { key: "readiness", label: "Readiness", color: "#6bbd2a", kind: "line" },
            { key: "recoveryScore", label: "Recovery", color: "#2f7df6", kind: "line" },
          ]}
          leftDomain={[0, 100]}
        />
        <Legend items={[
          { label: "Readiness", color: "#6bbd2a" },
          { label: "Recovery", color: "#2f7df6" },
        ]} />
        <ChartInsight label="Readiness" values={readinessCol} periodDays={days} />
        <ChartAbout>
          Readiness and recovery both use a 0-100 score. Higher is better. Gaps mean no value was logged that day,
          not a score of zero.
        </ChartAbout>
      </ChartPanel>

      <ChartPanel
        title="Training load"
        subtitle="Higher bars mean more training stress. Blank days mean no RPM load."
        loading={loading}
      >
        <View style={styles.tileRow}>
          <TrendTile label="Latest load" value={latestDisplay(loadCol)} color="#f47c20" badge={<TrendBadge summary={loadSum} neutral />} />
        </View>
        <MultiSeriesChart
          data={series}
          series={[{ key: "load", label: "Load", color: "#f47c20", kind: "bar" }]}
          autoDomain
          height={190}
        />
        <Legend items={[{ label: "Training load", color: "#f47c20" }]} />
        <ChartAbout>
          Training load is effort from logged RPM sessions. Use it with readiness: high load during low readiness is
          the main warning sign.
        </ChartAbout>
      </ChartPanel>
    </View>
  );
}

// Each wellness signal carries its own "which way is good" so the trend reads
// correctly: more sleep/mood = better, but less stress/soreness/fatigue = better.
// Hydration rides along here (as % of the daily goal) instead of its own chart.
const WELLNESS_SIGNALS: { key: keyof WellnessPoint; label: string; lowerIsBetter: boolean; unit?: string }[] = [
  { key: "sleepQuality", label: "Sleep quality", lowerIsBetter: false },
  { key: "mood", label: "Mood", lowerIsBetter: false },
  { key: "stress", label: "Stress", lowerIsBetter: true },
  { key: "soreness", label: "Soreness", lowerIsBetter: true },
  { key: "fatigue", label: "Fatigue", lowerIsBetter: true },
  { key: "waterPct", label: "Hydration", lowerIsBetter: false, unit: "%" },
];

function WellnessSignalsPanel() {
  const [days, setDays] = useState(30);
  const [series, setSeries] = useState<WellnessPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiJson<{ series: WellnessPoint[] }>(`/api/athlete/analytics/wellness?days=${days}`)
      .then((res) => setSeries(res.series ?? []))
      .catch(() => setSeries([]))
      .finally(() => setLoading(false));
  }, [days]);

  return (
    <ChartPanel
      title="Wellness signals"
      subtitle="Daily self-check · trend shows if each is helping or hurting"
      action={<DaysToggle value={days} options={[14, 30]} onChange={setDays} />}
      loading={loading}
    >
      <View>
        {WELLNESS_SIGNALS.map((sig, idx) => {
          const col = column(series, sig.key);
          const sum = summarizeTrend(col, { lowerIsBetter: sig.lowerIsBetter });
          const now = latestVal(col);
          const sparkColor = !sum || sum.dir === "steady" ? colors.inkFaint : sum.dir === "improving" ? colors.ok : colors.bad;
          return (
            <View key={String(sig.key)} style={[styles.wellnessRow, idx > 0 ? styles.wellnessRowDivider : null]}>
              <View style={styles.wellnessLabelCol}>
                <Text style={styles.wellnessLabel} numberOfLines={1}>{sig.label}</Text>
                <Text style={styles.wellnessHint}>{sig.lowerIsBetter ? "lower is better" : "higher is better"}</Text>
              </View>
              <View style={styles.wellnessSpark}>
                <Sparkline values={col} color={sparkColor} />
              </View>
              <Text style={styles.wellnessValue} numberOfLines={1}>
                {now === null ? "—" : sig.unit ? fmtValue(now) : wellnessFiveToTen(now)}
                <Text style={styles.wellnessUnit}>{sig.unit ?? "/10"}</Text>
              </Text>
              <View style={styles.wellnessBadge}>
                <TrendBadge summary={sum} showMagnitude={false} />
              </View>
            </View>
          );
        })}
      </View>
      <ChartAbout>
        Your daily self-check. Each row badge shows whether it is helping (green) or hurting (red) — remember higher
        is better for sleep, mood & hydration, but lower is better for stress, soreness & fatigue.
      </ChartAbout>
    </ChartPanel>
  );
}

function HeartRatePanel() {
  const [days, setDays] = useState(30);
  const [series, setSeries] = useState<WellnessPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiJson<{ series: WellnessPoint[] }>(`/api/athlete/analytics/wellness?days=${days}`)
      .then((res) => setSeries(res.series ?? []))
      .catch(() => setSeries([]))
      .finally(() => setLoading(false));
  }, [days]);

  const wakeCol = column(series, "wakeHr");
  const bedCol = column(series, "bedHr");
  const wakeSum = summarizeTrend(wakeCol, { lowerIsBetter: true });
  const bedSum = summarizeTrend(bedCol);
  const hrTile = (col: (number | null)[]) => {
    const v = latestVal(col);
    return v === null ? "-" : fmtValue(v);
  };

  return (
    <ChartPanel
      title="Resting heart rate"
      subtitle="Twice daily (bpm) · a lower waking HR is better"
      action={<DaysToggle value={days} options={[7, 14, 30]} onChange={setDays} />}
      loading={loading}
    >
      <View style={styles.tileRow}>
        <TrendTile label="Waking HR" value={hrTile(wakeCol)} unit="bpm" color="#2f7df6" badge={<TrendBadge summary={wakeSum} unit="bpm" />} />
        <TrendTile label="Before bed" value={hrTile(bedCol)} unit="bpm" color="#e8892b" badge={<TrendBadge summary={bedSum} neutral unit="bpm" />} />
      </View>
      <MultiSeriesChart
        data={series}
        series={[
          { key: "wakeHr", label: "Waking HR", color: "#2f7df6", kind: "line" },
          { key: "bedHr", label: "Before bed", color: "#e8892b", kind: "line" },
        ]}
        autoDomain
      />
      <Legend items={[
        { label: "Waking HR", color: "#2f7df6" },
        { label: "Before bed", color: "#e8892b" },
      ]} />
      <ChartInsight label="Waking HR" values={wakeCol} unit="bpm" lowerIsBetter periodDays={days} />
      <ChartAbout>
        Resting heart rate on waking (blue) and before bed (amber). A lower, steady waking HR usually means good
        recovery and fitness; a sustained rise can flag fatigue, stress, or illness.
      </ChartAbout>
    </ChartPanel>
  );
}

// Time-based metrics (sprint times etc.) improve as the number goes DOWN.
const TIME_UNITS = new Set(["s", "sec", "secs", "ms", "min"]);
function lowerIsBetterMetric(metric: string | null, unit: string): boolean {
  if (TIME_UNITS.has(unit.toLowerCase())) return true;
  return /time|sprint|\b\d+\s*m\b/i.test(metric ?? "");
}

function PerformanceMetricPanel() {
  const [metric, setMetric] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<string[]>([]);
  const [points, setPoints] = useState<PerfPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiJson<{ metrics: string[]; series: PerfPoint[] }>("/api/athlete/analytics/performance?days=90")
      .then((res) => {
        setMetrics(res.metrics ?? []);
        setMetric((m) => m ?? res.metrics?.[0] ?? null);
        setPoints(res.series ?? []);
      })
      .catch(() => {
        setMetrics([]);
        setPoints([]);
      })
      .finally(() => setLoading(false));
  }, []);

  const active = metric ?? metrics[0] ?? null;
  const data = points.filter((p) => p.metric === active).map((p) => ({ date: p.date, value: p.value }));
  const unit = points.find((p) => p.metric === active)?.unit ?? "";
  const lowerIsBetter = lowerIsBetterMetric(active, unit);
  const valueCol = data.map((p) => p.value as number | null);
  const sum = summarizeTrend(valueCol, { lowerIsBetter });
  const latestValue = latestVal(valueCol);

  return (
    <ChartPanel
      title="Performance"
      subtitle={active ? `${active}${unit ? ` (${unit})` : ""} · ${lowerIsBetter ? "lower is better" : "higher is better"}` : "Test results over time"}
      loading={loading}
    >
      {metrics.length > 1 ? <MetricToggle value={active} options={metrics} onChange={setMetric} /> : null}
      <View style={styles.latestRow}>
        <View>
          <Text style={styles.tileLabel}>Latest</Text>
          <Text style={styles.perfLatest}>{latestValue == null ? "-" : fmtValue(latestValue)}<Text style={styles.perfUnit}> {unit}</Text></Text>
        </View>
        <TrendBadge summary={sum} unit={unit} />
      </View>
      <MultiSeriesChart
        data={data}
        series={[{ key: "value", label: active ?? "value", color: "#477f17", kind: "line" }]}
        autoDomain
      />
      <ChartInsight label={active ?? "Metric"} values={valueCol} unit={unit} lowerIsBetter={lowerIsBetter} periodDays={90} />
      <ChartAbout>
        Your test results over time (last 90 days). For timed tests like sprints, lower is better; for strength and
        jumps, higher is better. Switch metric with the buttons above.
      </ChartAbout>
    </ChartPanel>
  );
}

type SessionForm = {
  status: SessionStatusValue;
  workoutType: string;
  sets: string;
  reps: string;
  actualDurationMin: string;
  effortRating: number;
  notes: string;
  trainingCategory: string;
  plannedIntensityPercent: number;
  rpe: number;
  sleepQuality: number;
  soreness: number;
  fatigue: number;
  moodMotivation: number;
  restingHeartRate: string;
};

function cleanStatus(value: string | null | undefined): SessionStatusValue {
  return TRAINING_STATUS.some((s) => s.value === value) ? (value as SessionStatusValue) : "completed";
}

function categoryChoicesFor(current: string): string[] {
  return CATEGORY_CHOICES.includes(current as (typeof CATEGORY_CHOICES)[number])
    ? [...CATEGORY_CHOICES]
    : [current, ...CATEGORY_CHOICES];
}

function normalizeTrainingCategory(value: string | null | undefined): string {
  if (value && (TRAINING_CATEGORIES as readonly string[]).includes(value)) return value;
  const lower = (value ?? "").toLowerCase();
  if (lower.includes("strength")) return "GENERAL STRENGTH & MOBILITY";
  if (lower.includes("conditioning") || lower.includes("endurance")) return "ENDURANCE";
  if (lower.includes("skill") || lower.includes("technique")) return "TECHNIQUE / COORDINATION DRILLS";
  if (lower.includes("mobility")) return "GENERAL STRENGTH & MOBILITY";
  if (lower.includes("rest")) return "ACTIVE REST / REST";
  return TRAINING_CATEGORIES[0];
}

function makeSessionForms(card: DailyCard): Record<SessionSlot, SessionForm> {
  return SESSION_SLOTS.reduce((acc, slot) => {
    const session = card.sessions[slot];
    const rpe = card.rpeEntries?.[slot] ?? null;
    acc[slot] = {
      status: cleanStatus(session.status),
      workoutType: session.workoutType ?? session.type ?? WORKOUT_TYPES[0],
      sets: session.sets == null ? "" : String(session.sets),
      reps: session.reps ?? "",
      actualDurationMin: session.actualDurationMin == null ? "" : String(session.actualDurationMin),
      effortRating: session.effortRating ?? rpe?.rpe ?? 6,
      notes: session.notes ?? "",
      trainingCategory: rpe?.trainingCategory ?? session.workoutType ?? session.type ?? TRAINING_CATEGORIES[0],
      plannedIntensityPercent: rpe?.plannedIntensityPercent ?? Math.min(100, Math.max(0, (session.intensityRpe ?? 7) * 10)),
      rpe: rpe?.rpe ?? session.effortRating ?? 6,
      sleepQuality: wellnessTenFromStored(rpe?.sleepQuality ?? card.sleep.quality),
      soreness: wellnessTenFromStored(rpe?.muscleSoreness ?? card.soreness),
      fatigue: wellnessTenFromStored(rpe?.fatigue),
      moodMotivation: wellnessTenFromStored(rpe?.moodMotivation),
      restingHeartRate: "",
    };
    return acc;
  }, {} as Record<SessionSlot, SessionForm>);
}

function sessionComplete(session: DailySession): boolean {
  return (
    session.status === "completed" ||
    session.status === "skipped" ||
    session.status === "rest" ||
    session.attended === true
  );
}

function statusText(session: DailySession): string {
  if (session.workoutType && session.status === "completed") return `${session.workoutType} done`;
  if (session.status) return session.status.replace("_", " ");
  return session.type ? "planned" : "open";
}

function sessionVisualStatus(session: DailySession, rpe: RpeEntry | null, isRestDay: boolean): "Open" | "Completed" | "Partial" | "Missed" | "Rest" {
  if (isRestDay || session.status === "rest") return "Rest";
  if (session.status === "completed" || session.attended === true || rpe) return "Completed";
  if (session.status === "in_progress") return "Partial";
  if (session.status === "skipped") return "Missed";
  return "Open";
}

function AnimatedLogProgress({ value }: { value: number }) {
  const progress = Math.max(0, Math.min(100, value));

  return (
    <View style={styles.logProgressTrack}>
      <View style={[styles.logProgressFill, { width: `${progress}%` }]} />
    </View>
  );
}

function HydrationInline({ date }: { date: string }) {
  const [day, setDay] = useState<WaterDay | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setDay(await apiJson<WaterDay>(`/api/athlete/water?date=${date}`));
    } catch {
      // Keep the row usable even if the optional hydration fetch fails.
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  async function add(amountMl: number) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await apiFetch("/api/athlete/water", {
        method: "POST",
        body: JSON.stringify({ date, amountMl }),
      });
      if (res.ok) setDay(await res.json());
    } finally {
      setBusy(false);
    }
  }

  const total = day?.totalMl ?? 0;
  const goal = day?.goalMl ?? 3000;
  const pct = Math.min(100, Math.round((total / goal) * 100));

  return (
    <View>
      <View style={styles.hydrationHeader}>
        <Text style={styles.hydrationTotal}>
          {litres(total)}
          <Text style={styles.hydrationUnit}> / {litres(goal)} L</Text>
        </Text>
        <Text style={styles.hydrationPct}>{pct}%</Text>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: total >= goal ? colors.ok : "#ff7e1a" }]} />
      </View>
      <View style={styles.quickWaterGrid}>
        {[250, 500, 750].map((ml) => (
          <Pressable key={ml} disabled={busy} onPress={() => add(ml)} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>+{ml} ml</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function SessionLogSection({
  card,
  wellness,
  setWellness,
  recoveryModalities,
  toggleRecovery,
  submitWellness,
  postJson,
  date,
  focusedSlot,
  onActiveSlotChange,
  registerAskAction,
}: {
  card: DailyCard;
  wellness: WellnessForm;
  setWellness: React.Dispatch<React.SetStateAction<WellnessForm>>;
  recoveryModalities: string[];
  toggleRecovery: (value: string) => void;
  submitWellness: () => Promise<{ ok: boolean; message: string }>;
  postJson: (path: string, body: unknown, success: string) => Promise<{ ok: boolean; message: string }>;
  date: string;
  focusedSlot: SessionSlot | null;
  onActiveSlotChange: (slot: SessionSlot) => void;
  /** Registers "press <button>" handlers the Ask Agent can invoke by id (see pressAskButton in AthleteDashboard). */
  registerAskAction: (id: string, fn: () => void | boolean | Promise<void | boolean>) => () => void;
}) {
  const [forms, setForms] = useState<Record<SessionSlot, SessionForm>>(() => makeSessionForms(card));
  const [formError, setFormError] = useState<string | null>(null);
  const [sessionPhotos, setSessionPhotos] = useState<Record<SessionSlot, SessionPhotoMeta[]>>({ AM: [], AFT: [], PM: [] });
  const [pendingPhoto, setPendingPhoto] = useState<Partial<Record<SessionSlot, { uri: string; name: string; mimeType: string }>>>({});
  const [uploadingSlot, setUploadingSlot] = useState<SessionSlot | null>(null);
  const isRestDay = Boolean(card.isRestDay || card.attendance.status === "rest");
  const checkinDone = card.readinessScore !== null || card.sleep.quality !== null;
  const completedWeight = isRestDay ? 1 : SESSION_SLOTS.filter((slot) => sessionComplete(card.sessions[slot])).length;
  const requiredWeight = isRestDay ? 1 : SESSION_SLOTS.length;
  const progress = requiredWeight ? (completedWeight / requiredWeight) * 100 : 100;
  const firstSession = SESSION_SLOTS.find((slot) => !sessionComplete(card.sessions[slot]));
  const firstUnfinished = firstSession ? `session:${firstSession}` : null;
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [activeSlot, setActiveSlot] = useState<SessionSlot>(focusedSlot ?? firstSession ?? SESSION_SLOTS[0]);
  const recDone = card.recovery.score !== null || !!card.recovery.status;

  useEffect(() => {
    setForms(makeSessionForms(card));
  }, [card]);

  useEffect(() => {
    const nextSlot = focusedSlot ?? firstSession ?? SESSION_SLOTS[0];
    setActiveSlot(nextSlot);
    onActiveSlotChange(nextSlot);
    setOpenKey(null);
  }, [date, focusedSlot, firstSession, onActiveSlotChange]);

  useEffect(() => {
    if (focusedSlot) {
      setActiveSlot(focusedSlot);
      onActiveSlotChange(focusedSlot);
    }
  }, [focusedSlot, onActiveSlotChange]);

  useEffect(() => {
    onActiveSlotChange(activeSlot);
  }, [activeSlot, onActiveSlotChange]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        SESSION_SLOTS.map(async (slot) => {
          try {
            const json = await apiJson<{ session?: { photos?: SessionPhotoMeta[] } | null }>(
              `/api/athlete/training/${slot}?date=${date}`
            );
            return [slot, json.session?.photos ?? []] as const;
          } catch {
            return [slot, []] as const;
          }
        })
      );
      if (!cancelled) setSessionPhotos(Object.fromEntries(entries) as Record<SessionSlot, SessionPhotoMeta[]>);
    })();
    return () => {
      cancelled = true;
    };
  }, [date]);

  async function pickSessionPhoto(slot: SessionSlot) {
    const result = await DocumentPicker.getDocumentAsync({ type: "image/*" });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setPendingPhoto((prev) => ({
      ...prev,
      [slot]: { uri: asset.uri, name: asset.name ?? "photo.jpg", mimeType: asset.mimeType ?? "image/jpeg" },
    }));
  }

  function clearSessionPhoto(slot: SessionSlot) {
    setPendingPhoto((prev) => {
      const next = { ...prev };
      delete next[slot];
      return next;
    });
  }

  async function uploadSessionPhoto(slot: SessionSlot) {
    const pending = pendingPhoto[slot];
    if (!pending) return;
    setUploadingSlot(slot);
    try {
      const form = new FormData();
      form.append("date", date);
      form.append("file", { uri: pending.uri, name: pending.name, type: pending.mimeType } as unknown as Blob);
      const res = await apiFetch(`/api/athlete/training/${slot}/photos`, { method: "POST", body: form });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setFormError(
          json?.error === "file_too_large"
            ? "That image is too large."
            : json?.error === "unsupported_file_type"
              ? "Please choose a JPG, PNG, or WEBP image."
              : "Photo upload failed."
        );
        return;
      }
      const json = (await res.json()) as { photo: SessionPhotoMeta };
      clearSessionPhoto(slot);
      setSessionPhotos((prev) => ({ ...prev, [slot]: [...(prev[slot] ?? []), json.photo] }));
    } finally {
      setUploadingSlot(null);
    }
  }

  function toggle(key: string) {
    setOpenKey((cur) => (cur === key ? null : key));
  }

  function updateSession(slot: SessionSlot, patch: Partial<SessionForm>) {
    setForms((current) => ({ ...current, [slot]: { ...current[slot], ...patch } }));
  }

  function numberField(raw: string, label: string, min: number, max: number): number | undefined | false {
    if (!raw.trim()) return undefined;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < min || value > max) {
      setFormError(`${label} must be ${min}-${max}.`);
      return false;
    }
    return value;
  }

  async function saveSession(slot: SessionSlot) {
    setFormError(null);
    const form = forms[slot];
    const actualDurationMin = numberField(form.actualDurationMin, "Duration", 0, 600);
    if (actualDurationMin === false) return false;
    const restingHeartRate = numberField(form.restingHeartRate, "Resting heart rate", 20, 220);
    if (restingHeartRate === false) return false;
    const trainingCategory = normalizeTrainingCategory(form.workoutType || form.trainingCategory);

    const trainingPayload: Record<string, unknown> = {
      date,
      status: form.status,
      workoutType: form.workoutType,
      effortRating: form.effortRating,
      notes: form.notes,
    };
    if (form.status === "completed") trainingPayload.attended = true;
    if (form.status === "skipped") trainingPayload.attended = false;
    if (actualDurationMin !== undefined) trainingPayload.actualDurationMin = actualDurationMin;

    const savedTraining = await postJson(
      `/api/athlete/training/${slot}`,
      trainingPayload,
      `${SLOT_LABEL[slot]} session saved.`
    );
    if (!savedTraining.ok || form.status === "skipped" || form.status === "rest") return savedTraining.ok;

    const savedRpe = await postJson(
      "/api/athlete/rpe-monitoring",
      {
        date,
        sessionType: slot,
        trainingCategory,
        plannedIntensityPercent: form.plannedIntensityPercent,
        rpe: form.rpe,
        sleepQuality: wellnessStoredFromTen(form.sleepQuality),
        muscleSoreness: wellnessStoredFromTen(form.soreness),
        fatigue: wellnessStoredFromTen(form.fatigue),
        moodMotivation: wellnessStoredFromTen(form.moodMotivation),
        ...(restingHeartRate !== undefined ? { restingHeartRate } : {}),
      },
      `${SLOT_LABEL[slot]} RPE logged.`
    );
    return savedRpe.ok;
  }

  // Re-registers on every render so the Ask Agent always presses using the
  // CURRENT on-screen form values, not a stale closure from mount time.
  useEffect(() => {
    const unregister = [
      registerAskAction("press:save-am", () => saveSession("AM")),
      registerAskAction("press:save-aft", () => saveSession("AFT")),
      registerAskAction("press:save-pm", () => saveSession("PM")),
    ];
    return () => unregister.forEach((fn) => fn());
  });

  const checkinStatus = card.readinessScore !== null ? `Readiness ${card.readinessScore}` : checkinDone ? "Logged" : "Required";
  const progressDone = progress >= 100;
  const activeSession = card.sessions[activeSlot];
  const activeForm = forms[activeSlot];
  const activeRpe = card.rpeEntries?.[activeSlot] ?? null;
  const activeDone = isRestDay || sessionComplete(activeSession);
  const { width } = useWindowDimensions();
  const nativeCompact = Platform.OS !== "web";
  const fieldRow = width >= 380;
  const notesSideBySide = width >= 360;

  return (
    <View style={[styles.stack, nativeCompact ? styles.logStackNative : null]}>
      <Card style={[styles.logHub, nativeCompact ? styles.logHubNative : null]}>
        <View style={[styles.logHubHead, nativeCompact ? styles.logHubHeadNative : null]}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <CardTitle style={nativeCompact ? styles.logTitleNative : undefined}>{"Today's log"}</CardTitle>
            <View style={[styles.logProgressLine, nativeCompact ? styles.logProgressLineNative : null]}>
              <AnimatedLogProgress value={progress} />
              <Text style={[styles.logProgressText, progressDone ? styles.logProgressTextDone : null]}>
                {progress.toFixed(1)}%
              </Text>
            </View>
          </View>
          <View style={[styles.logProgressPill, nativeCompact ? styles.logProgressPillNative : null, progressDone ? styles.logProgressPillDone : null]}>
            <Text style={[styles.logProgressText, progressDone ? styles.logProgressTextDone : null]}>
              {progressDone ? "Done" : `${completedWeight}/${requiredWeight}`}
            </Text>
          </View>
        </View>

        <View style={[styles.restDayPanel, nativeCompact ? styles.restDayPanelNative : null]}>
          <View style={[styles.restIconBadge, isRestDay ? styles.restIconBadgeOn : null]}>
            <Ionicons name={isRestDay ? "moon" : "moon-outline"} size={nativeCompact ? 17 : 18} color={isRestDay ? "#ffffff" : colors.inkMuted} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.restDayTitle, nativeCompact ? styles.restDayTitleNative : null]}>Rest day</Text>
            <Text style={[styles.restDayText, nativeCompact ? styles.restDayTextNative : null]}>Sessions pause; check-in and recovery stay available.</Text>
          </View>
          <Pressable
            onPress={() =>
              postJson(
                "/api/athlete/rest-day",
                { date, enabled: !isRestDay },
                isRestDay ? "Rest day cleared." : "Rest day saved."
              )
            }
            style={[styles.restToggle, nativeCompact ? styles.restToggleNative : null, isRestDay ? styles.restToggleOn : null]}
            accessibilityRole="switch"
            accessibilityState={{ checked: isRestDay }}
          >
            <Ionicons name={isRestDay ? "checkmark" : "moon-outline"} size={nativeCompact ? 13 : 16} color={isRestDay ? "#ffffff" : colors.inkMuted} />
          </Pressable>
        </View>

        <View style={[styles.sessionTabs, nativeCompact ? styles.sessionTabsNative : null]}>
          {SESSION_SLOTS.map((slot) => {
            const session = card.sessions[slot];
            const rpe = card.rpeEntries?.[slot] ?? null;
            const selected = activeSlot === slot;
            const done = isRestDay || Boolean(rpe) || sessionComplete(session);
            const title = isRestDay ? "Rest day" : session.workoutType ?? session.type ?? rpe?.trainingCategory ?? "Training";
            const visualStatus = sessionVisualStatus(session, rpe, isRestDay);
            return (
              <Pressable
                key={slot}
                onPress={() => {
                  setActiveSlot(slot);
                  onActiveSlotChange(slot);
                }}
                style={[styles.sessionTab, nativeCompact ? styles.sessionTabNative : null, selected ? styles.sessionTabActive : null, done ? styles.sessionTabDone : null]}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
              >
                <View style={styles.sessionTabTop}>
                  <Text style={[styles.sessionTabLabel, selected ? styles.sessionTabLabelActive : null]}>{SLOT_LABEL[slot]}</Text>
                  {selected ? (
                    <View style={styles.sessionTabCheck}>
                      <Ionicons name="checkmark" size={9} color="#ffffff" />
                    </View>
                  ) : null}
                </View>
                <Text style={styles.sessionTabTitle} numberOfLines={1}>{title}</Text>
                <View style={styles.sessionTabStatusPill}>
                  <Text style={styles.sessionTabMeta}>{visualStatus}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        {isRestDay ? (
          <View style={[styles.sessionFormPanel, nativeCompact ? styles.sessionFormPanelNative : null]}>
            <Text style={styles.sessionFormTitle}>Rest day is on</Text>
            <Text style={styles.miniMuted}>AM, Afternoon, and PM training inputs are paused for this date.</Text>
          </View>
        ) : (
          <View style={[styles.sessionFormPanel, nativeCompact ? styles.sessionFormPanelNative : null]}>
            <View style={styles.sessionMetaRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={styles.sessionFormTitleRow}>
                  <Ionicons name="partly-sunny-outline" size={nativeCompact ? 14 : 16} color="#ff6b10" />
                  <Text style={[styles.sessionFormTitle, nativeCompact ? styles.sessionFormTitleNative : null]}>{SLOT_LABEL[activeSlot]} session</Text>
                </View>
                <Text style={styles.miniMuted}>
                  Planned: {activeSession.type ?? "open"}
                  {activeSession.durationMin ? ` - ${activeSession.durationMin} min` : ""}
                </Text>
              </View>
              {activeRpe ? <Chip band={activeRpe.riskFlag}>{activeRpe.riskFlag}</Chip> : null}
            </View>

            <Text style={styles.inputLabel}>Completion</Text>
            <View style={[styles.choiceGrid, nativeCompact ? styles.choiceGridCompact : null]}>
              {TRAINING_STATUS.map((o) => (
                <Choice
                  key={o.value}
                  label={o.label}
                  selected={activeForm.status === o.value}
                  onPress={() => updateSession(activeSlot, { status: o.value })}
                  compact={nativeCompact}
                />
              ))}
            </View>

            <View style={[styles.logFieldRow, fieldRow ? null : styles.logFieldRowStacked]}>
              <View style={fieldRow ? styles.logWorkoutField : styles.logFieldFull}>
                <Text style={styles.inputLabel}>Workout type</Text>
                <Dropdown
                  value={activeForm.workoutType}
                  options={WORKOUT_TYPES}
                  title="Workout type"
                  compact={nativeCompact}
                  onChange={(item) => updateSession(activeSlot, { workoutType: item, trainingCategory: item })}
                />
              </View>
              <View style={fieldRow ? styles.logSmallField : styles.logFieldFull}>
                <Text style={styles.inputLabel}>Duration</Text>
                <TextField
                  value={activeForm.actualDurationMin}
                  onChangeText={(v) => updateSession(activeSlot, { actualDurationMin: v })}
                  placeholder="min"
                  keyboardType="number-pad"
                  style={[styles.compactField, nativeCompact ? styles.logTextFieldNative : null]}
                />
              </View>
              <View style={fieldRow ? styles.logSmallField : styles.logFieldFull}>
                <Text style={styles.inputLabel}>Resting HR</Text>
                <TextField
                  value={activeForm.restingHeartRate}
                  onChangeText={(v) => updateSession(activeSlot, { restingHeartRate: v })}
                  placeholder="optional"
                  keyboardType="number-pad"
                  style={[styles.compactField, nativeCompact ? styles.logTextFieldNative : null]}
                />
              </View>
            </View>

            <View style={styles.logScaleStack}>
              <CompactScale label="Effort" icon="flash-outline" iconColor={LOG_SCALE_ORANGE} value={activeForm.effortRating} onChange={(v) => updateSession(activeSlot, { effortRating: v })} lowHint="Easy" highHint="Max" min={1} max={10} compactCard={nativeCompact} />
              <CompactScale label="Planned intensity" icon="bar-chart" value={activeForm.plannedIntensityPercent} onChange={(v) => updateSession(activeSlot, { plannedIntensityPercent: v })} lowHint="0%" highHint="100%" min={0} max={100} step={5} compactCard={nativeCompact} />
              <CompactScale label="Session RPE" icon="speedometer-outline" value={activeForm.rpe} onChange={(v) => updateSession(activeSlot, { rpe: v })} lowHint="Rest" highHint="Max" min={0} max={10} compactCard={nativeCompact} />
              <CompactScale label="Mood" icon="happy-outline" value={activeForm.moodMotivation} onChange={(v) => updateSession(activeSlot, { moodMotivation: v })} lowHint="Low" highHint="High" min={1} max={10} compactCard={nativeCompact} />
            </View>

            <View style={[styles.twoCols, styles.logDenseScaleRow]}>
              <View style={{ flex: 1 }}>
                <CompactScale label="Soreness" icon="heart-outline" value={activeForm.soreness} onChange={(v) => updateSession(activeSlot, { soreness: v })} lowHint="Fresh" highHint="Sore" min={1} max={10} compactCard={nativeCompact} dense />
              </View>
              <View style={{ flex: 1 }}>
                <CompactScale label="Fatigue" icon="clipboard-outline" value={activeForm.fatigue} onChange={(v) => updateSession(activeSlot, { fatigue: v })} lowHint="Rested" highHint="Spent" min={1} max={10} compactCard={nativeCompact} dense />
              </View>
            </View>

            <View style={[styles.logNotesRow, notesSideBySide ? null : styles.logNotesRowStacked]}>
              <View style={styles.logNotesCol}>
                <TextInput
                  value={activeForm.notes}
                  onChangeText={(v) => updateSession(activeSlot, { notes: v })}
                  placeholder="Add notes about how you felt, key takeaways, etc."
                  placeholderTextColor={colors.inkFaint}
                  multiline
                  maxLength={500}
                  style={[styles.noteBox, nativeCompact ? styles.noteBoxNative : null]}
                />
                <Text style={styles.noteCount}>{activeForm.notes.length}/500</Text>
              </View>
              <View style={styles.logPhotoCol}>
                <Pressable onPress={() => pickSessionPhoto(activeSlot)} style={styles.sessionPhotoButton}>
                  {pendingPhoto[activeSlot] ? (
                    <Image source={{ uri: pendingPhoto[activeSlot]!.uri }} style={styles.sessionPhotoPreviewImage} />
                  ) : (
                    <>
                      <Ionicons name="camera-outline" size={20} color={colors.inkMuted} />
                      <Text style={styles.sessionPhotoButtonText}>Add photo</Text>
                    </>
                  )}
                </Pressable>
                {pendingPhoto[activeSlot] ? (
                  <Pressable onPress={() => clearSessionPhoto(activeSlot)} style={styles.sessionPhotoPreviewRemove} hitSlop={8}>
                    <Ionicons name="close" size={13} color={colors.inkMuted} />
                  </Pressable>
                ) : null}
              </View>
            </View>

            <View style={styles.sessionPhotoRow}>
              {(sessionPhotos[activeSlot] ?? []).map((p) => (
                <SessionPhotoThumb key={p.id} slot={activeSlot} photoId={p.id} />
              ))}
              {pendingPhoto[activeSlot] ? (
                <CompactButton
                  label={uploadingSlot === activeSlot ? "Uploading" : "Save photo"}
                  onPress={() => uploadSessionPhoto(activeSlot)}
                  disabled={uploadingSlot === activeSlot}
                  successLabel="Saved"
                />
              ) : null}
            </View>

            {activeRpe ? (
              <Text style={[styles.miniMuted, { marginTop: 8 }]}>
                Load {activeRpe.calculatedTrainingLoad} - readiness {activeRpe.readinessScore ?? "-"}
              </Text>
            ) : null}
            {formError ? <Text style={styles.formError}>{formError}</Text> : null}
            <View style={styles.logSaveWrap}>
              <CompactButton label={`Save ${SLOT_LABEL[activeSlot]}`} onPress={() => saveSession(activeSlot)} successLabel="Saved" />
            </View>
          </View>
        )}

        {false ? (
          <>
        <LogRow title="Daily check-in" status={checkinStatus} done={checkinDone} open={openKey === "checkin"} onToggle={() => toggle("checkin")}>
          <Text style={styles.inputLabel}>Sleep hours</Text>
          <TextField
            value={wellness.sleepHours}
            onChangeText={(v) => setWellness((s) => ({ ...s, sleepHours: v }))}
            placeholder="e.g. 8"
            keyboardType="decimal-pad"
            style={styles.compactField}
          />
          <View style={{ height: 12 }} />
          {[
            ["sleepQuality", "Sleep quality", "Poor", "Great"],
            ["mood", "Mood", "Low", "High"],
            ["stress", "Stress", "Calm", "Tense"],
            ["soreness", "Soreness", "Fresh", "Sore"],
            ["fatigue", "Fatigue", "Rested", "Spent"],
          ].map(([key, label, low, high]) => (
            <View key={key} style={{ marginBottom: 10 }}>
              <CompactScale
                label={label}
                value={Number(wellness[key as keyof WellnessForm])}
                onChange={(v) => setWellness((s) => ({ ...s, [key]: String(v) }))}
                lowHint={low}
                highHint={high}
              />
            </View>
          ))}
          <CompactButton label="Save check-in" onPress={() => submitWellness().then((r) => r.ok)} successLabel="Saved" />
        </LogRow>

        {SESSION_SLOTS.map((slot) => {
          const session = card.sessions[slot];
          const done = isRestDay || sessionComplete(session);
          const form = forms[slot];
          const rpe = card.rpeEntries?.[slot] ?? null;
          return (
            <LogRow
              key={slot}
              title={`${SLOT_LABEL[slot]} session`}
              status={isRestDay ? "Rest day" : statusText(session)}
              done={done}
              open={!isRestDay && openKey === `session:${slot}`}
              onToggle={() => (isRestDay ? undefined : toggle(`session:${slot}`))}
            >
              <View style={styles.sessionMetaRow}>
                <Text style={styles.miniMuted}>
                  Planned: {session.type ?? "open"}
                  {session.durationMin ? ` · ${session.durationMin} min` : ""}
                </Text>
                {rpe ? <Chip band={rpe.riskFlag}>{rpe.riskFlag}</Chip> : null}
              </View>

              <Text style={styles.inputLabel}>Completion</Text>
              <View style={styles.choiceGrid}>
                {TRAINING_STATUS.map((o) => (
                  <Choice key={o.value} label={o.label} selected={form.status === o.value} onPress={() => updateSession(slot, { status: o.value })} />
                ))}
              </View>

              <Text style={[styles.inputLabel, { marginTop: 14 }]}>Workout type</Text>
              <Dropdown
                value={form.workoutType}
                options={WORKOUT_TYPES}
                title="Workout type"
                onChange={(item) => updateSession(slot, { workoutType: item })}
              />

              <View style={[styles.twoCols, { marginTop: 12 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.inputLabel}>Sets</Text>
                  <TextField value={form.sets} onChangeText={(v) => updateSession(slot, { sets: v })} placeholder="e.g. 4" keyboardType="number-pad" style={styles.compactField} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.inputLabel}>Reps / distance</Text>
                  <TextField value={form.reps} onChangeText={(v) => updateSession(slot, { reps: v })} placeholder="100m" style={styles.compactField} />
                </View>
              </View>

              <View style={[styles.twoCols, { marginTop: 12 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.inputLabel}>Duration</Text>
                  <TextField value={form.actualDurationMin} onChangeText={(v) => updateSession(slot, { actualDurationMin: v })} placeholder="min" keyboardType="number-pad" style={styles.compactField} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.inputLabel}>Resting HR</Text>
                  <TextField value={form.restingHeartRate} onChangeText={(v) => updateSession(slot, { restingHeartRate: v })} placeholder="optional" keyboardType="number-pad" style={styles.compactField} />
                </View>
              </View>

              <View style={{ marginTop: 12 }}>
                <CompactScale label="Effort" value={form.effortRating} onChange={(v) => updateSession(slot, { effortRating: v, rpe: v })} lowHint="Easy" highHint="Max" min={1} max={10} />
              </View>

              <Text style={[styles.inputLabel, { marginTop: 14 }]}>RPE category</Text>
              <Dropdown
                value={form.trainingCategory}
                options={categoryChoicesFor(form.trainingCategory)}
                title="RPE category"
                onChange={(category) => updateSession(slot, { trainingCategory: category })}
              />

              <View style={{ marginTop: 12 }}>
                <CompactScale label="Planned intensity" value={form.plannedIntensityPercent} onChange={(v) => updateSession(slot, { plannedIntensityPercent: v })} lowHint="0%" highHint="100%" min={0} max={100} />
              </View>
              <View style={{ marginTop: 12 }}>
                <CompactScale label="Session RPE" value={form.rpe} onChange={(v) => updateSession(slot, { rpe: v, effortRating: v })} lowHint="Rest" highHint="Max" min={0} max={10} />
              </View>

              <View style={[styles.twoCols, { marginTop: 12 }]}>
                <View style={{ flex: 1 }}>
                  <CompactScale label="Soreness" value={form.soreness} onChange={(v) => updateSession(slot, { soreness: v })} lowHint="Fresh" highHint="Sore" />
                </View>
                <View style={{ flex: 1 }}>
                  <CompactScale label="Fatigue" value={form.fatigue} onChange={(v) => updateSession(slot, { fatigue: v })} lowHint="Rested" highHint="Spent" />
                </View>
              </View>

              <View style={[styles.twoCols, { marginTop: 12 }]}>
                <View style={{ flex: 1 }}>
                  <CompactScale label="Sleep" value={form.sleepQuality} onChange={(v) => updateSession(slot, { sleepQuality: v })} lowHint="Poor" highHint="Great" />
                </View>
                <View style={{ flex: 1 }}>
                  <CompactScale label="Mood" value={form.moodMotivation} onChange={(v) => updateSession(slot, { moodMotivation: v })} lowHint="Low" highHint="High" />
                </View>
              </View>

              <TextInput
                value={form.notes}
                onChangeText={(v) => updateSession(slot, { notes: v })}
                placeholder="Optional session notes"
                placeholderTextColor={colors.inkFaint}
                multiline
                style={[styles.noteBox, { marginTop: 12 }]}
              />

              <View style={styles.sessionPhotoRow}>
                {(sessionPhotos[slot] ?? []).map((p) => (
                  <SessionPhotoThumb key={p.id} slot={slot} photoId={p.id} />
                ))}
                {pendingPhoto[slot] ? (
                  <View style={styles.sessionPhotoPreviewRow}>
                    <Image source={{ uri: pendingPhoto[slot]!.uri }} style={styles.sessionPhotoPreviewImage} />
                    <Pressable onPress={() => clearSessionPhoto(slot)} style={styles.sessionPhotoPreviewRemove} hitSlop={8}>
                      <Ionicons name="close" size={13} color={colors.inkMuted} />
                    </Pressable>
                  </View>
                ) : (
                  <Pressable onPress={() => pickSessionPhoto(slot)} style={styles.sessionPhotoButton}>
                    <Ionicons name="add" size={18} color={colors.inkFaint} />
                    <Text style={styles.sessionPhotoButtonText}>Photo</Text>
                  </Pressable>
                )}
                {pendingPhoto[slot] ? (
                  <CompactButton
                    label={uploadingSlot === slot ? "Uploading" : "Save photo"}
                    onPress={() => uploadSessionPhoto(slot)}
                    disabled={uploadingSlot === slot}
                    successLabel="Saved"
                  />
                ) : null}
              </View>

              {rpe ? (
                <Text style={[styles.miniMuted, { marginTop: 8 }]}>
                  Load {rpe.calculatedTrainingLoad} · readiness {rpe.readinessScore ?? "-"}
                </Text>
              ) : null}
              {formError ? <Text style={styles.formError}>{formError}</Text> : null}
              <View style={{ marginTop: 12 }}>
                <CompactButton label="Save session" onPress={() => saveSession(slot)} successLabel="Saved" />
              </View>
            </LogRow>
          );
        })}

        <LogRow title="Hydration" status="Optional" done={false} open={openKey === "hydration"} onToggle={() => toggle("hydration")}>
          <HydrationInline date={date} />
        </LogRow>
          </>
        ) : null}

        {false ? (
        <LogRow title="Recovery" status={recDone ? card.recovery.status ?? `${card.recovery.score}` : "Optional"} done={recDone} open={openKey === "recovery"} onToggle={() => toggle("recovery")}>
          <View style={styles.recoveryWrap}>
            {RECOVERY_OPTIONS.map((item) => {
              const value = item.toLowerCase().replace(/\s+/g, "_");
              const on = recoveryModalities.includes(value);
              return (
                <Pressable key={item} onPress={() => toggleRecovery(value)} style={[styles.recoveryChip, on ? styles.recoveryChipOn : null]}>
                  <Text style={[styles.recoveryText, on ? styles.recoveryTextOn : null]}>{item}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={{ marginTop: 12 }}>
            <CompactButton label="Save recovery" onPress={() => postJson("/api/athlete/recovery", { date, modalities: recoveryModalities }, "Recovery saved.").then((r) => r.ok)} successLabel="Saved" />
          </View>
        </LogRow>
        ) : null}

      </Card>
    </View>
  );
}

/** Renders one session photo from a Bearer-authenticated, self-scoped image endpoint. */
function SessionPhotoThumb({ slot, photoId }: { slot: SessionSlot; photoId: string }) {
  const token = getAccessToken();
  return (
    <Image
      source={{
        uri: `${API_BASE}/api/athlete/training/${slot}/photos/${photoId}/file`,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      }}
      style={styles.sessionPhotoThumb}
      resizeMode="cover"
    />
  );
}

function LogSection({
  card,
  wellness,
  setWellness,
  hrForm,
  setHrForm,
  recoveryModalities,
  toggleRecovery,
  noteDraft,
  setNoteDraft,
  notes,
  submitWellness,
  submitHeartRate,
  submitNote,
  postJson,
  date,
}: {
  card: DailyCard;
  wellness: WellnessForm;
  setWellness: React.Dispatch<React.SetStateAction<WellnessForm>>;
  hrForm: { wakeHr: string; bedHr: string };
  setHrForm: React.Dispatch<React.SetStateAction<{ wakeHr: string; bedHr: string }>>;
  recoveryModalities: string[];
  toggleRecovery: (value: string) => void;
  noteDraft: string;
  setNoteDraft: (v: string) => void;
  notes: AthleteNote[];
  submitWellness: () => Promise<boolean>;
  submitHeartRate: () => Promise<boolean>;
  submitNote: () => Promise<boolean>;
  postJson: (path: string, body: unknown, success: string) => Promise<boolean>;
  date: string;
}) {
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  // Per-entry "done" state drives the at-a-glance checklist + progress count.
  const checkinDone = card.readinessScore !== null || card.sleep.quality !== null;
  const loggedSlots = SESSION_SLOTS.filter((s) => card.sessions[s].status);
  const trainDone = loggedSlots.length > 0;
  const hr = card.heartRate;
  const hrDone = hr.wakeHr !== null || hr.bedHr !== null;
  const recDone = card.recovery.score !== null || !!card.recovery.status;
  const notesDone = notes.length > 0;

  // Attendance isn't logged here anymore — it's derived from session/RPE activity.
  const ENTRIES = [checkinDone, trainDone, hrDone, recDone, notesDone];
  const total = ENTRIES.length;
  const doneCount = ENTRIES.filter(Boolean).length;
  const keys = ["checkin", "training", "heart", "recovery", "notes"];
  const firstUnfinished = keys[ENTRIES.findIndex((d) => !d)] ?? null;

  const [openKey, setOpenKey] = useState<string | null>(firstUnfinished);
  const toggle = (key: string) => setOpenKey((cur) => (cur === key ? null : key));

  const checkinStatus = card.readinessScore !== null ? `Readiness ${card.readinessScore}` : checkinDone ? "Logged" : "Not logged";
  const trainStatus = trainDone ? `${loggedSlots.length}/${SESSION_SLOTS.length} logged` : "Not logged";
  const hrStatus = hrDone ? `${hr.wakeHr ?? "–"} / ${hr.bedHr ?? "–"} bpm` : "Not logged";
  const recStatus = card.recovery.status ? cap(card.recovery.status) : recDone ? `${card.recovery.score}` : "Not logged";
  const notesStatus = notesDone ? `${notes.length} note${notes.length === 1 ? "" : "s"}` : "Not logged";

  return (
    <View style={styles.stack}>
      <Card style={styles.logHub}>
        <View style={styles.logHubHead}>
          <CardTitle>{"Today's log"}</CardTitle>
          <View style={[styles.logProgressPill, doneCount === total ? styles.logProgressPillDone : null]}>
            <Text style={[styles.logProgressText, doneCount === total ? styles.logProgressTextDone : null]}>
              {doneCount === total ? "All done" : `${doneCount} of ${total} done`}
            </Text>
          </View>
        </View>

        <LogRow title="Daily wellness" status={checkinStatus} done={checkinDone} open={openKey === "checkin"} onToggle={() => toggle("checkin")}>
          {[
            ["mood", "Mood", "Low", "High"],
            ["stress", "Stress", "Calm", "Tense"],
            ["soreness", "Soreness", "Fresh", "Sore"],
            ["fatigue", "Fatigue", "Rested", "Spent"],
          ].map(([key, label, low, high]) => (
            <View key={key} style={{ marginBottom: 10 }}>
              <CompactScale
                label={label}
                value={Number(wellness[key as keyof WellnessForm])}
                onChange={(v) => setWellness((s) => ({ ...s, [key]: String(v) }))}
                lowHint={low}
                highHint={high}
              />
            </View>
          ))}
          <CompactButton label="Save check-in" onPress={submitWellness} successLabel="Saved" />
        </LogRow>

        <LogRow title="Training completion" status={trainStatus} done={trainDone} open={openKey === "training"} onToggle={() => toggle("training")}>
          <View style={styles.stackSmall}>
            {SESSION_SLOTS.map((slot) => (
              <View key={slot}>
                <Text style={styles.tileLabel}>{SLOT_LABEL[slot]}{card.sessions[slot].type ? ` · ${card.sessions[slot].type}` : ""}</Text>
                <View style={[styles.choiceGrid, { marginTop: 6 }]}>
                  {TRAINING_STATUS.map((o) => (
                    <Choice
                      key={o.value}
                      label={o.label}
                      selected={card.sessions[slot].status === o.value}
                      onPress={() => postJson(`/api/athlete/training/${slot}`, { date, status: o.value }, `${slot} session: ${o.value}.`)}
                    />
                  ))}
                </View>
              </View>
            ))}
          </View>
        </LogRow>

        <LogRow title="Heart rate" status={hrStatus} done={hrDone} open={openKey === "heart"} onToggle={() => toggle("heart")}>
          <Muted style={{ marginBottom: 10 }}>Resting bpm - log on waking and before bed.</Muted>
          <View style={styles.twoCols}>
            <View style={{ flex: 1 }}>
              <Text style={styles.inputLabel}>Waking HR</Text>
              <TextField value={hrForm.wakeHr} onChangeText={(v) => setHrForm((s) => ({ ...s, wakeHr: v }))} placeholder="bpm" keyboardType="number-pad" style={styles.compactField} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.inputLabel}>Before bed</Text>
              <TextField value={hrForm.bedHr} onChangeText={(v) => setHrForm((s) => ({ ...s, bedHr: v }))} placeholder="bpm" keyboardType="number-pad" style={styles.compactField} />
            </View>
          </View>
          <View style={{ marginTop: 12 }}>
            <CompactButton label="Save heart rate" onPress={submitHeartRate} successLabel="Saved" />
          </View>
        </LogRow>

        <LogRow title="Recovery" status={recStatus} done={recDone} open={openKey === "recovery"} onToggle={() => toggle("recovery")}>
          <View style={styles.recoveryWrap}>
            {RECOVERY_OPTIONS.map((item) => (
              <Pressable
                key={item}
                onPress={() => toggleRecovery(item.toLowerCase().replace(/\s+/g, "_"))}
                style={[
                  styles.recoveryChip,
                  recoveryModalities.includes(item.toLowerCase().replace(/\s+/g, "_")) ? styles.recoveryChipOn : null,
                ]}
              >
                <Text style={[
                  styles.recoveryText,
                  recoveryModalities.includes(item.toLowerCase().replace(/\s+/g, "_")) ? styles.recoveryTextOn : null,
                ]}>{item}</Text>
              </Pressable>
            ))}
          </View>
          <View style={{ marginTop: 12 }}>
            <CompactButton
              label="Save recovery"
              onPress={() => postJson("/api/athlete/recovery", { date, modalities: recoveryModalities }, "Recovery saved.")}
              successLabel="Saved"
            />
          </View>
        </LogRow>

        <LogRow title="Daily notes" status={notesStatus} done={notesDone} open={openKey === "notes"} onToggle={() => toggle("notes")}>
          <TextInput
            value={noteDraft}
            onChangeText={setNoteDraft}
            placeholder="Anything to log today?"
            placeholderTextColor={colors.inkFaint}
            multiline
            style={styles.noteBox}
          />
          <View style={{ marginTop: 10 }}>
            <CompactButton label="Save note" onPress={submitNote} disabled={!noteDraft.trim()} successLabel="Saved" />
          </View>
          {notes.length > 0 ? (
            <View style={{ marginTop: 12, gap: 8 }}>
              {notes.map((n) => (
                <View key={n._id} style={styles.noteItem}>
                  <Text style={styles.noteText}>{n.body}</Text>
                </View>
              ))}
            </View>
          ) : <Text style={[styles.miniMuted, { marginTop: 10 }]}>No notes today.</Text>}
        </LogRow>
      </Card>
    </View>
  );
}

function LogRow({
  title,
  status,
  done,
  open,
  onToggle,
  children,
}: {
  title: string;
  status: string;
  done: boolean;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.logRowWrap}>
      <Pressable onPress={onToggle} style={styles.logRow}>
        <Ionicons name={done ? "checkmark-circle" : "ellipse-outline"} size={20} color={done ? colors.ok : colors.inkFaint} />
        <Text style={styles.logRowTitle} numberOfLines={1}>{title}</Text>
        <Text style={[styles.logRowStatus, done ? styles.logRowStatusDone : null]} numberOfLines={1}>{status}</Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.inkFaint} />
      </Pressable>
      {open ? <View style={styles.logRowBody}>{children}</View> : null}
    </View>
  );
}

function CoachSection({
  announcements,
  coachComments,
  coachCount,
  activity,
}: {
  announcements: TeamAnnouncement[];
  coachComments: CoachComment[];
  coachCount: number | null;
  activity: FeedItem[];
}) {
  const [activityExpanded, setActivityExpanded] = useState(false);
  const visibleActivity = activityExpanded ? activity : activity.slice(0, 12);
  const canExpandActivity = activity.length > visibleActivity.length;

  return (
    <View style={styles.coachSectionStack}>
      <Card style={styles.coachPanel}>
        <CoachPanelHeader icon="clipboard-outline" title="Coach updates" />
        {announcements.length === 0 ? (
          <CoachEmptyPanel text={coachCount === 0 ? "No coach linked yet. Your personal logs still work here." : "No coach announcements yet."} icon="megaphone-outline" />
        ) : (
          <View style={styles.coachCardList}>
            {announcements.map((a) => (
              <CoachAnnouncementRow key={a.id} announcement={a} />
            ))}
          </View>
        )}
      </Card>

      <Card style={styles.coachPanel}>
        <CoachPanelHeader icon="chatbubble-outline" title="Coach feedback" />
        {coachComments.length === 0 ? (
          <CoachEmptyPanel text={coachCount === 0 ? "Coach feedback appears here after a coach links your profile." : "No coach feedback today."} icon="chatbubble-ellipses-outline" />
        ) : (
          <View style={styles.coachCardList}>
            {coachComments.map((c) => (
              <CoachFeedbackRow key={c._id} comment={c} />
            ))}
          </View>
        )}
      </Card>

      <Card style={[styles.coachPanel, styles.coachActivityPanel]}>
        <View style={styles.coachActivityHeader}>
          <CoachPanelHeader icon="pulse-outline" title="Recent activity" style={styles.coachActivityHeaderTitle} />
          {activity.length > 0 ? (
            <Pressable
              onPress={() => setActivityExpanded((expanded) => !expanded)}
              hitSlop={8}
              style={styles.coachViewAllButton}
              accessibilityRole="button"
              accessibilityLabel={activityExpanded ? "Show fewer recent activity items" : "View all recent activity items"}
            >
              <Text style={styles.coachViewAllText}>{activityExpanded ? "Show less" : "View all"}</Text>
              <Ionicons name={activityExpanded ? "chevron-up" : "chevron-forward"} size={12} color={COACH_SECTION_ORANGE} />
            </Pressable>
          ) : null}
        </View>
        <TimelineFeed items={canExpandActivity ? visibleActivity : activity} compact />
      </Card>
    </View>
  );
}

function CoachPanelHeader({
  icon,
  title,
  style,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  style?: object;
}) {
  return (
    <View style={[styles.coachPanelHeader, style]}>
      <View style={styles.coachHeaderIcon}>
        <Ionicons name={icon} size={12} color={COACH_SECTION_ORANGE} />
      </View>
      <CardTitle style={styles.coachPanelTitle}>{title}</CardTitle>
    </View>
  );
}

function coachAnnouncementIcon(announcement: TeamAnnouncement): keyof typeof Ionicons.glyphMap {
  const body = announcement.body.toLowerCase();
  if (/\bswim|pool|water\b/.test(body)) return "water";
  if (/\bschedule|session|class|week|updated?\b/.test(body)) return "calendar-outline";
  return "megaphone-outline";
}

function CoachAnnouncementRow({ announcement }: { announcement: TeamAnnouncement }) {
  const created = new Date(announcement.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return (
    <View style={styles.coachUpdateRow}>
      <View style={styles.coachUpdateIcon}>
        <Ionicons name={coachAnnouncementIcon(announcement)} size={15} color={COACH_SECTION_ORANGE} />
      </View>
      <View style={styles.coachUpdateCopy}>
        <Text style={styles.coachUpdateBody} numberOfLines={2}>{announcement.body}</Text>
        <Text style={styles.coachUpdateMeta} numberOfLines={1}>{announcement.coachName} · {created}</Text>
      </View>
      <Ionicons name="chevron-forward" size={17} color={colors.inkFaint} />
    </View>
  );
}

function CoachFeedbackRow({ comment }: { comment: CoachComment }) {
  return (
    <View style={styles.coachFeedbackRow}>
      <View style={styles.coachFeedbackIcon}>
        <Ionicons name="chatbubble-ellipses-outline" size={15} color={COACH_SECTION_ORANGE} />
      </View>
      <Text style={styles.coachFeedbackText} numberOfLines={2}>{comment.body}</Text>
      <Ionicons name="chevron-forward" size={17} color={colors.inkFaint} />
    </View>
  );
}

function CoachEmptyPanel({ text, icon }: { text: string; icon: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={styles.coachEmptyPanel}>
      <View style={styles.coachEmptyIcon}>
        <Ionicons name={icon} size={14} color={colors.inkFaint} />
      </View>
      <Text style={styles.coachEmptyText} numberOfLines={2}>{text}</Text>
    </View>
  );
}

function relativeDate(at: string): string {
  const then = new Date(at).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return at.slice(5, 10);
}

function feedDotColor(item: FeedItem): string {
  if (item.band) return bandColor(item.band);
  if (item.kind === "comment" || item.kind === "note") return theme.accentStrong;
  return colors.inkFaint;
}

/** Icon + tone per activity item — kind picks the glyph, band (when present) picks the color. */
function feedIcon(item: FeedItem): { name: keyof typeof Ionicons.glyphMap; tone: string } {
  const tone = feedDotColor(item);
  if (item.kind === "session") {
    if (item.detail === "rest") return { name: "moon", tone: colors.inkFaint };
    if (item.band === "red") return { name: "close-circle", tone };
    return { name: "checkmark-circle", tone };
  }
  if (item.kind === "rpe") return { name: "barbell", tone };
  if (item.kind === "attendance") return { name: "person", tone };
  if (item.kind === "recovery") return { name: "leaf", tone };
  if (item.kind === "comment") return { name: "chatbubble-ellipses", tone };
  if (item.kind === "note") return { name: "document-text", tone };
  if (item.kind === "performance") return { name: "stats-chart", tone };
  if (item.kind === "injury") return { name: "medkit", tone };
  return { name: "ellipse", tone };
}

function TimelineFeed({ items, compact }: { items: FeedItem[]; compact?: boolean }) {
  if (items.length === 0) return compact ? <CoachEmptyPanel text="No recent activity." icon="pulse-outline" /> : <Text style={styles.miniMuted}>No recent activity.</Text>;
  return (
    <View style={[styles.timeline, compact ? styles.timelineCompact : null]}>
      <View style={[styles.timelineLine, compact ? styles.timelineLineCompact : null]} />
      {items.map((item) => {
        const icon = feedIcon(item);
        const detail = item.detail ?? item.subtitle;
        return (
          <View key={item.id} style={[styles.timelineItem, compact ? styles.timelineItemCompact : null]}>
            <View style={[styles.timelineIconBadge, compact ? styles.timelineIconBadgeCompact : null, { backgroundColor: `${icon.tone}1f` }]}>
              <Ionicons name={icon.name} size={compact ? 12 : 16} color={icon.tone} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={styles.timelineTitleRow}>
                <Text style={[styles.timelineTitle, compact ? styles.timelineTitleCompact : null]} numberOfLines={1}>{item.title}</Text>
                <Text style={[styles.timelineTime, compact ? styles.timelineTimeCompact : null]}>{relativeDate(item.at)}</Text>
              </View>
              {detail ? <Text style={[styles.timelineDetail, compact ? styles.timelineDetailCompact : null]} numberOfLines={1}>{detail}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function chatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function chatDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function AthleteMessagesPanel({
  initialCoachId,
  onHeaderChange,
}: {
  initialCoachId: string | null;
  onHeaderChange: (header: MessageHeader) => void;
}) {
  const [coaches, setCoaches] = useState<AssignedCoach[]>([]);
  const [threads, setThreads] = useState<MessageThreadSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialCoachId);
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [loading, setLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [showList, setShowList] = useState(false);

  const parties = useMemo<MessageParty[]>(() => {
    const coachById = new Map(coaches.map((coach) => [coach.coachId, coach]));
    const threadIds = new Set(threads.map((thread) => thread.partyId));
    const threadParties = threads.map((thread) => ({
      id: thread.partyId,
      name: thread.partyName || coachById.get(thread.partyId)?.name || "Coach",
      subtitle: "Coach",
      lastMessage: thread.lastMessage,
      lastAt: thread.lastAt,
      lastSenderRole: thread.lastSenderRole,
      unreadCount: thread.unreadCount,
    }));
    const starters = coaches
      .filter((coach) => !threadIds.has(coach.coachId))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
      .map((coach) => ({ id: coach.coachId, name: coach.name || "Coach", subtitle: "Coach" }));
    return [...threadParties, ...starters];
  }, [coaches, threads]);
  const selectedParty = parties.find((party) => party.id === selectedId) ?? null;

  useEffect(() => {
    onHeaderChange({
      title: showList || !selectedParty ? "Messages" : selectedParty.name,
      subtitle: showList || !selectedParty ? "Direct coach chat" : "Direct message",
    });
  }, [onHeaderChange, selectedParty, showList]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [coachRes, threadRes] = await Promise.all([
        apiJson<{ coaches: AssignedCoach[] }>("/api/athlete/coaches"),
        apiJson<{ threads: MessageThreadSummary[] }>("/api/athlete/messages/threads"),
      ]);
      setCoaches(coachRes.coaches ?? []);
      setThreads(threadRes.threads ?? []);
    } catch {
      setError("Couldn't load messages.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadThread = useCallback(async () => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    setThreadLoading(true);
    setThreadError(null);
    try {
      const res = await apiJson<{ messages: MessageView[]; hasMore: boolean }>(
        `/api/athlete/messages/${selectedId}?limit=50`
      );
      setMessages(res.messages ?? []);
      setThreads((prev) =>
        prev.map((thread) => (thread.partyId === selectedId ? { ...thread, unreadCount: 0 } : thread))
      );
      await apiFetch(`/api/athlete/messages/${selectedId}/read`, { method: "POST" }).catch(() => undefined);
    } catch {
      setMessages([]);
      setThreadError("Couldn't load this conversation.");
    } finally {
      setThreadLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (initialCoachId) setSelectedId(initialCoachId);
  }, [initialCoachId]);

  useEffect(() => {
    if (!selectedId && parties.length > 0) setSelectedId(parties[0].id);
  }, [parties, selectedId]);

  useEffect(() => {
    loadThread();
  }, [loadThread]);

  useEffect(() => {
    if (!selectedParty && parties.length > 0) return;
    setShowList(false);
  }, [parties.length, selectedParty]);

  async function send() {
    const coachId = selectedId;
    const body = draft.trim();
    if (!coachId || !body) return;
    setSending(true);
    setThreadError(null);
    try {
      const res = await apiFetch(`/api/athlete/messages/${coachId}`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      const payload = (await res.json().catch(() => ({}))) as { message?: MessageView };
      if (!res.ok || !payload.message) {
        setThreadError((payload as { message?: string }).message || LINK_COACH_BEFORE_MESSAGE);
        return;
      }
      setDraft("");
      setMessages((prev) => [...prev, payload.message!]);
      await load();
    } catch {
      setThreadError("Network error. Try again.");
    } finally {
      setSending(false);
    }
  }

  const canSend = Boolean(selectedId && draft.trim() && !sending);

  return (
    <View style={styles.directChat}>
      <View style={styles.directTopRow}>
        <Pressable
          onPress={() => {
            if (showList) setShowList(false);
            else setShowList(true);
          }}
          style={styles.directBack}
          accessibilityLabel={showList ? "Back to conversation" : "Back to messages"}
        >
          <Ionicons name="arrow-back" size={18} color={colors.inkMuted} />
        </Pressable>
      </View>

      {showList ? (
        <ScrollView contentContainerStyle={styles.threadPickerList}>
          {loading ? <ActivityIndicator color={theme.accentStrong} /> : null}
          {error ? <Text style={styles.directError}>{error}</Text> : null}
          {!loading && parties.length === 0 ? <Text style={styles.emptyText}>No coach linked yet.</Text> : null}
          {parties.map((party) => (
            <Pressable
              key={party.id}
              onPress={() => {
                setSelectedId(party.id);
                setShowList(false);
              }}
              style={[styles.threadPickerItem, party.id === selectedId ? styles.threadPickerItemOn : null]}
            >
              <View style={[styles.threadAvatar, party.id === selectedId ? styles.threadAvatarOn : null]}>
                <Text style={[styles.threadAvatarText, party.id === selectedId ? styles.threadAvatarTextOn : null]}>
                  {(party.name || "C").slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.threadName} numberOfLines={1}>{party.name}</Text>
                <Text style={styles.threadMeta} numberOfLines={1}>{party.lastMessage || party.subtitle || "Coach"}</Text>
              </View>
              {party.unreadCount ? <View style={styles.threadUnread} /> : null}
            </Pressable>
          ))}
        </ScrollView>
      ) : (
        <>
          <View style={styles.directThread}>
            {threadLoading || (loading && parties.length === 0) ? (
              <ActivityIndicator color={theme.accentStrong} />
            ) : error && parties.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>{error}</Text>
              </View>
            ) : !selectedParty ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>No coach linked yet.</Text>
              </View>
            ) : messages.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>No messages yet</Text>
                <Text style={styles.emptySub}>Say hello to start the conversation.</Text>
              </View>
            ) : (
              <ScrollView contentContainerStyle={styles.directMessageList}>
                {messages.map((message, index) => {
                  const prev = messages[index - 1];
                  const showDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(message.createdAt).toDateString();
                  return (
                    <View key={message.id}>
                      {showDay ? <Text style={styles.dayMarker}>{chatDay(message.createdAt)}</Text> : null}
                      <View style={[styles.messageRow, message.mine ? styles.messageRowMine : null]}>
                        <View style={[styles.messageBubble, message.mine ? styles.messageBubbleMine : styles.messageBubbleOther]}>
                          {message.media ? (
                            <View style={{ marginBottom: message.body ? 6 : 2 }}>
                              <ChatMediaBubble media={message.media} role="athlete" mine={message.mine} />
                            </View>
                          ) : null}
                          {message.body ? (
                            <Text style={[styles.messageBody, message.mine ? styles.messageBodyMine : null]}>{message.body}</Text>
                          ) : null}
                          <Text style={[styles.messageTime, message.mine ? styles.messageTimeMine : null]}>{chatTime(message.createdAt)}</Text>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
            )}
          </View>

          {threadError ? <Text style={styles.directError}>{threadError}</Text> : null}

          {selectedParty ? (
            <View style={styles.directComposer}>
              <TextInput
                value={draft}
                onChangeText={(value) => setDraft(value.slice(0, 4000))}
                placeholder="Message..."
                placeholderTextColor={colors.inkFaint}
                multiline
                style={styles.directInput}
              />
              <Pressable
                onPress={send}
                disabled={!canSend}
                style={[styles.directSend, canSend ? styles.directSendOn : styles.directSendOff]}
                accessibilityLabel="Send message"
              >
                <Ionicons name="send" size={18} color={canSend ? "#ffffff" : colors.inkFaint} />
              </Pressable>
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

function CardTitle({ children, style }: { children: React.ReactNode; style?: object }) {
  return <Text style={[styles.cardTitle, style]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>{children}</Text>;
}

function Chip({ band, children, style }: { band: Band; children: React.ReactNode; style?: object }) {
  const color = bandColor(band);
  return (
    <View style={[styles.chip, { backgroundColor: `${color}22` }, style]}>
      <Text style={[styles.chipText, { color }]}>{children}</Text>
    </View>
  );
}

function Choice({ label, selected, onPress, compact }: { label: string; selected: boolean; onPress: () => void; compact?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[styles.choice, compact ? styles.choiceCompact : null, selected ? styles.choiceOn : null]}>
      <Text style={[styles.choiceText, compact ? styles.choiceTextCompact : null, selected ? styles.choiceTextOn : null]}>{label}</Text>
    </Pressable>
  );
}

function CompactButton({
  label,
  onPress,
  disabled,
  successLabel,
  successDurationMs = 1600,
}: {
  label: string;
  onPress: () => void | boolean | Promise<void | boolean>;
  disabled?: boolean;
  successLabel?: string;
  successDurationMs?: number;
}) {
  const [phase, setPhase] = useState<"idle" | "busy" | "done">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const off = disabled || phase === "busy" || phase === "done";

  async function handlePress() {
    const result = onPress();
    const isPromise = !!result && typeof (result as { then?: unknown }).then === "function";
    if (!successLabel || !isPromise) return;
    setPhase("busy");
    let ok = true;
    try {
      ok = (await result) !== false;
    } catch {
      ok = false;
    }
    if (!ok) {
      setPhase("idle");
      return;
    }
    setPhase("done");
    timer.current = setTimeout(() => setPhase("idle"), successDurationMs);
  }

  return (
    <Pressable
      onPress={handlePress}
      disabled={off}
      style={[
        styles.compactButton,
        phase === "done" ? styles.compactButtonDone : disabled ? styles.compactButtonDisabled : null,
      ]}
    >
      {phase === "busy" ? (
        <ActivityIndicator color={theme.accentInk} />
      ) : phase === "done" ? (
        <View style={styles.compactButtonRow}>
          <Ionicons name="checkmark-circle" size={16} color="#fff" />
          <Text style={[styles.compactButtonText, { color: "#fff" }]}>{successLabel}</Text>
        </View>
      ) : (
        <Text style={styles.compactButtonText}>{label}</Text>
      )}
    </Pressable>
  );
}

function DaysToggle({ value, options, onChange }: { value: number; options: number[]; onChange: (v: number) => void }) {
  return (
    <View style={styles.daysToggle}>
      {options.map((d) => (
        <Pressable key={d} onPress={() => onChange(d)} style={[styles.dayButton, value === d ? styles.dayButtonOn : null]}>
          <Text style={[styles.dayButtonText, value === d ? styles.dayButtonTextOn : null]}>{d}d</Text>
        </Pressable>
      ))}
    </View>
  );
}

function MetricToggle({ value, options, onChange }: { value: string | null; options: string[]; onChange: (v: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, marginBottom: 12 }}>
      {options.map((m) => (
        <Pressable key={m} onPress={() => onChange(m)} style={[styles.metricButton, value === m ? styles.metricButtonOn : null]}>
          <Text style={[styles.metricText, value === m ? styles.metricTextOn : null]}>{m}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function ChartPanel({
  title,
  subtitle,
  action,
  loading,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  loading?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <View style={styles.chartHeader}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <CardTitle>{title}</CardTitle>
          {subtitle ? <Text style={styles.chartSub}>{subtitle}</Text> : null}
        </View>
        {action}
      </View>
      {loading ? <ActivityIndicator color={theme.accentStrong} style={{ marginVertical: 40 }} /> : children}
    </Card>
  );
}

type SeriesDef = {
  key: string;
  label: string;
  color: string;
  kind: "line" | "bar";
  axis?: "left" | "right";
};

function numericValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pathFromPoints(points: { x: number; y: number }[]): string {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

function MultiSeriesChart({
  data,
  series,
  leftDomain,
  autoDomain,
  height = 230,
}: {
  data: Record<string, unknown>[];
  series: SeriesDef[];
  leftDomain?: [number, number];
  autoDomain?: boolean;
  height?: number;
}) {
  const [width, setWidth] = useState(0);
  const chartWidth = Math.max(1, width - 52);
  const plotH = height - 44;
  const left = 38;
  const top = 12;
  const values = data.flatMap((p) =>
    series.filter((s) => s.axis !== "right").map((s) => numericValue(p[s.key])).filter((v): v is number => v !== null)
  );
  const rightValues = data.flatMap((p) =>
    series.filter((s) => s.axis === "right").map((s) => numericValue(p[s.key])).filter((v): v is number => v !== null)
  );
  const min = autoDomain && values.length ? Math.min(...values) : leftDomain?.[0] ?? 0;
  const maxRaw = autoDomain && values.length ? Math.max(...values) : leftDomain?.[1] ?? 100;
  const pad = autoDomain ? Math.max(1, (maxRaw - min) * 0.18) : 0;
  const hasLeftBars = series.some((s) => s.kind === "bar" && s.axis !== "right");
  const yMin = autoDomain ? (hasLeftBars ? 0 : min >= 0 ? Math.max(0, min - pad) : min - pad) : min;
  const yMax = autoDomain ? maxRaw + pad : maxRaw;
  const rightMax = rightValues.length ? Math.max(...rightValues, 1) : 1;
  const x = (i: number) => left + (data.length <= 1 ? chartWidth / 2 : (i / (data.length - 1)) * chartWidth);
  const y = (v: number, axis?: "left" | "right") => {
    const max = axis === "right" ? rightMax : yMax;
    const minV = axis === "right" ? 0 : yMin;
    return top + plotH - ((v - minV) / Math.max(1, max - minV)) * plotH;
  };

  const paths = series.filter((s) => s.kind === "line").map((s) => {
    const segments: { x: number; y: number }[][] = [];
    const points: { v: number; i: number }[] = [];
    let current: { x: number; y: number }[] = [];

    data.forEach((p, i) => {
      const v = numericValue(p[s.key]);
      if (v === null) {
        if (current.length) segments.push(current);
        current = [];
        return;
      }
      points.push({ v, i });
      current.push({ x: x(i), y: y(v, s.axis) });
    });
    if (current.length) segments.push(current);
    return { ...s, segments, points };
  });
  const bars = series.filter((s) => s.kind === "bar");
  const barW = Math.max(3, Math.min(11, chartWidth / Math.max(1, data.length) * 0.55));

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height }}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          {[0, 0.5, 1].map((t) => (
            <Line key={t} x1={left} x2={left + chartWidth} y1={top + plotH * t} y2={top + plotH * t} stroke={colors.lineStrong} strokeWidth={1} />
          ))}
          <Line x1={left} x2={left + chartWidth} y1={top + plotH} y2={top + plotH} stroke={colors.lineStrong} strokeWidth={1} />
          {[0, 0.5, 1].map((t) => (
            <SvgText key={t} x={2} y={top + plotH * t + 4} fill={colors.inkFaint} fontSize="10">
              {Math.round(yMax - (yMax - yMin) * t)}
            </SvgText>
          ))}
          {rightValues.length ? [0, 0.5, 1].map((t) => (
            <SvgText key={t} x={left + chartWidth + 6} y={top + plotH * t + 4} fill={colors.inkFaint} fontSize="10">
              {Math.round(rightMax - rightMax * t)}
            </SvgText>
          )) : null}
          {bars.map((s) => data.map((p, i) => {
            const v = numericValue(p[s.key]);
            if (v === null) return null;
            const yy = y(v, s.axis);
            return <Rect key={`${s.key}-${i}`} x={x(i) - barW / 2} y={yy} width={barW} height={top + plotH - yy} rx={3} fill={s.color} opacity={0.95} />;
          }))}
          {paths.map((p) => p.segments.map((segment, index) => (
            <Path key={`${p.key}-${index}`} d={pathFromPoints(segment)} stroke={p.color} strokeWidth={2.2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          )))}
          {paths.map((p) => p.points.map((point) => (
            <Circle key={`${p.key}-dot-${point.i}`} cx={x(point.i)} cy={y(point.v, p.axis)} r={2.5} fill={p.color} />
          )))}
          {data.length ? (
            <>
              <SvgText x={left} y={height - 8} fill={colors.inkFaint} fontSize="10">{shortDate(String(data[0].date ?? ""))}</SvgText>
              <SvgText x={left + chartWidth - 36} y={height - 8} fill={colors.inkFaint} fontSize="10">{shortDate(String(data[data.length - 1].date ?? ""))}</SvgText>
            </>
          ) : null}
        </Svg>
      ) : null}
    </View>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <View style={styles.legend}>
      {items.map((item) => (
        <View key={item.label} style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: item.color }]} />
          <Text style={styles.legendText}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  pageShell: { flex: 1, backgroundColor: colors.surface },
  mainScroll: { flex: 1, backgroundColor: "transparent" },
  content: { paddingHorizontal: 16, paddingTop: 0, paddingBottom: 16 },
  logContent: { paddingBottom: 0 },
  stack: { gap: 8 },
  todayStack: { gap: 14 },
  todayStackNative: { gap: 7 },
  stackSmall: { gap: 10 },
  todayHeader: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    backgroundColor: colors.surface,
  },
  todayHeaderNative: { paddingTop: 0, paddingBottom: 2 },
  todayHeaderTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  todayAvatar: {
    borderWidth: 0,
    elevation: 0,
  },
  todayGreeting: { flex: 1, minWidth: 0 },
  todayRole: { fontSize: 10, lineHeight: 14, fontWeight: "900", textTransform: "uppercase", letterSpacing: 2 },
  todayGreetingLine: { marginTop: 2, color: colors.ink, fontSize: 20, lineHeight: 25, fontWeight: "500" },
  todayGreetingLineNative: { fontSize: 15, lineHeight: 18 },
  todayGreetingName: { color: colors.ink, fontSize: 27, lineHeight: 32, fontWeight: "900" },
  todayGreetingNameNative: { fontSize: 20, lineHeight: 23 },
  todayHeaderActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  askWave: { width: 18, height: 18, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 2 },
  askWaveBar: { width: 3, borderRadius: 999 },
  askLogWrap: {
    position: "absolute",
    right: 16,
    left: 60,
    bottom: 148,
    zIndex: 890,
    elevation: 19,
    alignItems: "flex-end",
  },
  askLogCard: {
    width: "100%",
    maxHeight: 220,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
    padding: 10,
    shadowColor: "#0f172a",
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
  askLogHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  askLogTitle: { fontSize: 10, fontWeight: "900", letterSpacing: 1.2, textTransform: "uppercase", color: colors.inkFaint },
  askLogScroll: { maxHeight: 180 },
  askLogBubble: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 7, maxWidth: "92%" },
  askLogBubbleUser: { alignSelf: "flex-end", backgroundColor: `${theme.accent}22` },
  askLogBubbleAgent: { alignSelf: "flex-start", backgroundColor: colors.surfaceInset },
  askLogBubbleError: { backgroundColor: colors.surfaceInset },
  askLogText: { fontSize: 12, lineHeight: 16, color: colors.inkMuted },
  askLogTextUser: { color: colors.ink, fontWeight: "600" },
  askLogTextError: { color: colors.inkMuted },
  askDismissLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 820,
    elevation: 18,
    backgroundColor: "transparent",
  },
  askFab: {
    position: "absolute",
    right: 16,
    bottom: 84,
    zIndex: 2000,
    elevation: 40,
    height: 56,
    width: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 28,
    backgroundColor: "#ffad45",
    shadowColor: "#0f172a",
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  askFabActive: {
    borderWidth: 1,
    borderColor: `${theme.accentStrong}55`,
  },
  askExecuteFabWrap: {
    position: "absolute",
    right: 20,
    bottom: 150,
    zIndex: 2002,
    elevation: 42,
  },
  askExecuteFab: {
    height: 48,
    width: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#16a34a",
    borderWidth: 1,
    borderColor: "#12813c",
    shadowColor: "#0f172a",
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
  askExecuteFabActive: {
    borderColor: "#0f6d34",
    shadowOpacity: 0.24,
  },
  askFabGlow: {
    position: "absolute",
    right: 16,
    bottom: 84,
    zIndex: 1999,
    elevation: 39,
    height: 56,
    width: 56,
    borderRadius: 28,
    backgroundColor: "#ffad45",
  },
  askStatusPill: {
    position: "absolute",
    right: 16,
    bottom: 208,
    zIndex: 2001,
    elevation: 41,
    minHeight: 28,
    borderRadius: 14,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.line,
    shadowColor: "#0f172a",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  askStatusText: { color: colors.inkMuted, fontSize: 11, fontWeight: "900" },
  askInputOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 950,
    elevation: 30,
  },
  askInputRow: {
    position: "absolute",
    left: 18,
    right: 18,
    bottom: 92,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  askInput: {
    flex: 1,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 20,
    color: colors.ink,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    fontWeight: "normal",
    includeFontPadding: false,
    shadowColor: "#0f172a",
    shadowOpacity: 0.08,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  askInfoOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 940,
    elevation: 26,
    justifyContent: "flex-end",
  },
  askInfoSheet: {
    marginHorizontal: 12,
    marginBottom: 86,
    maxHeight: 330,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 12,
    shadowColor: "#0f172a",
    shadowOpacity: 0.16,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 18,
  },
  askInfoHandle: { alignSelf: "center", width: 38, height: 4, borderRadius: 999, backgroundColor: colors.lineStrong, marginBottom: 10 },
  askInfoHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  askInfoTitleBlock: { flex: 1, minWidth: 0 },
  askInfoTitle: { color: colors.ink, fontSize: 15, fontWeight: "900" },
  askInfoSubtitle: { marginTop: 1, color: colors.inkMuted, fontSize: 11, fontWeight: "700" },
  askInfoClose: {
    height: 34,
    width: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  askInfoSummary: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: `${theme.accentStrong}22`,
    backgroundColor: theme.accentSoft,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  askInfoSummaryText: { flex: 1, minWidth: 0, color: colors.ink, fontSize: 12, fontWeight: "800" },
  askInfoTableHead: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    paddingBottom: 6,
  },
  askInfoHeadText: { color: colors.inkFaint, fontSize: 10, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1.4 },
  askInfoStatusHead: { width: 78, textAlign: "center" },
  askInfoScroll: { maxHeight: 190 },
  askInfoRows: { paddingTop: 4, gap: 6 },
  askInfoReportScroll: { maxHeight: 280, marginTop: 10 },
  askInfoReportBody: { paddingBottom: 4 },
  askInfoReportText: { color: colors.ink, fontSize: 13, lineHeight: 20, fontWeight: "600" },
  askInfoSectionHeading: {
    color: theme.accentStrong,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1.1,
    marginBottom: 4,
  },
  askInfoSectionSpacing: { marginTop: 14 },
  askInfoRow: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderRadius: 12,
    backgroundColor: colors.surfaceInset,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  askInfoRowAction: { borderWidth: 1, borderColor: "rgba(0,0,0,0.03)" },
  askInfoIconBox: {
    height: 34,
    width: 34,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  askInfoMainCell: { flex: 1, minWidth: 0 },
  askInfoLabel: { color: colors.ink, fontSize: 12, fontWeight: "900" },
  askInfoDetail: { marginTop: 2, color: colors.inkMuted, fontSize: 11, lineHeight: 14 },
  askInfoStatusPill: {
    width: 78,
    minHeight: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 7,
  },
  askInfoStatusText: { fontSize: 11, fontWeight: "900" },
  todayHeaderButton: {
    height: 44,
    width: 44,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#2b251f",
    shadowOpacity: 0.024,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 1,
  },
  todayHeaderButtonNative: { height: 40, width: 40, borderRadius: 14 },
  todayHeaderBadge: {
    position: "absolute",
    top: 1,
    right: 3,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.bad,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  todayHeaderBadgeText: { color: "#fff", fontSize: 10, fontWeight: "900" },
  notice: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 },
  noticeText: { fontSize: 13, fontWeight: "600" },
  checkInNudge: {
    marginBottom: 10,
    borderWidth: 1,
    borderColor: `${theme.accentStrong}33`,
    backgroundColor: theme.accentSoft,
    borderRadius: 18,
    paddingHorizontal: 10,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  checkInIcon: {
    height: 30,
    width: 30,
    borderRadius: 15,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  checkInTitle: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  checkInSub: { marginTop: 1, color: colors.inkMuted, fontSize: 11 },
  checkInButton: {
    height: 32,
    borderRadius: 16,
    backgroundColor: "#ff7e1a",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  checkInButtonText: { color: theme.accentInk, fontSize: 11, fontWeight: "900" },
  checkInClose: { height: 28, width: 24, alignItems: "center", justifyContent: "center" },
  warnStrip: {
    borderWidth: 1,
    borderColor: `${colors.warn}55`,
    backgroundColor: `${colors.warn}16`,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  warnText: { flex: 1, color: colors.warn, fontSize: 12 },
  heroCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 162,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(205,176,132,0.18)",
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 14,
    paddingVertical: 14,
    overflow: "hidden",
    shadowColor: "#2b251f",
    shadowOpacity: 0.024,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 9 },
    elevation: 1,
  },
  heroCardNative: { minHeight: 118, gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  heroRingCol: { width: 116, alignItems: "center", justifyContent: "center" },
  heroRingColNative: { width: 98 },
  readinessDial: { alignItems: "center", justifyContent: "center" },
  readinessScoreRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "center" },
  readinessScore: { fontSize: 33, lineHeight: 36, fontWeight: "900" },
  readinessScoreCompact: { fontSize: 25, lineHeight: 28 },
  readinessMax: { color: colors.inkMuted, fontSize: 14, fontWeight: "800" },
  readinessMaxCompact: { fontSize: 11 },
  heroRingLabel: { color: colors.inkMuted, fontSize: 11, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1.1, marginBottom: 8 },
  heroRingLabelCompact: { fontSize: 8.5, letterSpacing: 0.35 },
  heroStatusPill: { marginTop: 8, maxWidth: 118, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  heroStatusPillCompact: { maxWidth: 106, gap: 5, paddingHorizontal: 8, paddingVertical: 4 },
  heroStatusDot: { width: 6, height: 6, borderRadius: 3 },
  heroStatusText: { fontSize: 10, fontWeight: "900", textTransform: "uppercase" },
  heroStatusTextCompact: { fontSize: 8.5 },
  heroHeadline: { fontSize: 18, lineHeight: 22, fontWeight: "900" },
  heroHeadlineNative: { fontSize: 12.5, lineHeight: 16 },
  heroIllustration: { marginRight: -24 },
  heroIllustrationFrame: { width: 112, height: 122, borderRadius: 18, overflow: "hidden" },
  heroIllustrationCompact: { position: "absolute", right: -28, bottom: 2, opacity: 0.96 },
  heroIllustrationFrameCompact: { width: 202, height: 118, borderRadius: 18 },
  heroIllustrationFade: { position: "absolute", left: 0, top: 0, bottom: 0, width: "45%" },
  heroRunnerImage: { width: "100%", height: "100%" },
  heroCopy: { flex: 1, minWidth: 0, alignItems: "flex-start", zIndex: 2 },
  heroCopyCompact: { paddingRight: 72 },
  heroText: { marginTop: 7, color: colors.inkMuted, fontSize: 13, lineHeight: 19, textAlign: "left" },
  heroTextNative: { marginTop: 4, fontSize: 8.7, lineHeight: 13 },
  heroButton: {
    marginTop: 12,
    minHeight: 44,
    borderRadius: 22,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  heroButtonNative: { marginTop: 8, minHeight: 30, borderRadius: 15, paddingHorizontal: 14, gap: 5 },
  heroButtonPrimary: { backgroundColor: "#ff7e1a" },
  heroButtonSecondary: {
    borderWidth: 1,
    borderColor: `${theme.accentStrong}33`,
    backgroundColor: `${theme.accent}1a`,
  },
  heroButtonText: { fontSize: 14, fontWeight: "900" },
  heroButtonTextNative: { fontSize: 10.5 },
  heroButtonPrimaryText: { color: "#ffffff" },
  heroButtonSecondaryText: { color: theme.accentStrong },
  bandLegendCard: { paddingHorizontal: 14, paddingVertical: 12, borderRadius: 18 },
  bandLegendCardCompact: {
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 16,
    shadowOpacity: 0.024,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 7 },
    elevation: 1,
  },
  bandLegendHeader: { minHeight: 34, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  bandLegendHeaderCompact: { minHeight: 22, gap: 8 },
  bandLegendTitleCompact: { fontSize: 8.8, letterSpacing: 0.7 },
  legendLearnPill: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 999, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceRaised, paddingHorizontal: 12, paddingVertical: 7 },
  legendLearnPillCompact: { gap: 4, paddingHorizontal: 8, paddingVertical: 3.5 },
  legendLearnText: { color: colors.inkMuted, fontSize: 12, fontWeight: "800" },
  legendLearnTextCompact: { fontSize: 8.2 },
  bandLegendInline: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 8 },
  bandLegendInlineCompact: { gap: 7, marginTop: 3.5 },
  bandLegendInlineItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  bandLegendDot: { height: 8, width: 8, borderRadius: 4 },
  bandLegendDotCompact: { height: 7, width: 7, borderRadius: 3.5 },
  bandLegendInlineText: { color: colors.inkMuted, fontSize: 12, fontWeight: "600" },
  bandLegendInlineTextCompact: { fontSize: 8 },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  statTile: { flexGrow: 1, minWidth: 0, minHeight: 106, borderRadius: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceRaised, padding: 12, shadowColor: "#2b251f", shadowOpacity: 0.022, shadowRadius: 22, shadowOffset: { width: 0, height: 7 }, elevation: 1 },
  statTileDense: { minHeight: 112, paddingHorizontal: 8, paddingVertical: 10 },
  statTileNativeDense: { minHeight: 81, borderRadius: 15, paddingHorizontal: 6, paddingVertical: 7 },
  tileLabelRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  tileLabelRowDense: { gap: 4 },
  tileIcon: { height: 32, width: 32, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  tileIconDense: { height: 22, width: 22, borderRadius: 8 },
  tileIconNativeDense: { height: 20, width: 20, borderRadius: 8 },
  tileLabel: { flex: 1, minWidth: 0, fontSize: 10, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.6 },
  tileLabelDense: { fontSize: 7, letterSpacing: 0 },
  tileValue: { marginTop: 13, fontSize: 24, lineHeight: 29, fontWeight: "900", color: colors.ink },
  tileValueDense: { marginTop: 14, fontSize: 22, lineHeight: 26 },
  tileValueNativeDense: { marginTop: 11, fontSize: 17, lineHeight: 20 },
  tileUnit: { color: colors.inkMuted, fontSize: 13, fontWeight: "800" },
  tileSub: { marginTop: 5, color: colors.inkMuted, fontSize: 12, fontWeight: "700" },
  tileSubDense: { fontSize: 11 },
  tileSubNativeDense: { marginTop: 3, fontSize: 9 },
  tileProgressTrackNativeDense: { marginTop: 6 },
  tileProgressTrack: { marginTop: 10, height: 5, borderRadius: 999, backgroundColor: colors.line, overflow: "hidden" },
  tileProgressFill: { height: 4, borderRadius: 999 },
  cardTitle: { color: colors.ink, fontSize: 14, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1.5 },
  cardTitleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  cardTitleRowNative: { marginBottom: 8 },
  todayCardTitleNative: { fontSize: 10.5, letterSpacing: 0.85 },
  sessionsHeaderNative: { marginBottom: 7 },
  sessionsTitleNative: { fontSize: 9, letterSpacing: 0.8 },
  viewFullPlanLink: { color: "#f26a0a", fontSize: 13, fontWeight: "900" },
  viewFullPlanLinkNative: { fontSize: 12 },
  sessionsViewFullPlanLinkNative: { fontSize: 8.8 },
  loadAttentionRow: { flexDirection: "row", gap: 10, alignItems: "stretch" },
  loadAttentionRowStacked: { flexDirection: "column" },
  loadAttentionCol: { flex: 1, minWidth: 0, borderRadius: 18 },
  loadAttentionColStacked: { minWidth: 0, width: "100%", borderRadius: 18 },
  loadAttentionCardNative: {
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 16,
    shadowOpacity: 0.022,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 7 },
    elevation: 1,
  },
  trainingLoadReferenceCard: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 20,
    borderRadius: 30,
    borderColor: "rgba(31,35,32,0.07)",
    backgroundColor: "#fffefd",
    shadowColor: "#2b251f",
    shadowOpacity: 0.045,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 12 },
    elevation: 2,
  },
  trainingLoadReferenceCardNative: {
    height: 276,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 12,
    borderRadius: 20,
    shadowOpacity: 0.032,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 9 },
    elevation: 2,
  },
  trainingLoadReferenceHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  trainingLoadReferenceTitleRow: { flexDirection: "row", alignItems: "center", gap: 11, minWidth: 0 },
  trainingLoadReferenceAccent: { width: 5, height: 27, borderRadius: 99, backgroundColor: "#ff6b10" },
  trainingLoadReferenceAccentNative: { width: 3, height: 20 },
  trainingLoadReferenceTitle: { color: colors.ink, fontSize: 22, lineHeight: 26, fontWeight: "900", letterSpacing: 2.2 },
  trainingLoadReferenceTitleNative: { fontSize: 11, lineHeight: 14, letterSpacing: 1.55 },
  trainingLoadReferenceIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(31,35,32,0.12)",
    backgroundColor: "#fffefd",
    alignItems: "center",
    justifyContent: "center",
  },
  trainingLoadReferenceIconNative: { width: 28, height: 28, borderRadius: 14 },
  trainingLoadReferenceMetricRow: { flexDirection: "row", alignItems: "baseline", gap: 10, marginTop: 30 },
  trainingLoadReferenceMetricRowNative: { gap: 6, marginTop: 8 },
  trainingLoadReferenceValue: { color: colors.ink, fontSize: 72, lineHeight: 78, fontWeight: "900" },
  trainingLoadReferenceValueNative: { fontSize: 29, lineHeight: 32 },
  trainingLoadReferenceUnit: { color: colors.ink, fontSize: 33, lineHeight: 37, fontWeight: "900" },
  trainingLoadReferenceUnitNative: { fontSize: 14, lineHeight: 17 },
  trainingLoadReferenceSub: { marginTop: 5, color: colors.inkMuted, fontSize: 25, lineHeight: 31, fontWeight: "500" },
  trainingLoadReferenceSubNative: { marginTop: 1, fontSize: 12, lineHeight: 15 },
  trainingLoadReferencePill: {
    alignSelf: "flex-start",
    minHeight: 39,
    borderRadius: 16,
    paddingHorizontal: 15,
    marginTop: 15,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(31,35,32,0.055)",
  },
  trainingLoadReferencePillNative: { minHeight: 20, borderRadius: 10, paddingHorizontal: 8, marginTop: 5, gap: 6 },
  trainingLoadReferencePillDot: { width: 14, height: 14, borderRadius: 7 },
  trainingLoadReferencePillDotNative: { width: 8, height: 8, borderRadius: 4 },
  trainingLoadReferencePillText: { color: colors.inkMuted, fontSize: 18, lineHeight: 22, fontWeight: "700" },
  trainingLoadReferencePillTextNative: { fontSize: 10.5, lineHeight: 13 },
  trainingLoadReferenceDivider: { height: 1, marginTop: 29, backgroundColor: "rgba(31,35,32,0.11)" },
  trainingLoadReferenceDividerNative: { marginTop: 11 },
  weekLoadReferenceChart: { position: "relative", width: "100%", height: 178, marginTop: 20 },
  weekLoadReferenceChartNative: { height: 72, marginTop: 6 },
  weekLoadReferenceEmpty: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 18,
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
  weekLoadReferenceEmptyNative: { bottom: 12, gap: 5 },
  weekLoadReferenceEmptyIcon: {
    width: 74,
    height: 74,
    borderRadius: 37,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(31,35,32,0.035)",
    borderWidth: 1,
    borderColor: "rgba(31,35,32,0.11)",
  },
  weekLoadReferenceEmptyIconNative: { width: 24, height: 24, borderRadius: 12 },
  weekLoadReferenceEmptyText: { color: colors.inkFaint, fontSize: 20, lineHeight: 24, fontWeight: "500" },
  weekLoadReferenceEmptyTextNative: { fontSize: 9.5, lineHeight: 12 },
  trainingLoadReferenceButton: {
    height: 76,
    borderRadius: 13,
    marginTop: 22,
    backgroundColor: "#ff6b10",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    shadowColor: "#db5b09",
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  trainingLoadReferenceButtonNative: { height: 30, borderRadius: 9, marginTop: 8 },
  trainingLoadReferenceButtonText: { color: "#ffffff", fontSize: 24, lineHeight: 30, fontWeight: "900" },
  trainingLoadReferenceButtonTextNative: { fontSize: 12.5, lineHeight: 15 },
  trainingLoadReferenceButtonIcon: { position: "absolute", right: 18 },
  attentionTitle: { color: colors.bad, fontSize: 14, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1.4 },
  attentionTitleNative: { fontSize: 10.5, letterSpacing: 0.9 },
  attentionList: { gap: 10 },
  attentionListNative: { gap: 7 },
  attentionRow: { minHeight: 38, flexDirection: "row", alignItems: "center", gap: 6 },
  attentionRowNative: { minHeight: 32, gap: 5 },
  attentionIcon: { width: 30, height: 30, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  attentionIconNative: { width: 26, height: 26, borderRadius: 10 },
  attentionCopy: { flex: 1, minWidth: 0 },
  attentionItemTitle: { color: colors.ink, fontSize: 12, lineHeight: 15, fontWeight: "900" },
  attentionItemTitleNative: { fontSize: 10, lineHeight: 12 },
  attentionItemSub: { marginTop: 2, color: colors.inkMuted, fontSize: 11, lineHeight: 14 },
  attentionItemSubNative: { marginTop: 1, fontSize: 9, lineHeight: 11 },
  attentionFooter: { marginTop: 12, alignSelf: "center" },
  attentionViewAll: { color: colors.bad, fontSize: 13, fontWeight: "900" },
  attentionViewAllWrap: { marginTop: 8 },
  attentionViewAllWrapNative: { marginTop: 22, alignSelf: "center" },
  attentionViewAllNative: { fontSize: 12 },
  attentionEmpty: { minHeight: 118, alignItems: "center", justifyContent: "center", gap: 5 },
  sessionStatusPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, paddingVertical: 7, borderRadius: 999, maxWidth: 106 },
  sessionStatusText: { fontSize: 11, fontWeight: "900" },
  weekBars: { flexDirection: "row", gap: 6, marginTop: 12, height: 76 },
  weekBarsCompact: { gap: 4, marginTop: 6, height: 44 },
  weekGridCompact: { marginTop: 6, height: 58, width: "100%" },
  weekBarsEmpty: { marginTop: 14, color: colors.inkFaint, fontSize: 12, fontWeight: "700" },
  weekBarsEmptyCompact: { marginTop: 8, fontSize: 10 },
  weekBarsAxis: { justifyContent: "space-between", paddingBottom: 16 },
  weekBarsAxisLabel: { fontSize: 8, color: colors.inkFaint },
  weekBarsColumns: { flex: 1, flexDirection: "row", alignItems: "flex-end", gap: 6 },
  weekBarCol: { flex: 1, alignItems: "center", gap: 4, height: "100%" },
  weekBarTrack: { flex: 1, width: 10, borderRadius: 5, backgroundColor: colors.surfaceInset, justifyContent: "flex-end", overflow: "hidden" },
  weekBarFill: { width: "100%", borderRadius: 5, backgroundColor: "#ff7e1a" },
  weekBarLabel: { fontSize: 9, fontWeight: "700", color: colors.inkFaint },
  loadButtonWrap: { marginTop: 12 },
  loadButtonWrapNative: { marginTop: 6 },
  loadButtonNative: {
    height: 28,
    borderRadius: 7,
    backgroundColor: "#ff7e1a",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  loadButtonTextNative: { color: "#ffffff", fontSize: 10.5, fontWeight: "900" },
  planGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  sessionsCard: { borderRadius: 20, padding: 14 },
  sessionsCardNative: {
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderRadius: 18,
    shadowOpacity: 0.022,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 1,
  },
  trainingSummaryList: { gap: 9, marginTop: 4 },
  trainingSummaryListNative: { gap: 5.5, marginTop: 0 },
  trainingSummaryRow: {
    minHeight: 78,
    borderRadius: 16,
    backgroundColor: colors.surfaceRaised,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.line,
    shadowColor: "#2b251f",
    shadowOpacity: 0.016,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 7 },
    elevation: 1,
  },
  trainingSummaryRowCompact: { minHeight: 52, gap: 6, paddingHorizontal: 6, paddingVertical: 5.5, borderRadius: 14 },
  // Opaque, not alpha-blended — a transparent backgroundColor combined with
  // `elevation` (still active here since this style layers on trainingSummaryRow)
  // makes Android render a hard gray shadow "plate" behind the row instead of a
  // soft one, since the OS shadow renderer expects an opaque surface to cast onto.
  trainingSummaryRowDone: { backgroundColor: "#f5faf6" },
  trainingSummaryIcon: {
    height: 56,
    width: 42,
    borderRadius: 14,
    backgroundColor: "#fff3df",
    alignItems: "center",
    justifyContent: "center",
  },
  trainingSummaryIconCompact: { height: 38, width: 33, borderRadius: 12 },
  trainingSummaryIconPm: { backgroundColor: "#f0f2fb" },
  trainingSummaryIconText: { marginTop: 2, color: "#b85307", fontSize: 11, fontWeight: "900" },
  trainingSummaryIconTextCompact: { fontSize: 9 },
  trainingSummaryIconTextPm: { color: "#5670ad" },
  trainingSummaryCopy: { flex: 1, minWidth: 0 },
  trainingTitleLine: { flexDirection: "row", alignItems: "center", gap: 7 },
  trainingSummaryTitle: { flex: 1, minWidth: 0, color: colors.ink, fontSize: 15, fontWeight: "900" },
  trainingSummaryTitleCompact: { fontSize: 12 },
  trainingSummarySub: { marginTop: 5, color: colors.inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "700" },
  trainingSummarySubCompact: { marginTop: 2, fontSize: 10, lineHeight: 13, fontWeight: "600" },
  trainingSummaryAction: { color: theme.accentStrong, fontSize: 11, fontWeight: "900" },
  sessionStatusPillCompact: { paddingHorizontal: 6, paddingVertical: 4, maxWidth: 80 },
  sessionStatusTextCompact: { fontSize: 9.5 },
  slotPill: { flexGrow: 1, flexBasis: 104, minWidth: 104, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceInset, padding: 12 },
  slotPillDone: { borderColor: `${colors.ok}66`, backgroundColor: `${colors.ok}10` },
  slotType: { marginTop: 6, color: colors.ink, fontSize: 16, fontWeight: "800" },
  hydrationHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: 12 },
  hydrationTotal: { color: colors.ink, fontSize: 30, fontWeight: "800" },
  hydrationUnit: { color: colors.inkFaint, fontSize: 14, fontWeight: "700" },
  hydrationPct: { color: colors.inkMuted, fontSize: 12, fontWeight: "800" },
  progressTrack: { marginTop: 10, height: 10, borderRadius: 999, backgroundColor: colors.surfaceInset, overflow: "hidden" },
  progressFill: { height: 10, borderRadius: 999 },
  quickWaterGrid: { flexDirection: "row", gap: 8, marginTop: 12 },
  secondaryButton: { flex: 1, height: 42, borderRadius: radius.md, borderWidth: 1, borderColor: `${theme.accentStrong}44`, backgroundColor: `${theme.accent}1a`, alignItems: "center", justifyContent: "center" },
  secondaryText: { color: theme.accentStrong, fontSize: 12, fontWeight: "800" },
  waterGoalCard: { padding: 14 },
  waterGoalBody: { alignItems: "center", gap: 14, marginTop: 4 },
  waterRingWrap: {
    height: 176,
    width: 176,
    alignItems: "center",
    justifyContent: "center",
  },
  waterRingInner: {
    height: 128,
    width: 128,
    borderRadius: 64,
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#2b251f",
    shadowOpacity: 0.045,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 1,
  },
  waterRingPct: { color: colors.ink, fontSize: 28, fontWeight: "900" },
  waterRingLabel: { marginTop: 2, color: colors.inkMuted, fontSize: 11, fontWeight: "700" },
  waterMetricGrid: { flexDirection: "row", gap: 8, width: "100%" },
  waterMetricTile: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceInset,
    padding: 10,
  },
  waterMetricLabel: {
    color: colors.inkFaint,
    fontSize: 8,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1.1,
  },
  waterMetricValue: { marginTop: 5, color: colors.ink, fontSize: 16, fontWeight: "900" },
  waterMetricValueGood: { color: colors.ok },
  waterStatusPanel: {
    width: "100%",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceInset,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  waterStatusPanelGood: { borderColor: `${colors.ok}4d`, backgroundColor: `${colors.ok}14` },
  waterStatusText: { color: colors.ink, fontSize: 13, fontWeight: "800" },
  waterStatusTextGood: { color: colors.ok },
  waterStatusSub: { marginTop: 2, color: colors.inkMuted, fontSize: 11 },
  waterPresetGrid: { flexDirection: "row", gap: 8, marginTop: 12 },
  waterPresetButton: {
    flex: 1,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceInset,
    alignItems: "center",
    justifyContent: "center",
  },
  waterPresetButtonOn: { borderColor: "#ff7e1a", backgroundColor: "#ff7e1a" },
  waterPresetText: { color: colors.inkMuted, fontSize: 12, fontWeight: "800" },
  waterPresetTextOn: { color: "#1a0c00" },
  waterInputRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  waterInput: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceInset,
    color: colors.ink,
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    fontWeight: "normal",
    includeFontPadding: false,
    paddingHorizontal: 12,
  },
  waterPrimaryButton: {
    height: 44,
    minWidth: 82,
    borderRadius: 12,
    backgroundColor: "#ff7e1a",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  waterPrimaryText: { color: "#1a0c00", fontSize: 13, fontWeight: "900" },
  waterSecondaryButton: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#ffbe83",
    backgroundColor: "#fff7ed",
    alignItems: "center",
    justifyContent: "center",
  },
  waterSecondaryText: { color: theme.accentStrong, fontSize: 12, fontWeight: "900" },
  waterError: { marginTop: 8, color: colors.bad, fontSize: 11, fontWeight: "800" },
  waterReminderHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  waterReminderCopy: { flex: 1, minWidth: 0 },
  waterReminderTitle: { marginTop: 10, color: colors.ink, fontSize: 13, fontWeight: "800" },
  waterReminderSub: { marginTop: 2, color: colors.inkMuted, fontSize: 11 },
  waterReminderToggle: {
    height: 36,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceInset,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  waterReminderToggleOn: { borderColor: "#ff7e1a", backgroundColor: "#ff7e1a" },
  waterReminderToggleText: { color: colors.inkMuted, fontSize: 12, fontWeight: "900" },
  waterReminderToggleTextOn: { color: "#1a0c00" },
  waterPermission: { marginTop: 8, color: colors.inkFaint, fontSize: 11 },
  waterChartTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  waterSegment: {
    flexDirection: "row",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceInset,
    padding: 3,
  },
  waterSegmentButton: { height: 30, minWidth: 58, borderRadius: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 9 },
  waterSegmentButtonOn: { backgroundColor: "#ff7e1a" },
  waterSegmentText: { color: colors.inkMuted, fontSize: 11, fontWeight: "800" },
  waterSegmentTextOn: { color: "#1a0c00" },
  waterChartKitWrap: {
    marginTop: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    overflow: "hidden",
    alignItems: "center",
  },
  waterChartKit: {
    borderRadius: 0,
    paddingTop: 8,
    paddingRight: 0,
  },
  waterBars: {
    height: 176,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 5,
    marginTop: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  waterBarSlot: { flex: 1, minWidth: 0, height: "100%", justifyContent: "flex-end" },
  waterBar: { width: "100%", borderTopLeftRadius: 6, borderTopRightRadius: 6 },
  waterBarsFooter: { marginTop: 8, flexDirection: "row", justifyContent: "space-between", gap: 8 },
  waterBarsLabel: { color: colors.inkFaint, fontSize: 10, fontWeight: "700" },
  waterHistoryList: { marginTop: 8 },
  waterHistoryRow: {
    minHeight: 54,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 10,
  },
  waterHistoryDate: { color: colors.ink, fontSize: 13, fontWeight: "800" },
  waterHistorySub: { marginTop: 2, color: colors.inkMuted, fontSize: 11 },
  waterHistoryAmount: { color: colors.ink, fontSize: 16, fontWeight: "900" },
  waterHistoryAmountGood: { color: colors.ok },
  controlDisabled: { opacity: 0.45 },
  waterEntryWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12 },
  waterEntryChip: {
    minHeight: 24,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceInset,
    justifyContent: "center",
    paddingHorizontal: 9,
  },
  waterEntryText: { color: colors.inkMuted, fontSize: 11, fontWeight: "700" },
  miniMuted: { color: colors.inkFaint, fontSize: 12, lineHeight: 17 },
  loadLabel: { color: colors.inkMuted, fontSize: 13, fontWeight: "800" },
  loadLabelNative: { fontSize: 10 },
  loadRow: { flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 8, flexWrap: "wrap" },
  loadRowNative: { gap: 4, marginTop: 4 },
  loadValue: { color: colors.ink, fontSize: 31, lineHeight: 36, fontWeight: "900" },
  loadValueNative: { fontSize: 22, lineHeight: 25 },
  loadUnit: { color: colors.ink, fontSize: 16, fontWeight: "900" },
  loadUnitNative: { fontSize: 12 },
  loadMeta: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "700" },
  loadMetaNative: { fontSize: 10, lineHeight: 12 },
  loadMutedNative: { fontSize: 10, lineHeight: 14 },
  riskReasonList: { gap: 2, marginTop: 7 },
  riskReasonText: { color: colors.inkMuted, fontSize: 11, lineHeight: 15 },
  chip: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  chipText: { textTransform: "uppercase", fontSize: 10, fontWeight: "900", letterSpacing: 0.8 },
  chartHeader: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 12 },
  chartSub: { marginTop: 5, color: colors.inkMuted, fontSize: 12, lineHeight: 16 },
  daysToggle: { flexDirection: "row", gap: 5 },
  dayButton: { height: 34, minWidth: 40, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceRaised },
  dayButtonOn: { backgroundColor: "#ff7e1a", borderColor: "#ff7e1a" },
  dayButtonText: { color: colors.inkMuted, fontSize: 12, fontWeight: "800" },
  dayButtonTextOn: { color: "#1a0c00" },
  legend: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 10, marginTop: 6 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { height: 8, width: 8, borderRadius: 4 },
  legendText: { fontSize: 11, color: colors.inkMuted, fontWeight: "600" },
  progressTabs: {
    flexDirection: "row",
    gap: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
    padding: 4,
    shadowColor: "#2b251f",
    shadowOpacity: 0.024,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 8 },
    elevation: 1,
  },
  progressTab: {
    flex: 1,
    height: 30,
    borderRadius: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  // Design-3 "compact & info-dense" active tab: solid fill, not a soft tint.
  progressTabOn: { backgroundColor: "#ff7e1a" },
  progressTabText: { color: colors.inkMuted, fontSize: 10, fontWeight: "900" },
  progressTabTextOn: { color: "#fff" },
  achievementsHero: { padding: 14, borderRadius: 16 },
  achievementHeroRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  achievementHeroIcon: {
    height: 32,
    width: 32,
    borderRadius: 12,
    backgroundColor: "#fff3df",
    alignItems: "center",
    justifyContent: "center",
  },
  achievementEyebrow: {
    color: theme.accentStrong,
    fontSize: 9,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.3,
  },
  achievementHeroTitle: { color: colors.ink, fontSize: 16, fontWeight: "700" },
  achievementHeroSub: { marginTop: 2, color: colors.inkMuted, fontSize: 11, lineHeight: 15 },
  achievementHeroChips: { marginTop: 10, gap: 8 },
  achievementHeroChip: { flexDirection: "row", alignItems: "center", gap: 8 },
  achievementHeroChipIcon: { height: 28, width: 28, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  achievementHeroChipValue: { color: colors.ink, fontSize: 13, fontWeight: "800" },
  achievementHeroChipLabel: { color: colors.inkFaint, fontSize: 9, fontWeight: "700" },
  goalRingPct: { color: colors.ink, fontSize: 17, fontWeight: "800" },
  goalRingLabel: { color: colors.inkFaint, fontSize: 8, fontWeight: "700", textTransform: "uppercase" },
  achievementMetricLabel: {
    color: colors.inkFaint,
    fontSize: 8,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.1,
  },
  achievementCard: { padding: 14, borderRadius: 16 },
  achievementCardTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  achievementIcon: { height: 34, width: 34, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  achievementTitleRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  achievementTitle: { color: colors.ink, fontSize: 15, fontWeight: "700" },
  achievementDescription: { marginTop: 2, color: colors.inkMuted, fontSize: 10 },
  achievementBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  achievementBadgeUnlocked: { backgroundColor: "#dcfce7" },
  achievementBadgeText: { fontSize: 8, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 },
  achievementBadgeTextUnlocked: { color: "#16803c" },
  achievementMetrics: { marginTop: 14, flexDirection: "row", gap: 8 },
  achievementMetric: { flex: 1, minWidth: 0 },
  achievementMetricValue: { marginTop: 4, color: colors.ink, fontSize: 20, fontWeight: "700" },
  achievementMetricLongest: { marginTop: 6, color: colors.ink, fontSize: 12, fontWeight: "700" },
  achievementHistory: { flexDirection: "row", justifyContent: "space-between", marginTop: 12 },
  achievementHistoryCol: { alignItems: "center", gap: 3 },
  achievementHistoryDay: { color: colors.inkFaint, fontSize: 9, fontWeight: "700" },
  achievementActions: { flexDirection: "row", gap: 8, marginTop: 14 },
  achievementActionSecondary: {
    flex: 1,
    height: 34,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#ffbe83",
    backgroundColor: "#fff7ed",
    alignItems: "center",
    justifyContent: "center",
  },
  achievementActionSecondaryText: { color: theme.accentStrong, fontSize: 10, fontWeight: "700" },
  achievementActionPrimary: {
    flex: 1,
    height: 34,
    borderRadius: 12,
    backgroundColor: "#ff8a1f",
    alignItems: "center",
    justifyContent: "center",
  },
  achievementActionPrimaryText: { color: "#1a0c00", fontSize: 10, fontWeight: "700" },
  achievementActionDisabled: { backgroundColor: colors.surfaceInset },
  achievementActionDisabledText: { color: colors.inkFaint },
  achievementSkeleton: { height: 170, borderRadius: 16, backgroundColor: colors.surfaceInset },
  achievementsUnavailable: { alignItems: "center", gap: 8, padding: 18 },
  skeletonLineShort: { width: 110, height: 12, borderRadius: 6, backgroundColor: colors.surfaceInset },
  skeletonLine: { marginTop: 10, width: 180, height: 20, borderRadius: 8, backgroundColor: colors.surfaceInset },
  skeletonBar: { marginTop: 14, height: 8, borderRadius: 999, backgroundColor: colors.surfaceInset },
  // Full-screen, in-window overlay (renders over AppFrame at the screen root).
  rewardOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, elevation: 1000 },
  rewardBackdrop: {
    flex: 1,
    justifyContent: "center",
    padding: 18,
    // Very light dim — the soft light blur does most of the work.
    backgroundColor: "rgba(18,24,22,0.05)",
  },
  rewardSheet: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
    padding: 14,
  },
  rewardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  rewardClose: {
    height: 34,
    width: 34,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceInset,
    alignItems: "center",
    justifyContent: "center",
  },
  rewardTitle: { marginTop: 4, color: colors.ink, fontSize: 22, fontWeight: "700" },
  rewardDescription: { marginTop: 6, color: colors.inkMuted, fontSize: 13, lineHeight: 18 },
  rewardBadge: { marginTop: 12, borderRadius: 14, borderWidth: 1, borderColor: `${theme.accentStrong}33`, backgroundColor: theme.accentSoft, padding: 12, alignItems: "center" },
  rewardBadgeText: { color: theme.accentStrong, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.2 },
  rewardBadgeNumber: { marginTop: 2, color: colors.ink, fontSize: 30, fontWeight: "800" },
  rewardBadgeSub: { color: colors.inkMuted, fontSize: 12 },
  rewardDoneBtn: { marginTop: 12, height: 44, borderRadius: radius.md, backgroundColor: theme.accent, alignItems: "center", justifyContent: "center" },
  rewardDoneText: { color: theme.accentInk, fontSize: 15, fontWeight: "800" },
  // Trends — sub-tab switcher
  trendTabs: { flexDirection: "row", gap: 8, paddingVertical: 2 },
  trendTab: { height: 34, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, justifyContent: "center", backgroundColor: colors.surfaceRaised },
  trendTabOn: { borderColor: "#ff7e1a", backgroundColor: "#ff7e1a" },
  trendTabText: { color: colors.inkMuted, fontSize: 13, fontWeight: "800" },
  trendTabTextOn: { color: "#1a0c00" },
  // Trends — summary tiles
  tileRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  trendTile: { flex: 1, minWidth: 0, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceInset, paddingHorizontal: 10, paddingVertical: 8 },
  trendTileLabel: { fontSize: 10, fontWeight: "800", color: colors.inkFaint, textTransform: "uppercase", letterSpacing: 1 },
  trendTileValue: { marginTop: 2, fontSize: 20, fontWeight: "800", color: colors.ink },
  trendTileUnit: { fontSize: 11, fontWeight: "700", color: colors.inkFaint },
  // Trend verdict badge
  badge: { alignSelf: "flex-start", maxWidth: "100%", borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 },
  badgeText: { fontSize: 10, fontWeight: "800" },
  badgeNoData: { fontSize: 10, fontWeight: "700", color: colors.inkFaint, textTransform: "uppercase", letterSpacing: 0.5 },
  // "At a glance" / "How to read this" footers
  insightBox: { marginTop: 12, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceInset, padding: 12 },
  insightKicker: { fontSize: 10, fontWeight: "800", color: colors.inkFaint, textTransform: "uppercase", letterSpacing: 1 },
  insightBody: { marginTop: 4, fontSize: 12, lineHeight: 17, color: colors.inkMuted },
  insightStats: { flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 8 },
  insightStat: { fontSize: 11, color: colors.inkMuted },
  insightStatVal: { fontWeight: "800", color: colors.ink },
  aboutBox: { marginTop: 12, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceInset, padding: 12 },
  aboutBody: { marginTop: 4, fontSize: 12, lineHeight: 18, color: colors.inkMuted },
  // Wellness signal rows
  wellnessRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 9 },
  wellnessRowDivider: { borderTopWidth: 1, borderTopColor: colors.line },
  wellnessLabelCol: { width: 80, flexShrink: 0 },
  wellnessLabel: { fontSize: 12, fontWeight: "700", color: colors.ink },
  wellnessHint: { fontSize: 9, color: colors.inkFaint },
  wellnessSpark: { flex: 1, minWidth: 0 },
  wellnessValue: { width: 42, textAlign: "right", fontSize: 15, fontWeight: "800", color: colors.ink },
  wellnessUnit: { fontSize: 9, fontWeight: "600", color: colors.inkFaint },
  wellnessBadge: { width: 84, alignItems: "flex-end" },
  latestRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  perfLatest: { color: colors.ink, fontSize: 30, fontWeight: "800" },
  perfUnit: { color: colors.inkFaint, fontSize: 14 },
  metricButton: { height: 32, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, justifyContent: "center", backgroundColor: colors.surfaceRaised },
  metricButtonOn: { borderColor: "#ff7e1a", backgroundColor: "#ff7e1a" },
  metricText: { color: colors.inkMuted, fontSize: 12, fontWeight: "800" },
  metricTextOn: { color: "#1a0c00" },
  inputLabel: { marginBottom: 7, color: colors.inkFaint, fontSize: 10, fontWeight: "800", letterSpacing: 1.5, textTransform: "uppercase" },
  compactField: { height: 38, borderRadius: radius.sm, fontSize: 13, paddingHorizontal: 12 },
  logTextFieldNative: { height: 32, borderRadius: 9, fontSize: 10.5, paddingHorizontal: 9, backgroundColor: colors.surfaceInset },
  scaleHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  scaleLabel: { color: colors.ink, fontSize: 12, fontWeight: "800" },
  scaleLabelCard: { fontSize: 10.2, lineHeight: 13, fontWeight: "900" },
  scaleLabelDense: { fontSize: 8.2, lineHeight: 10 },
  scaleValue: { color: theme.accentStrong, fontSize: 11, fontWeight: "800" },
  scaleValueCard: { fontSize: 10.5, lineHeight: 13, color: LOG_SCALE_ORANGE, fontWeight: "900" },
  scaleValueDense: { fontSize: 9 },
  meterRow: { flexDirection: "row", alignItems: "flex-end", height: 32, gap: 3 },
  meterRowCard: { height: 9, gap: 3, marginTop: 3 },
  meterRowDense: { height: 7, gap: 2, marginTop: 2 },
  meterBar: { flex: 1, borderRadius: 3 },
  meterBarCard: { height: "100%" },
  meterBarDense: { borderRadius: 2 },
  meterBarFilled: { backgroundColor: theme.accentStrong },
  meterBarEmpty: { backgroundColor: colors.surfaceInset, borderWidth: 1, borderColor: colors.line },
  meterBarFilledCard: { backgroundColor: LOG_SCALE_ORANGE },
  meterBarEmptyCard: { backgroundColor: "#f0f1ec", borderWidth: 0 },
  scaleHints: { flexDirection: "row", justifyContent: "space-between" },
  scaleHint: { color: colors.inkFaint, fontSize: 9, fontWeight: "700", textTransform: "uppercase" },
  scaleHintCard: { fontSize: 8, lineHeight: 10 },
  scaleHintDense: { fontSize: 6.7, letterSpacing: 0.2 },
  scaleCard: {
    minHeight: 37,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  scaleCardDense: { minHeight: 35, paddingHorizontal: 6, paddingVertical: 4 },
  scaleCardHeader: { flexDirection: "row", alignItems: "center", gap: 5 },
  scaleIcon: { height: 20, width: 20, borderRadius: 10, backgroundColor: "#fff4eb", borderWidth: 1, borderColor: "#f5eadf", alignItems: "center", justifyContent: "center" },
  scaleIconDense: { height: 17, width: 17, borderRadius: 9 },
  scaleCardCopy: { flex: 1, minWidth: 0 },
  scaleValueBlock: { alignItems: "flex-end", minWidth: 24 },
  choiceGrid: { flexDirection: "row", gap: 8 },
  choiceGridCompact: { gap: 0, borderRadius: 9, borderWidth: 1, borderColor: colors.line, overflow: "hidden", backgroundColor: colors.surfaceInset },
  choice: { flex: 1, minHeight: 34, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceInset, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  choiceCompact: { minHeight: 28, borderRadius: 0, borderTopWidth: 0, borderBottomWidth: 0, borderLeftWidth: 0, borderRightWidth: 1, backgroundColor: colors.surfaceInset, paddingHorizontal: 5 },
  choiceOn: { backgroundColor: "#ff7e1a", borderColor: "#ff7e1a" },
  choiceText: { color: colors.inkMuted, fontSize: 11, fontWeight: "800" },
  choiceTextCompact: { fontSize: 8.6 },
  choiceTextOn: { color: "#1a0c00" },
  compactButton: {
    marginTop: 4,
    height: 32,
    borderRadius: 9,
    backgroundColor: "#ff6b10",
    alignItems: "center",
    justifyContent: "center",
  },
  compactButtonDisabled: { opacity: 0.45 },
  compactButtonDone: { backgroundColor: colors.ok },
  compactButtonRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  compactButtonText: { color: "#ffffff", fontSize: 11.5, fontWeight: "900" },
  // Log checklist hub
  logHub: { padding: 0, overflow: "hidden" },
  logHubNative: {
    borderRadius: 18,
    shadowOpacity: 0.024,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 8 },
    elevation: 1,
  },
  logHubHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 },
  logHubHeadNative: { paddingHorizontal: 10, paddingTop: 9, paddingBottom: 6 },
  logTitleNative: { fontSize: 10.5, letterSpacing: 0.9 },
  logProgressLine: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 },
  logProgressLineNative: { gap: 7, marginTop: 5 },
  logProgressTrack: { flex: 1, height: 8, borderRadius: 999, backgroundColor: colors.surfaceInset, overflow: "hidden" },
  logProgressFill: { height: 8, borderRadius: 999, backgroundColor: "#ff6b10" },
  logProgressPill: { borderRadius: 999, backgroundColor: colors.surfaceInset, paddingHorizontal: 10, paddingVertical: 4 },
  logProgressPillNative: { paddingHorizontal: 9, paddingVertical: 4 },
  logProgressPillDone: { backgroundColor: `${colors.ok}1e` },
  logProgressText: { fontSize: 11, fontWeight: "800", color: colors.inkMuted, letterSpacing: 0.3 },
  logProgressTextDone: { color: colors.ok },
  restDayPanel: { marginHorizontal: 16, marginVertical: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceInset, padding: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  restDayPanelNative: { marginHorizontal: 10, marginVertical: 5, borderRadius: 14, paddingHorizontal: 8, paddingVertical: 5, gap: 8, backgroundColor: colors.surfaceInset },
  restIconBadge: { height: 31, width: 31, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.line },
  restIconBadgeOn: { backgroundColor: "#ff7e1a", borderColor: "#ff7e1a" },
  restDayTitle: { color: colors.ink, fontSize: 14, fontWeight: "800" },
  restDayTitleNative: { fontSize: 11.5, lineHeight: 14 },
  restDayText: { marginTop: 2, color: colors.inkMuted, fontSize: 11, lineHeight: 15 },
  restDayTextNative: { fontSize: 9.2, lineHeight: 12 },
  restToggle: { height: 36, width: 48, borderRadius: 999, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" },
  restToggleNative: { height: 26, width: 34 },
  restToggleOn: { borderColor: theme.accentStrong, backgroundColor: theme.accentStrong },
  sessionTabs: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  sessionTabsNative: { gap: 6, paddingHorizontal: 10, paddingBottom: 7 },
  sessionTab: {
    flex: 1,
    minHeight: 82,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceInset,
    paddingHorizontal: 10,
    paddingVertical: 10,
    justifyContent: "space-between",
  },
  sessionTabNative: { minHeight: 49, borderRadius: 12, paddingHorizontal: 7, paddingVertical: 5 },
  sessionTabActive: { borderColor: "#ff7e1a", backgroundColor: "#fff3e8" },
  sessionTabDone: { borderColor: `${colors.ok}55` },
  sessionTabTop: { minHeight: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 4 },
  sessionTabCheck: { height: 14, width: 14, borderRadius: 7, backgroundColor: "#ff7e1a", alignItems: "center", justifyContent: "center" },
  sessionTabLabel: { color: colors.inkFaint, fontSize: 11, fontWeight: "900", letterSpacing: 1.3, textTransform: "uppercase" },
  sessionTabLabelActive: { color: "#f26a0a" },
  sessionTabTitle: { marginTop: 3, color: colors.ink, fontSize: 12, fontWeight: "900", lineHeight: 14 },
  sessionTabStatusPill: { marginTop: 3, alignSelf: "flex-start", borderRadius: 999, backgroundColor: "#eef0ea", paddingHorizontal: 6, paddingVertical: 2 },
  sessionTabMeta: { color: colors.inkMuted, fontSize: 10, fontWeight: "800" },
  sessionFormPanel: {
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
    padding: 12,
  },
  sessionFormPanelNative: { marginHorizontal: 10, marginBottom: 8, borderRadius: 14, padding: 8 },
  sessionFormTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  sessionFormTitle: { color: colors.ink, fontSize: 16, fontWeight: "800" },
  sessionFormTitleNative: { fontSize: 12.5, lineHeight: 16, textTransform: "uppercase", letterSpacing: 0.2 },
  logRowWrap: { borderTopWidth: 1, borderTopColor: colors.line },
  logRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 14 },
  logRowTitle: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: "700", color: colors.ink },
  logRowStatus: { fontSize: 12, fontWeight: "600", color: colors.inkFaint, maxWidth: 132, textAlign: "right" },
  logRowStatusDone: { color: colors.inkMuted },
  logRowBody: { paddingHorizontal: 16, paddingBottom: 16, paddingTop: 2 },
  sessionMetaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12 },
  logFieldRow: { flexDirection: "row", gap: 7, marginTop: 9, alignItems: "flex-start" },
  logFieldRowStacked: { flexDirection: "column" },
  logWorkoutField: { flex: 1.35, minWidth: 0 },
  logSmallField: { flex: 0.72, minWidth: 0 },
  logFieldFull: { width: "100%" },
  logScaleStack: { gap: 4, marginTop: 7 },
  logDenseScaleRow: { gap: 6, marginTop: 4 },
  logSaveWrap: { marginTop: 6 },
  logStackNative: { gap: 6 },
  formError: { marginTop: 8, color: colors.bad, fontSize: 12, fontWeight: "700" },
  segmentRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  estLoad: { color: colors.inkMuted, fontSize: 13, fontWeight: "700" },
  trainingChip: { borderRadius: 999, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceInset, paddingHorizontal: 12, paddingVertical: 9 },
  trainingChipOn: { borderColor: theme.accentStrong, backgroundColor: theme.accentSoft },
  trainingText: { color: colors.inkMuted, fontSize: 11, fontWeight: "800" },
  trainingTextOn: { color: theme.accentStrong },
  // Web-style dropdown
  dropdownField: { marginTop: 6, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, height: 46, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceInset, paddingHorizontal: 12 },
  dropdownFieldCompact: { height: 32, marginTop: 0, borderRadius: 9, backgroundColor: colors.surfaceInset, paddingHorizontal: 9, gap: 5 },
  dropdownValue: { flex: 1, minWidth: 0, color: colors.ink, fontSize: 14, fontWeight: "700" },
  dropdownValueCompact: { fontSize: 9.7, fontWeight: "800" },
  dropdownBackdrop: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "rgba(18,24,22,0.35)" },
  dropdownSheet: { maxHeight: "80%", borderRadius: radius.lg, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surfaceRaised, paddingVertical: 8, paddingHorizontal: 6 },
  dropdownSheetTitle: { paddingHorizontal: 10, paddingVertical: 8, fontSize: 11, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase", color: colors.inkFaint },
  // Quick check-in — bottom sheet chrome (drag handle + title + close), mirrors the web app's popup.
  quickCheckInBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(18,24,22,0.4)" },
  quickCheckInSheet: { maxHeight: "88%", borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, borderWidth: 1, borderColor: colors.lineStrong, borderBottomWidth: 0, backgroundColor: colors.surfaceRaised },
  quickCheckInHandle: { alignSelf: "center", marginTop: 8, height: 4, width: 40, borderRadius: 2, backgroundColor: colors.lineStrong },
  quickCheckInHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.line },
  quickCheckInTitle: { fontSize: 17, fontWeight: "700", color: colors.ink },
  quickCheckInClose: { height: 32, width: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceInset },
  quickCheckInBody: { paddingHorizontal: 16, paddingVertical: 16 },
  dropdownItem: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 12 },
  dropdownItemOn: { backgroundColor: colors.surfaceInset },
  dropdownItemText: { flex: 1, color: colors.ink, fontSize: 14, fontWeight: "600" },
  dropdownItemTextOn: { color: theme.accentStrong, fontWeight: "800" },
  twoCols: { flexDirection: "row", gap: 12 },
  recoveryWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  recoveryChip: { borderRadius: 999, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceInset, paddingHorizontal: 12, paddingVertical: 9 },
  recoveryChipOn: { borderColor: theme.accentStrong, backgroundColor: theme.accentSoft },
  recoveryText: { color: colors.inkMuted, fontSize: 12, fontWeight: "800" },
  recoveryTextOn: { color: theme.accentStrong },
  noteBox: { minHeight: 92, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceInset, paddingHorizontal: 12, paddingVertical: 10, color: colors.ink, fontSize: 14, fontFamily: "Inter_400Regular", fontWeight: "normal", includeFontPadding: false, textAlignVertical: "top" },
  noteBoxNative: { minHeight: 48, borderRadius: 9, backgroundColor: colors.surfaceInset, paddingHorizontal: 9, paddingVertical: 7, paddingBottom: 15, fontSize: 9.5, lineHeight: 12 },
  noteCount: { position: "absolute", right: 9, bottom: 7, color: colors.inkFaint, fontSize: 7.5, fontWeight: "700" },
  noteItem: { borderLeftWidth: 3, borderLeftColor: theme.accentStrong, backgroundColor: colors.surfaceInset, borderRadius: radius.md, padding: 10 },
  noteText: { color: colors.ink, fontSize: 13 },
  logNotesRow: { flexDirection: "row", gap: 8, marginTop: 6, alignItems: "stretch" },
  logNotesRowStacked: { flexDirection: "column" },
  logNotesCol: { flex: 1, minWidth: 0, position: "relative" },
  logPhotoCol: { width: 76, position: "relative" },
  sessionPhotoRow: { marginTop: 6, flexDirection: "row", flexWrap: "wrap", gap: 7, alignItems: "center" },
  sessionPhotoThumb: { width: 42, height: 42, borderRadius: 9, backgroundColor: colors.surfaceInset },
  sessionPhotoButton: { width: "100%", minHeight: 48, flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, borderRadius: 9, borderWidth: 1, borderStyle: "dashed", borderColor: colors.lineStrong, backgroundColor: colors.surfaceRaised, overflow: "hidden" },
  sessionPhotoButtonText: { fontSize: 8, fontWeight: "800", color: colors.inkMuted },
  sessionPhotoPreviewRow: { position: "relative" },
  sessionPhotoPreviewImage: { width: "100%", height: "100%", borderRadius: 9, backgroundColor: colors.surfaceInset },
  sessionPhotoPreviewRemove: { position: "absolute", top: -6, right: -6, height: 20, width: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.line },
  coachSectionStack: { gap: 8 },
  coachPanel: {
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 18,
    shadowOpacity: 0.024,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 8 },
    elevation: 1,
  },
  coachActivityPanel: { paddingBottom: 8 },
  coachPanelHeader: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 8 },
  coachActivityHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 },
  coachActivityHeaderTitle: { marginBottom: 0, flex: 1 },
  coachHeaderIcon: {
    height: 18,
    width: 18,
    borderRadius: 9,
    backgroundColor: "#fff3e8",
    alignItems: "center",
    justifyContent: "center",
  },
  coachPanelTitle: { flex: 1, fontSize: 12, lineHeight: 15, letterSpacing: 0.9 },
  coachCardList: { gap: 7 },
  coachUpdateRow: {
    minHeight: 58,
    borderRadius: 10,
    borderWidth: 1,
    borderLeftWidth: 3,
    borderColor: colors.line,
    borderLeftColor: COACH_SECTION_ORANGE,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 8,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  coachUpdateIcon: {
    height: 30,
    width: 30,
    borderRadius: 15,
    backgroundColor: "#fff3e8",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  coachUpdateCopy: { flex: 1, minWidth: 0 },
  coachUpdateBody: { color: colors.ink, fontSize: 12.2, lineHeight: 16, fontWeight: "800" },
  coachUpdateMeta: { marginTop: 4, color: colors.inkFaint, fontSize: 9, lineHeight: 11, textTransform: "uppercase", letterSpacing: 0.9, fontWeight: "900" },
  coachFeedbackRow: {
    minHeight: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceInset,
    paddingHorizontal: 9,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  coachFeedbackIcon: {
    height: 28,
    width: 28,
    borderRadius: 14,
    backgroundColor: "#fff3e8",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  coachFeedbackText: { flex: 1, minWidth: 0, color: colors.ink, fontSize: 12.2, lineHeight: 16, fontWeight: "800" },
  coachEmptyPanel: {
    minHeight: 45,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceInset,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  coachEmptyIcon: {
    height: 26,
    width: 26,
    borderRadius: 13,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  coachEmptyText: { flex: 1, color: colors.inkMuted, fontSize: 12, lineHeight: 15, fontWeight: "700" },
  coachViewAllButton: { flexDirection: "row", alignItems: "center", gap: 2, paddingLeft: 8, paddingVertical: 3 },
  coachViewAllText: { color: COACH_SECTION_ORANGE, fontSize: 9.4, lineHeight: 12, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.8 },
  accentItem: { borderLeftWidth: 3, borderLeftColor: theme.accentStrong, backgroundColor: `${theme.accent}0f`, borderRadius: radius.md, padding: 10 },
  insetItem: { borderLeftWidth: 3, borderLeftColor: colors.inkFaint, backgroundColor: colors.surfaceInset, borderRadius: radius.md, padding: 10 },
  itemBody: { color: colors.ink, fontSize: 13, lineHeight: 18 },
  itemMeta: { marginTop: 5, color: colors.inkFaint, fontSize: 10, textTransform: "uppercase", letterSpacing: 1 },
  timeline: { position: "relative", gap: 14, marginTop: 12 },
  timelineCompact: { gap: 8, marginTop: 0 },
  timelineLine: { position: "absolute", left: 17, top: 36, bottom: 18, width: 1, backgroundColor: colors.line },
  timelineLineCompact: { left: 12, top: 26, bottom: 12, backgroundColor: "rgba(17,30,17,0.07)" },
  timelineItem: { position: "relative", flexDirection: "row", alignItems: "flex-start", gap: 12 },
  timelineItemCompact: { gap: 9, minHeight: 38 },
  timelineIconBadge: {
    height: 36,
    width: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  timelineIconBadgeCompact: { height: 28, width: 28, borderRadius: 14 },
  timelineTitleRow: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  timelineTitle: { flex: 1, color: colors.ink, fontSize: 13, fontWeight: "800", lineHeight: 18 },
  timelineTitleCompact: { fontSize: 11.2, lineHeight: 14, fontWeight: "900" },
  timelineTime: { color: colors.inkFaint, fontSize: 10, fontWeight: "700", textTransform: "uppercase" },
  timelineTimeCompact: { fontSize: 9, lineHeight: 11, fontWeight: "900" },
  timelineDetail: { color: colors.inkMuted, fontSize: 11, lineHeight: 15 },
  timelineDetailCompact: { fontSize: 9.5, lineHeight: 12, fontWeight: "600" },
  directChat: { flex: 1, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, backgroundColor: "#fbfaf6" },
  directTopRow: { minHeight: 42, justifyContent: "center", alignItems: "flex-start" },
  directBack: {
    height: 38,
    width: 38,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: "rgba(31,35,32,0.08)",
    backgroundColor: "#fffefd",
    alignItems: "center",
    justifyContent: "center",
  },
  directThread: { flex: 1, justifyContent: "center" },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", paddingBottom: 70 },
  emptyText: { color: colors.inkMuted, fontSize: 14, textAlign: "center" },
  emptySub: { marginTop: 7, color: colors.inkFaint, fontSize: 11, textAlign: "center" },
  directError: { color: colors.bad, fontSize: 12, marginBottom: 8 },
  directMessageList: { flexGrow: 1, justifyContent: "flex-end", gap: 8, paddingVertical: 10 },
  dayMarker: {
    alignSelf: "center",
    color: colors.inkFaint,
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginVertical: 8,
  },
  messageRow: { flexDirection: "row", justifyContent: "flex-start" },
  messageRowMine: { justifyContent: "flex-end" },
  messageBubble: { maxWidth: "84%", borderRadius: 17, paddingHorizontal: 12, paddingVertical: 10 },
  messageBubbleMine: { backgroundColor: "#ff6b10" },
  messageBubbleOther: {
    backgroundColor: "#fffefd",
    borderWidth: 1,
    borderColor: "rgba(31,35,32,0.075)",
    shadowColor: "#2b251f",
    shadowOpacity: 0.018,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 1,
  },
  messageBody: { color: "#111514", fontSize: 14.5, lineHeight: 20 },
  messageBodyMine: { color: "#ffffff", fontWeight: "600" },
  messageTime: { marginTop: 4, color: "#767e77", fontSize: 10.5, textAlign: "right", fontWeight: "800" },
  messageTimeMine: { color: "rgba(255,255,255,0.9)" },
  directComposer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(31,35,32,0.075)",
    paddingTop: 10,
    backgroundColor: "#fbfaf6",
  },
  directInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 112,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(255,107,16,0.42)",
    backgroundColor: "#fffefd",
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: colors.ink,
    fontSize: 14.5,
    fontFamily: "Inter_400Regular",
    fontWeight: "normal",
    includeFontPadding: false,
    textAlignVertical: "top",
  },
  directSend: {
    height: 44,
    width: 44,
    borderRadius: radius.md,
    backgroundColor: "#ff6b10",
    alignItems: "center",
    justifyContent: "center",
  },
  directSendOn: {
    shadowColor: "#db5b09",
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },
  directSendOff: { backgroundColor: "#e8ded1" },
  threadPickerList: { gap: 10, paddingVertical: 10 },
  threadPickerItem: {
    minHeight: 68,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
  },
  threadPickerItemOn: { borderColor: theme.accentStrong, backgroundColor: theme.accentSoft },
  threadAvatar: { height: 42, width: 42, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceInset },
  threadAvatarOn: { backgroundColor: theme.accentStrong },
  threadAvatarText: { color: colors.inkMuted, fontSize: 16, fontWeight: "900" },
  threadAvatarTextOn: { color: theme.accentInk },
  threadName: { color: colors.ink, fontSize: 15, fontWeight: "800" },
  threadMeta: { marginTop: 2, color: colors.inkMuted, fontSize: 12 },
  threadUnread: { height: 9, width: 9, borderRadius: 5, backgroundColor: colors.bad },
});
