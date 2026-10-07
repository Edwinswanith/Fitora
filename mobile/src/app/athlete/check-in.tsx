import { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "../../components/AppText";
import { ActionButton, AppCard, ScreenContainer, SectionHeader } from "../../components/fitora";
import { apiFetch } from "../../lib/api";
import { loadAthleteDashboardData, todayKey, updateCachedData, type AthleteDashboardData } from "../../lib/fitoraData";
import { colors, radius } from "../../lib/theme";

export default function CheckIn() {
  const router = useRouter();
  const [sleepHours, setSleepHours] = useState(7.5);
  const [sleepQuality, setSleepQuality] = useState<number | null>(null);
  const [mood, setMood] = useState<number | null>(null);
  const [stress, setStress] = useState<number | null>(null);
  const [soreness, setSoreness] = useState<number | null>(null);
  const [fatigue, setFatigue] = useState<number | null>(null);

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const [wakeHr, setWakeHr] = useState("");
  const [bedHr, setBedHr] = useState("");
  const [hrSaving, setHrSaving] = useState(false);
  const [hrMsg, setHrMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function saveHr() {
    setHrMsg(null);
    const wake = wakeHr ? Number(wakeHr) : undefined;
    const bed = bedHr ? Number(bedHr) : undefined;
    if (wake === undefined && bed === undefined) {
      setHrMsg({ kind: "error", text: "Enter a waking or before-bed reading." });
      return false;
    }
    for (const v of [wake, bed]) {
      if (v !== undefined && (!Number.isFinite(v) || v < 25 || v > 220)) {
        setHrMsg({ kind: "error", text: "Heart rate must be between 25 and 220 bpm." });
        return false;
      }
    }
    setHrSaving(true);
    try {
      const res = await apiFetch("/api/athlete/heart-rate", {
        method: "POST",
        body: JSON.stringify({ date: todayKey(), wakeHr: wake, bedHr: bed }),
      });
      if (!res.ok) throw new Error();
      setHrMsg({ kind: "ok", text: "Resting heart rate saved." });
      return true;
    } catch {
      setHrMsg({ kind: "error", text: "Couldn't save heart rate. Try again." });
      return false;
    } finally {
      setHrSaving(false);
    }
  }

  async function save() {
    setMsg(null);
    if (![sleepQuality, mood, stress, soreness, fatigue].every((v) => v != null)) {
      setMsg({ kind: "error", text: "Rate all five scales to log your check-in." });
      return false;
    }
    setSaving(true);
    try {
      const res = await apiFetch("/api/athlete/wellness", {
        method: "POST",
        body: JSON.stringify({
          date: todayKey(),
          sleepHours,
          sleepQuality,
          mood,
          stress,
          soreness,
          fatigue,
        }),
      });
      if (!res.ok) throw new Error();
      const dashboard = await loadAthleteDashboardData().catch(() => null);
      if (dashboard) updateCachedData<AthleteDashboardData>("athlete-dashboard", () => dashboard);
      setMsg({ kind: "ok", text: "Check-in saved. Your readiness is updated." });
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
        <Text style={styles.title}>Daily Check-in</Text>
      </View>
      <Text style={styles.tagline}>Takes under a minute — it drives your readiness.</Text>

      <AppCard>
        <View style={styles.cardGap}>
          <HourStepper label="Sleep" value={sleepHours} onChange={setSleepHours} unit="hrs" />
          <RatingScale label="Sleep quality" value={sleepQuality} onChange={setSleepQuality} lowHint="Poor" highHint="Great" />
          <RatingScale label="Mood" value={mood} onChange={setMood} lowHint="Low" highHint="High" />
          <RatingScale label="Stress" value={stress} onChange={setStress} lowHint="Calm" highHint="High" />
          <RatingScale label="Soreness" value={soreness} onChange={setSoreness} lowHint="None" highHint="Severe" />
          <RatingScale label="Fatigue" value={fatigue} onChange={setFatigue} lowHint="Fresh" highHint="Spent" />
        </View>
      </AppCard>

      {msg ? <Text style={msg.kind === "ok" ? styles.successText : styles.errorText}>{msg.text}</Text> : null}

      <ActionButton
        label={saving ? "Saving..." : "Save Check-in"}
        icon="checkmark-outline"
        variant="filled"
        onPress={save}
        disabled={saving}
      />

      <SectionHeader title="Resting heart rate" />
      <Text style={styles.sectionSub}>Optional — log your waking and before-bed bpm.</Text>
      <AppCard>
        <View style={styles.cardGap}>
          <View style={styles.hrRow}>
            <Field label="Waking" value={wakeHr} onChangeText={setWakeHr} editable={!hrSaving} />
            <Field label="Before bed" value={bedHr} onChangeText={setBedHr} editable={!hrSaving} />
          </View>
          {hrMsg ? <Text style={hrMsg.kind === "ok" ? styles.successText : styles.errorText}>{hrMsg.text}</Text> : null}
          <ActionButton
            label={hrSaving ? "Saving..." : "Save Heart Rate"}
            icon="heart-outline"
            variant="filled"
            onPress={saveHr}
            disabled={hrSaving}
          />
        </View>
      </AppCard>
    </ScreenContainer>
  );
}

function Field({
  label,
  value,
  onChangeText,
  editable = true,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  editable?: boolean;
}) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder="bpm"
        placeholderTextColor={colors.inkFaint}
        keyboardType="number-pad"
        editable={editable}
        style={styles.input}
      />
    </View>
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

/** Numeric +/- stepper (sleep hours), restyled onto the current design system's tokens. */
function HourStepper({
  label,
  value,
  onChange,
  step = 0.5,
  min = 0,
  max = 14,
  unit,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
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
  title: { flex: 1, color: colors.ink, fontSize: 26, lineHeight: 32, fontWeight: "900" },
  tagline: { color: colors.inkMuted, fontSize: 14, lineHeight: 19, marginTop: -6, marginBottom: 4 },
  sectionSub: { color: colors.inkMuted, fontSize: 13, lineHeight: 18, marginTop: -4 },
  cardGap: { gap: 18 },
  hrRow: { flexDirection: "row", gap: 12 },
  fieldLabel: { color: colors.inkMuted, fontSize: 12, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.4 },
  input: {
    marginTop: 6,
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surfaceInset,
    paddingHorizontal: 14,
    color: colors.ink,
    fontSize: 16,
    fontWeight: "700",
  },
  successText: { color: colors.ok, fontSize: 13, fontWeight: "800" },
  errorText: { color: colors.bad, fontSize: 13, fontWeight: "800" },
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
  hint: { fontSize: 12, color: colors.inkFaint, fontWeight: "600" },
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
