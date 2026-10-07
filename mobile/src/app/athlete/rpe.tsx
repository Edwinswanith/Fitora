import { useEffect, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "../../components/AppText";
import { ActionButton, AppCard, ScreenContainer } from "../../components/fitora";
import { apiFetch, apiJson } from "../../lib/api";
import { colors, radius } from "../../lib/theme";
import { todayKey, type DailyCard } from "../../lib/fitoraData";

const SESSIONS = ["AM", "AFT", "PM"] as const;
const CATEGORIES = [
  "GENERAL STRENGTH & MOBILITY",
  "MAX SPEED",
  "TEMPO / EXTENSIVE",
  "ACCELERATION (SHORT)",
  "SPEED ENDURANCE",
  "SPECIAL ENDURANCE I",
  "CORE / STABILITY",
  "EXPLOSIVE / OLYMPIC LIFTS",
  "ACTIVE REST / REST",
];
const DEFAULT_CATEGORY = CATEGORIES[0];

type Feeling = "better" | "same" | "worse";

/**
 * Coarse stand-ins for the fields the training-load/risk model still requires
 * (server/src/lib/trainingCategories.ts deriveLoadAndRisk) when the athlete
 * picks "Better"/"Same" and skips the detailed sliders below. "Worse" always
 * asks for real soreness/fatigue instead of guessing.
 */
const FEELING_DEFAULTS: Record<"better" | "same", { fatigue: number; muscleSoreness: number; moodMotivation: number }> = {
  better: { fatigue: 1, muscleSoreness: 1, moodMotivation: 4 },
  same: { fatigue: 3, muscleSoreness: 2, moodMotivation: 3 },
};

function titleCase(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

export default function Rpe() {
  const router = useRouter();
  const params = useLocalSearchParams<{ sessionType?: string; rpe?: string }>();
  const initialSession = SESSIONS.includes(params.sessionType as (typeof SESSIONS)[number])
    ? (params.sessionType as (typeof SESSIONS)[number])
    : "AM";
  const initialRpe = Math.max(1, Math.min(10, Number(params.rpe ?? 6) || 6));

  const [session, setSession] = useState<(typeof SESSIONS)[number]>(initialSession);
  const [rpe, setRpe] = useState(initialRpe);
  const [feeling, setFeeling] = useState<Feeling | null>(null);
  const [soreness, setSoreness] = useState<number | null>(4);
  const [fatigue, setFatigue] = useState<number | null>(4);
  const [painNote, setPainNote] = useState("");
  // Reused from today's morning check-in (see the effect below) instead of
  // asking the athlete to rate sleep a second time the same day.
  const [sleepQuality, setSleepQuality] = useState(3);

  const [showDetails, setShowDetails] = useState(false);
  const [category, setCategory] = useState<string>(DEFAULT_CATEGORY);
  const [intensity, setIntensity] = useState(70);
  const [restingHr, setRestingHr] = useState("");

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    apiJson<{ card: DailyCard }>(`/api/athlete/daily?date=${todayKey()}`)
      .then((res) => {
        if (active && res.card?.sleep?.quality != null) setSleepQuality(res.card.sleep.quality);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  async function save() {
    setMsg(null);
    if (!feeling) {
      setMsg({ kind: "error", text: "Let us know how you feel now." });
      return false;
    }
    const wellness =
      feeling === "worse"
        ? { fatigue: fatigue ?? 4, muscleSoreness: soreness ?? 4, moodMotivation: 2 }
        : FEELING_DEFAULTS[feeling];

    const hr = restingHr ? Number(restingHr) : undefined;
    if (hr !== undefined && (!Number.isFinite(hr) || hr < 20 || hr > 220)) {
      setMsg({ kind: "error", text: "Resting heart rate must be 20–220 bpm." });
      return false;
    }
    setSaving(true);
    try {
      const res = await apiFetch("/api/athlete/rpe-monitoring", {
        method: "POST",
        body: JSON.stringify({
          date: todayKey(),
          sessionType: session,
          trainingCategory: category,
          plannedIntensityPercent: intensity,
          rpe,
          sleepQuality,
          muscleSoreness: wellness.muscleSoreness,
          fatigue: wellness.fatigue,
          moodMotivation: wellness.moodMotivation,
          ...(hr !== undefined ? { restingHeartRate: hr } : {}),
          ...(painNote.trim() ? { bodyConditionFeedback: painNote.trim() } : {}),
        }),
      });
      if (!res.ok) throw new Error();
      setMsg({ kind: "ok", text: "Logged — your coach can see how today's session felt." });
      return true;
    } catch {
      setMsg({ kind: "error", text: "Couldn't save. Check your connection and try again." });
      return false;
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.ink} />
        </Pressable>
        <Text style={styles.title}>Post-Session Response</Text>
      </View>
      <Text style={styles.tagline}>A couple of quick taps — this drives your training load and risk flags.</Text>

      <AppCard>
        <View style={styles.cardGap}>
          <View style={{ gap: 8 }}>
            <Text style={styles.fieldLabel}>Session</Text>
            <View style={styles.seg}>
              {SESSIONS.map((s) => {
                const on = session === s;
                return (
                  <Pressable key={s} onPress={() => setSession(s)} style={[styles.segBtn, on ? styles.segBtnActive : null]}>
                    <Text style={[styles.segText, on ? styles.segTextActive : null]}>{s}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={{ gap: 10 }}>
            <Text style={styles.fieldLabel}>How hard was this workout?</Text>
            <View style={styles.rpeGrid}>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
                const on = rpe === n;
                return (
                  <Pressable key={n} onPress={() => setRpe(n)} style={[styles.rpeDot, on ? styles.rpeDotActive : null]}>
                    <Text style={[styles.rpeDotText, on ? styles.rpeDotTextActive : null]}>{n}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={{ gap: 10 }}>
            <Text style={styles.fieldLabel}>How do you feel now?</Text>
            <View style={styles.feelingRow}>
              {(["better", "same", "worse"] as const).map((option) => {
                const on = feeling === option;
                return (
                  <Pressable key={option} onPress={() => setFeeling(option)} style={[styles.feelingBtn, on ? styles.feelingBtnActive : null]}>
                    <Text style={[styles.feelingText, on ? styles.feelingTextActive : null]}>{titleCase(option)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {feeling === "worse" ? (
            <View style={{ gap: 18 }}>
              <RatingScale label="Soreness" value={soreness} onChange={setSoreness} lowHint="None" highHint="Severe" />
              <RatingScale label="Fatigue" value={fatigue} onChange={setFatigue} lowHint="Fresh" highHint="Spent" />
              <View>
                <Text style={styles.fieldLabel}>Anything your coach should know? (optional)</Text>
                <TextInput
                  value={painNote}
                  onChangeText={setPainNote}
                  placeholder="e.g. knee felt sore on the last set"
                  placeholderTextColor={colors.inkFaint}
                  style={[styles.input, { marginTop: 6 }]}
                />
              </View>
            </View>
          ) : null}

          <Pressable onPress={() => setShowDetails((value) => !value)} style={styles.detailsToggle} hitSlop={8}>
            <Ionicons name={showDetails ? "chevron-up" : "chevron-down"} size={16} color={colors.inkMuted} />
            <Text style={styles.detailsToggleText}>{showDetails ? "Hide details" : "Training category, intensity, heart rate"}</Text>
          </Pressable>

          {showDetails ? (
            <View style={{ gap: 18 }}>
              <View style={{ gap: 8 }}>
                <Text style={styles.fieldLabel}>Training category</Text>
                <View style={styles.chips}>
                  {CATEGORIES.map((c) => {
                    const on = category === c;
                    return (
                      <Pressable key={c} onPress={() => setCategory(c)} style={[styles.chip, on ? styles.chipActive : null]}>
                        <Text style={[styles.chipText, on ? styles.chipTextActive : null]}>{c}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <NumberStepper label="Planned intensity" value={intensity} onChange={setIntensity} step={5} min={0} max={100} unit="%" />
              <View>
                <Text style={styles.fieldLabel}>Resting heart rate (optional)</Text>
                <TextInput
                  value={restingHr}
                  onChangeText={setRestingHr}
                  placeholder="bpm"
                  placeholderTextColor={colors.inkFaint}
                  keyboardType="number-pad"
                  editable={!saving}
                  style={[styles.input, { marginTop: 6 }]}
                />
              </View>
            </View>
          ) : null}
        </View>
      </AppCard>

      {msg ? <Text style={msg.kind === "ok" ? styles.successText : styles.errorText}>{msg.text}</Text> : null}

      <ActionButton label={saving ? "Saving..." : "Log Session"} icon="checkmark-outline" variant="filled" onPress={save} disabled={saving} />
    </ScreenContainer>
  );
}

/** 1–5 rating selector, restyled onto the current design system's tokens. */
function RatingScale({
  label,
  value,
  onChange,
  lowHint,
  highHint,
}: {
  label: string;
  value: number | null;
  onChange: (v: number) => void;
  lowHint?: string;
  highHint?: string;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.scaleRow}>
        {[1, 2, 3, 4, 5].map((n) => {
          const on = value === n;
          return (
            <Pressable key={n} onPress={() => onChange(n)} style={[styles.scalePill, on ? styles.scalePillActive : null]}>
              <Text style={[styles.scalePillText, on ? styles.scalePillTextActive : null]}>{n}</Text>
            </Pressable>
          );
        })}
      </View>
      {lowHint || highHint ? (
        <View style={styles.hintRow}>
          <Text style={styles.hint}>{lowHint}</Text>
          <Text style={styles.hint}>{highHint}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Numeric +/- stepper (planned intensity %), restyled onto the current design system's tokens. */
function NumberStepper({
  label,
  value,
  onChange,
  step,
  min,
  max,
  unit,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step: number;
  min: number;
  max: number;
  unit?: string;
}) {
  const clamp = (v: number) => Math.max(min, Math.min(max, Math.round(v * 10) / 10));
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.stepperRow}>
        <Pressable onPress={() => onChange(clamp(value - step))} style={styles.stepBtn}>
          <Ionicons name="remove" size={20} color={colors.primary} />
        </Pressable>
        <Text style={styles.stepValue}>
          {value}
          {unit ? <Text style={styles.stepUnit}> {unit}</Text> : null}
        </Text>
        <Pressable onPress={() => onChange(clamp(value + step))} style={styles.stepBtn}>
          <Ionicons name="add" size={20} color={colors.primary} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 10 },
  backButton: {
    height: 42,
    width: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.line,
  },
  title: { flex: 1, color: colors.ink, fontSize: 24, lineHeight: 30, fontWeight: "900" },
  tagline: { color: colors.inkMuted, fontSize: 14, lineHeight: 19, marginTop: -6, marginBottom: 4 },
  cardGap: { gap: 18 },
  fieldLabel: { color: colors.inkMuted, fontSize: 11, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.4 },
  successText: { color: colors.ok, fontSize: 13, fontWeight: "800" },
  errorText: { color: colors.bad, fontSize: 13, fontWeight: "800" },
  seg: { flexDirection: "row", gap: 8 },
  segBtn: { flex: 1, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceInset },
  segBtnActive: { backgroundColor: colors.primary },
  segText: { fontSize: 15, fontWeight: "700", color: colors.inkMuted },
  segTextActive: { color: "#fff" },
  rpeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  rpeDot: { height: 42, width: 42, borderRadius: 21, borderWidth: 1, borderColor: colors.lineStrong, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceInset },
  rpeDotActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  rpeDotText: { fontSize: 16, fontWeight: "800", color: colors.ink },
  rpeDotTextActive: { color: "#fff" },
  feelingRow: { flexDirection: "row", gap: 8 },
  feelingBtn: { flex: 1, height: 52, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineStrong, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceInset },
  feelingBtnActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  feelingText: { fontSize: 15, fontWeight: "700", color: colors.ink },
  feelingTextActive: { color: colors.primary },
  detailsToggle: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" },
  detailsToggleText: { color: colors.inkMuted, fontSize: 13, fontWeight: "700" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.surfaceInset },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  chipText: { fontSize: 12, fontWeight: "600", color: colors.inkMuted },
  chipTextActive: { color: colors.primary },
  input: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surfaceInset,
    paddingHorizontal: 14,
    color: colors.ink,
    fontSize: 15,
    fontWeight: "600",
  },
  scaleRow: { flexDirection: "row", gap: 8 },
  scalePill: {
    flex: 1,
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surfaceInset,
    alignItems: "center",
    justifyContent: "center",
  },
  scalePillActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  scalePillText: { fontSize: 16, fontWeight: "800", color: colors.inkMuted },
  scalePillTextActive: { color: "#fff" },
  hintRow: { flexDirection: "row", justifyContent: "space-between" },
  hint: { fontSize: 11, color: colors.inkFaint, fontWeight: "600" },
  stepperRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  stepBtn: {
    height: 48,
    width: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceInset,
  },
  stepValue: { fontSize: 24, fontWeight: "800", color: colors.ink },
  stepUnit: { fontSize: 14, fontWeight: "700", color: colors.inkMuted },
});
