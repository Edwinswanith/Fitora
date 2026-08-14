import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "../../components/AppText";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiFetch } from "../../lib/api";
import { ROLE_THEMES, colors, radius } from "../../lib/theme";
import { Banner, Card, Label, Muted, PrimaryButton, TextField } from "../../components/ui";
import { Scale, Stepper } from "../../components/inputs";

const theme = ROLE_THEMES.athlete;
const today = () => new Date().toISOString().slice(0, 10);

const SESSIONS = ["AM", "AFT", "PM"] as const;
const CATEGORIES = [
  "MAX SPEED",
  "TEMPO / EXTENSIVE",
  "ACCELERATION (SHORT)",
  "SPEED ENDURANCE",
  "GENERAL STRENGTH & MOBILITY",
  "SPECIAL ENDURANCE I",
  "CORE / STABILITY",
  "EXPLOSIVE / OLYMPIC LIFTS",
  "ACTIVE REST / REST",
];

export default function Rpe() {
  const [session, setSession] = useState<(typeof SESSIONS)[number]>("AM");
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [intensity, setIntensity] = useState(70);
  const [rpe, setRpe] = useState(6);
  const [sleepQuality, setSleepQuality] = useState<number | null>(null);
  const [soreness, setSoreness] = useState<number | null>(null);
  const [fatigue, setFatigue] = useState<number | null>(null);
  const [mood, setMood] = useState<number | null>(null);
  const [restingHr, setRestingHr] = useState("");

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function save() {
    setMsg(null);
    if (![sleepQuality, soreness, fatigue, mood].every((v) => v != null)) {
      setMsg({ kind: "error", text: "Rate sleep, soreness, fatigue and mood." });
      return false;
    }
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
          date: today(),
          sessionType: session,
          trainingCategory: category,
          plannedIntensityPercent: intensity,
          rpe,
          sleepQuality,
          muscleSoreness: soreness,
          fatigue,
          moodMotivation: mood,
          ...(hr !== undefined ? { restingHeartRate: hr } : {}),
        }),
      });
      if (!res.ok) throw new Error();
      setMsg({ kind: "ok", text: "Session RPM logged. Your training load is updated." });
      return true;
    } catch {
      setMsg({ kind: "error", text: "Couldn't save. Check your connection and try again." });
      return false;
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Session RPM</Text>
        <Muted style={{ marginBottom: 16 }}>Log a training session’s effort and how you felt.</Muted>

        <Card style={{ gap: 18 }}>
          <View style={{ gap: 8 }}>
            <Label>Session</Label>
            <View style={styles.seg}>
              {SESSIONS.map((s) => {
                const on = session === s;
                return (
                  <Pressable key={s} onPress={() => setSession(s)} style={[styles.segBtn, on && { backgroundColor: theme.accentStrong }]}>
                    <Text style={[styles.segText, { color: on ? "#fff" : colors.inkMuted }]}>{s}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={{ gap: 8 }}>
            <Label>Training category</Label>
            <View style={styles.chips}>
              {CATEGORIES.map((c) => {
                const on = category === c;
                return (
                  <Pressable key={c} onPress={() => setCategory(c)} style={[styles.chip, { borderColor: on ? theme.accentStrong : colors.line, backgroundColor: on ? theme.accentSoft : colors.surfaceInset }]}>
                    <Text style={[styles.chipText, { color: on ? theme.accentStrong : colors.inkMuted }]}>{c}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Stepper label="Planned intensity" value={intensity} onChange={setIntensity} step={5} min={0} max={100} unit="%" accent={theme.accentStrong} />
          <Stepper label="RPM (effort)" value={rpe} onChange={setRpe} step={1} min={0} max={10} accent={theme.accentStrong} />
          <Scale label="Sleep quality" value={sleepQuality} onChange={setSleepQuality} accent={theme.accentStrong} lowHint="Poor" highHint="Great" />
          <Scale label="Soreness" value={soreness} onChange={setSoreness} accent={theme.accentStrong} lowHint="None" highHint="Severe" />
          <Scale label="Fatigue" value={fatigue} onChange={setFatigue} accent={theme.accentStrong} lowHint="Fresh" highHint="Spent" />
          <Scale label="Mood / motivation" value={mood} onChange={setMood} accent={theme.accentStrong} lowHint="Low" highHint="High" />
          <View>
            <Label>Resting heart rate (optional)</Label>
            <View style={{ marginTop: 6 }}>
              <TextField value={restingHr} onChangeText={setRestingHr} placeholder="bpm" keyboardType="number-pad" editable={!saving} />
            </View>
          </View>
        </Card>

        {msg ? (
          <View style={{ marginTop: 14 }}>
            <Banner kind={msg.kind}>{msg.text}</Banner>
          </View>
        ) : null}

        <View style={{ marginTop: 16 }}>
          <PrimaryButton label="Log session RPM" onPress={save} loading={saving} successLabel="Logged" accent={theme.accent} accentInk={theme.accentInk} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  content: { padding: 20, paddingTop: 12, paddingBottom: 32 },
  title: { fontSize: 26, fontWeight: "800", color: colors.ink, letterSpacing: -0.4 },
  seg: { flexDirection: "row", gap: 8 },
  segBtn: { flex: 1, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceInset },
  segText: { fontSize: 15, fontWeight: "700" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 8 },
  chipText: { fontSize: 12, fontWeight: "600" },
});
