import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "../../components/AppText";
import { Avatar } from "../../components/Avatar";
import { TimeField } from "../../components/DateTimeField";
import { ActionButton, AppCard, BackHeader, FadeIn, FormField, ProgressBar, ScreenContainer, StatusChip } from "../../components/fitora";
import { apiFetch, apiJson } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { deviceTimeZone, minutesToTime } from "../../lib/dateTimeValues";
import { celebrate, errorFeedback, selectionFeedback } from "../../lib/feedback";
import type { CoachAvailabilityRule, CoachOwnProfile } from "../../lib/fitoraData";
import {
  COACH_BIO_MAX,
  COACH_SPECIALTIES,
  MAX_SPECIALTIES,
  buildAvailabilityRules,
  markOnboardingSeen,
  type HoursWindow,
} from "../../lib/onboarding";
import { colors, fonts, radius } from "../../lib/theme";

// One-time coach setup: what you coach, a short bio, bookable hours, then a
// preview of the public profile with the choice to list it. This is the only
// setup checklist; the Profile tab sends unfinished coaches back here.

type Step = "specialty" | "bio" | "hours" | "live";
const STEPS: Step[] = ["specialty", "bio", "hours", "live"];

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DEFAULT_DAYS = [1, 2, 3, 4, 5];
const DEFAULT_WINDOWS: HoursWindow[] = [
  { start: "06:00", end: "09:00" },
  { start: "18:00", end: "20:00" },
];
const OTHER = "Other";
const SAVE_ERROR = "Couldn't save that. Check your connection and try again.";
const BIO_EXAMPLE = "I help busy professionals lose fat and get strong with 3 short sessions a week.";

function isStep(value: unknown): value is Step {
  return typeof value === "string" && (STEPS as string[]).includes(value);
}

function formatTime(value: string): string {
  const [h, m] = value.split(":").map(Number);
  const suffix = h < 12 ? "am" : "pm";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

function hoursSummary(days: number[], windows: HoursWindow[]): string {
  if (!days.length || !windows.length) return "No bookable hours yet";
  const dayText = days.length === 5 && DEFAULT_DAYS.every((d) => days.includes(d)) ? "Mon to Fri" : days.map((d) => DAY_LABELS[d]).join(", ");
  return `${dayText}, ${windows.map((w) => `${formatTime(w.start)} to ${formatTime(w.end)}`).join(" and ")}`;
}

export default function CoachOnboarding() {
  const router = useRouter();
  const params = useLocalSearchParams<{ start?: string }>();
  const { user } = useAuth();
  const [step, setStep] = useState<Step>(() => (isStep(params.start) ? params.start : "specialty"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [specialties, setSpecialties] = useState<string[]>([]);
  const [otherSpecialty, setOtherSpecialty] = useState("");
  const [years, setYears] = useState("");
  const [bio, setBio] = useState("");
  const [days, setDays] = useState<number[]>(DEFAULT_DAYS);
  const [windows, setWindows] = useState<HoursWindow[]>(DEFAULT_WINDOWS);
  const [savedRuleCount, setSavedRuleCount] = useState(0);
  // Saved hours may use custom session lengths; only rewrite them when edited here.
  const [hoursEdited, setHoursEdited] = useState(false);
  const [listed, setListed] = useState(false);
  const [timezone] = useState(() => deviceTimeZone());

  useEffect(() => {
    if (user?.id) void markOnboardingSeen(user.id);
  }, [user?.id]);

  // Fill in what's already saved (e.g. coming back from the Profile tab).
  useEffect(() => {
    let active = true;
    Promise.all([
      apiJson<{ profile: CoachOwnProfile }>("/api/coach/profile").catch(() => null),
      apiJson<{ rules: CoachAvailabilityRule[] }>("/api/coach/availability").catch(() => null),
    ]).then(([profileRes, availabilityRes]) => {
      if (!active) return;
      const profile = profileRes?.profile;
      if (profile) {
        const known = profile.specializations.filter((tag) => (COACH_SPECIALTIES as readonly string[]).includes(tag));
        const others = profile.specializations.filter((tag) => !(COACH_SPECIALTIES as readonly string[]).includes(tag));
        setSpecialties(others.length ? [...known, OTHER] : known);
        setOtherSpecialty(others.join(", "));
        if (profile.yearsExperience != null) setYears(String(profile.yearsExperience));
        if (profile.bio) setBio(profile.bio);
        setListed(Boolean(profile.active));
      }
      const rules = availabilityRes?.rules ?? [];
      setSavedRuleCount(rules.length);
      if (rules.length) {
        setDays([...new Set(rules.map((rule) => rule.dayOfWeek))].sort((a, b) => a - b));
        const seen = new Map<string, HoursWindow>();
        for (const rule of rules) {
          const window = { start: minutesToTime(rule.startMinute), end: rule.endMinute >= 1440 ? "23:59" : minutesToTime(rule.endMinute) };
          seen.set(`${window.start}-${window.end}`, window);
        }
        setWindows([...seen.values()].sort((a, b) => a.start.localeCompare(b.start)));
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const index = STEPS.indexOf(step);
  const chosenSpecialties = [
    ...specialties.filter((tag) => tag !== OTHER),
    ...(specialties.includes(OTHER) ? otherSpecialty.split(",").map((tag) => tag.trim()).filter(Boolean) : []),
  ].slice(0, MAX_SPECIALTIES);

  function go(next: Step) {
    setError(null);
    setStep(next);
  }

  function next() {
    if (index < STEPS.length - 1) go(STEPS[index + 1]);
  }

  function back() {
    if (index > 0) go(STEPS[index - 1]);
    else finish();
  }

  function finish() {
    router.replace("/coach/dashboard" as never);
  }

  async function request(path: string, init: RequestInit): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(path, init);
      if (!res.ok) {
        errorFeedback();
        setError(SAVE_ERROR);
        return false;
      }
      return true;
    } catch {
      errorFeedback();
      setError(SAVE_ERROR);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function toggleSpecialty(tag: string) {
    selectionFeedback();
    if (specialties.includes(tag)) {
      setError(null);
      setSpecialties(specialties.filter((item) => item !== tag));
    } else if (specialties.length >= MAX_SPECIALTIES) {
      errorFeedback();
      setError(`Pick up to ${MAX_SPECIALTIES}.`);
    } else {
      setError(null);
      setSpecialties([...specialties, tag]);
    }
  }

  async function saveSpecialty() {
    const body: Record<string, unknown> = {};
    if (chosenSpecialties.length) {
      body.specializations = chosenSpecialties;
      if (chosenSpecialties.includes("Nutrition")) body.nutritionSupport = true;
    }
    if (years.trim()) {
      const value = Number(years);
      if (!Number.isFinite(value) || value < 0 || value > 60) {
        errorFeedback();
        setError("Enter your years of coaching as a number from 0 to 60.");
        return;
      }
      body.yearsExperience = Math.round(value);
    }
    if (!Object.keys(body).length) return next();
    if (await request("/api/coach/profile", { method: "PATCH", body: JSON.stringify(body) })) next();
  }

  async function saveBio() {
    if (!bio.trim()) return next();
    if (await request("/api/coach/profile", { method: "PATCH", body: JSON.stringify({ bio: bio.trim() }) })) next();
  }

  async function saveHours() {
    if (savedRuleCount && !hoursEdited) return next();
    const built = buildAvailabilityRules(days, windows, timezone);
    if (built.error !== null) {
      errorFeedback();
      setError(built.error);
      return;
    }
    if (await request("/api/coach/availability", { method: "PUT", body: JSON.stringify({ rules: built.rules }) })) {
      setSavedRuleCount(built.rules.length);
      setHoursEdited(false);
      next();
    }
  }

  async function goLive() {
    if (await request("/api/coach/profile/activate", { method: "POST" })) {
      celebrate({ title: "You're listed", body: "Athletes can now find you.", big: true });
      finish();
    }
  }

  function updateWindow(i: number, patch: Partial<HoursWindow>) {
    setError(null);
    setHoursEdited(true);
    setWindows((prev) => prev.map((window, j) => (j === i ? { ...window, ...patch } : window)));
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
      <ScreenContainer contentStyle={styles.content}>
        <BackHeader
          title={step === "live" ? "Your profile" : "Set up"}
          subtitle={step === "live" ? undefined : `Step ${index + 1} of ${STEPS.length - 1}`}
          onBack={back}
          actionLabel={step !== "live" ? "Skip" : undefined}
          onAction={step !== "live" ? next : undefined}
        />
        {step !== "live" ? <ProgressBar value={(index + 1) / (STEPS.length - 1)} height={6} /> : null}

        <FadeIn key={step} style={styles.step}>
          {step === "specialty" ? (
            <>
              <Question title="What do you coach?" sub={`Pick up to ${MAX_SPECIALTIES}. Athletes filter coaches by these.`} />
              <Chips options={[...COACH_SPECIALTIES, OTHER]} selected={specialties} onToggle={toggleSpecialty} />
              {specialties.includes(OTHER) ? (
                <FormField value={otherSpecialty} onChangeText={setOtherSpecialty} placeholder="e.g. Kabaddi, prenatal fitness" accessibilityLabel="Other specialties" containerStyle={styles.fixedField} />
              ) : null}
              <View style={styles.group}>
                <Text style={styles.groupLabel}>Years coaching (optional)</Text>
                <FormField value={years} onChangeText={(v) => { setYears(v); setError(null); }} keyboardType="number-pad" placeholder="e.g. 4" accessibilityLabel="Years coaching" style={styles.yearsField} containerStyle={styles.fixedField} />
              </View>
              <ActionButton style={styles.cta} label="Continue" variant="filled" onPress={saveSpecialty} busy={busy} />
            </>
          ) : null}

          {step === "bio" ? (
            <>
              <Question title="Say hello in 2 lines" sub="Athletes read this first. Say who you help and how." />
              <FormField
                value={bio}
                onChangeText={(v) => setBio(v.slice(0, COACH_BIO_MAX))}
                placeholder={BIO_EXAMPLE}
                multiline
                textAlignVertical="top"
                style={styles.bio}
                containerStyle={styles.fixedField}
                accessibilityLabel="Your bio"
              />
              <Text style={styles.count}>{bio.length} / {COACH_BIO_MAX}</Text>
              <ActionButton style={styles.cta} label="Continue" variant="filled" onPress={saveBio} busy={busy} />
            </>
          ) : null}

          {step === "hours" ? (
            <>
              <Question title="When can clients book you?" sub="For video sessions. You can change this any time." />
              <View style={styles.chips}>
                {DAY_LABELS.map((label, day) => {
                  const on = days.includes(day);
                  return (
                    <Pressable
                      key={label}
                      onPress={() => {
                        selectionFeedback();
                        setError(null);
                        setHoursEdited(true);
                        setDays((prev) => (on ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b)));
                      }}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      style={({ pressed }) => [styles.chip, on ? styles.chipOn : null, pressed ? styles.pressed : null]}
                    >
                      <Text style={[styles.chipText, on ? styles.chipTextOn : null]}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.windows}>
                {windows.map((window, i) => (
                  <View key={i} style={styles.windowRow}>
                    <TimeField value={window.start} onChange={(v) => updateWindow(i, { start: v })} accessibilityLabel={`Window ${i + 1} start`} style={styles.flex} />
                    <Text style={styles.to}>to</Text>
                    <TimeField value={window.end} onChange={(v) => updateWindow(i, { end: v })} accessibilityLabel={`Window ${i + 1} end`} style={styles.flex} />
                    <Pressable
                      onPress={() => {
                        setHoursEdited(true);
                        setWindows((prev) => prev.filter((_, j) => j !== i));
                      }}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove window ${i + 1}`}
                      style={({ pressed }) => [styles.remove, pressed ? styles.pressed : null]}
                    >
                      <Ionicons name="close" size={18} color={colors.inkMuted} />
                    </Pressable>
                  </View>
                ))}
                {windows.length < 4 ? (
                  <Pressable onPress={() => {
                    setHoursEdited(true);
                    setWindows((prev) => [...prev, { start: "12:00", end: "13:00" }]);
                  }} accessibilityRole="button" style={({ pressed }) => [styles.addRow, pressed ? styles.pressed : null]}>
                    <Ionicons name="add" size={18} color={colors.primary} />
                    <Text style={styles.addText}>Add hours</Text>
                  </Pressable>
                ) : null}
              </View>
              <Text style={styles.note}>Times in {timezone.replace(/_/g, " ")}. 30-minute sessions, 10 minutes apart.</Text>
              <ActionButton style={styles.cta} label="Continue" variant="filled" onPress={saveHours} busy={busy} />
            </>
          ) : null}

          {step === "live" ? (
            <>
              <Question title="This is what athletes see" sub={listed ? "You're already listed." : "List your profile so athletes can find and book you."} />
              <AppCard style={styles.preview}>
                <View style={styles.previewHead}>
                  <Avatar avatar={user?.avatar} name={user?.name ?? "Coach"} size={52} accentSoft={colors.primarySoft} accentStrong={colors.primary} />
                  <View style={styles.flex}>
                    <Text style={styles.previewName} numberOfLines={1}>{user?.name ?? "You"}</Text>
                    {years.trim() ? <Text style={styles.previewMeta}>{Number(years) === 1 ? "1 year" : `${Math.round(Number(years))} years`} coaching</Text> : null}
                  </View>
                </View>
                {chosenSpecialties.length ? (
                  <View style={styles.tags}>
                    {chosenSpecialties.map((tag) => <StatusChip key={tag} label={tag} tone="primary" />)}
                  </View>
                ) : null}
                <Text style={bio.trim() ? styles.previewBio : styles.previewMissing}>{bio.trim() || "No bio yet. Athletes are more likely to pick a coach with one."}</Text>
                <View style={styles.previewHours}>
                  <Ionicons name="calendar-outline" size={16} color={colors.inkMuted} />
                  <Text style={styles.previewMeta}>{savedRuleCount ? hoursSummary(days, windows) : "No bookable hours yet"}</Text>
                </View>
              </AppCard>
              {listed ? (
                <ActionButton style={styles.cta} label="Go to Home" variant="filled" onPress={finish} />
              ) : (
                <>
                  <ActionButton style={styles.cta} label="List My Profile" variant="filled" onPress={goLive} busy={busy} />
                  <Pressable onPress={finish} hitSlop={8} accessibilityRole="button" style={({ pressed }) => [styles.link, pressed ? styles.pressed : null]}>
                    <Text style={styles.linkText}>Not yet, keep it hidden</Text>
                  </Pressable>
                </>
              )}
              <Text style={styles.note}>Next: add your first client from Home.</Text>
            </>
          ) : null}

          {error ? (
            <View style={styles.errorRow} accessibilityLiveRegion="polite">
              <Ionicons name="alert-circle" size={18} color={colors.bad} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
        </FadeIn>
      </ScreenContainer>
    </KeyboardAvoidingView>
  );
}

function Question({ title, sub }: { title: string; sub: string }) {
  return (
    <View style={styles.question}>
      <Text style={styles.questionTitle} accessibilityRole="header">{title}</Text>
      <Text style={styles.sub}>{sub}</Text>
    </View>
  );
}

function Chips({ options, selected, onToggle }: { options: readonly string[]; selected: string[]; onToggle: (value: string) => void }) {
  return (
    <View style={styles.chips}>
      {options.map((option) => {
        const on = selected.includes(option);
        return (
          <Pressable
            key={option}
            onPress={() => onToggle(option)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            style={({ pressed }) => [styles.chip, on ? styles.chipOn : null, pressed ? styles.pressed : null]}
          >
            <Text style={[styles.chipText, on ? styles.chipTextOn : null]}>{option}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { gap: 14 },
  step: { gap: 16 },
  question: { gap: 6, marginTop: 4 },
  questionTitle: { color: colors.ink, fontFamily: fonts.display, textTransform: "uppercase", fontSize: 34, lineHeight: 34 },
  sub: { color: colors.inkMuted, fontSize: 14, lineHeight: 20, fontWeight: "600" },
  group: { gap: 2 },
  groupLabel: { color: colors.inkMuted, fontSize: 13, fontWeight: "700", marginBottom: 6 },
  // ActionButton and FormField grow by default (made for rows); in this column they keep their own height.
  fixedField: { flexGrow: 0, flexShrink: 0, flexBasis: "auto" },
  cta: { flexGrow: 0, flexShrink: 0, flexBasis: "auto", minHeight: 50 },
  yearsField: { width: 140 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.lineStrong },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.inkMuted, fontSize: 14, fontWeight: "700" },
  chipTextOn: { color: colors.onPrimary },
  bio: { height: 128, paddingTop: 12, lineHeight: 21 },
  count: { color: colors.inkFaint, fontSize: 12, fontWeight: "700", textAlign: "right", marginTop: -10 },
  windows: { gap: 10 },
  windowRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  to: { color: colors.inkMuted, fontSize: 13, fontWeight: "700" },
  remove: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.line },
  addRow: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingVertical: 6 },
  addText: { color: colors.primary, fontSize: 15, fontWeight: "700" },
  note: { color: colors.inkFaint, fontSize: 13, fontWeight: "600", textAlign: "center" },
  preview: { gap: 12 },
  previewHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  previewName: { color: colors.ink, fontSize: 18, fontWeight: "800" },
  previewMeta: { color: colors.inkMuted, fontSize: 13, fontWeight: "600", flexShrink: 1 },
  previewBio: { color: colors.ink, fontSize: 14, lineHeight: 21 },
  previewMissing: { color: colors.inkFaint, fontSize: 14, lineHeight: 21, fontStyle: "italic" },
  previewHours: { flexDirection: "row", alignItems: "center", gap: 8 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  errorText: { flex: 1, color: colors.bad, fontSize: 14, fontWeight: "700" },
  link: { alignSelf: "center", paddingVertical: 6 },
  linkText: { color: colors.primary, fontSize: 15, fontWeight: "700" },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
});
