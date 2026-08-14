import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Text } from "../../components/AppText";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiFetch } from "../../lib/api";
import { ROLE_THEMES, colors } from "../../lib/theme";
import { Banner, Card, Label, Muted, PrimaryButton, TextField } from "../../components/ui";
import { Scale, Stepper } from "../../components/inputs";

const today = () => new Date().toISOString().slice(0, 10);
const theme = ROLE_THEMES.athlete;

export default function CheckIn() {
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
        body: JSON.stringify({ date: today(), wakeHr: wake, bedHr: bed }),
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
          date: today(),
          sleepHours,
          sleepQuality,
          mood,
          stress,
          soreness,
          fatigue,
        }),
      });
      if (!res.ok) throw new Error();
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
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Daily check-in</Text>
        <Muted style={{ marginBottom: 16 }}>Takes under a minute — it drives your readiness.</Muted>

        <Card style={{ gap: 18 }}>
          <Stepper label="Sleep" value={sleepHours} onChange={setSleepHours} unit="hrs" accent={theme.accentStrong} />
          <Scale label="Sleep quality" value={sleepQuality} onChange={setSleepQuality} accent={theme.accentStrong} lowHint="Poor" highHint="Great" />
          <Scale label="Mood" value={mood} onChange={setMood} accent={theme.accentStrong} lowHint="Low" highHint="High" />
          <Scale label="Stress" value={stress} onChange={setStress} accent={theme.accentStrong} lowHint="Calm" highHint="High" />
          <Scale label="Soreness" value={soreness} onChange={setSoreness} accent={theme.accentStrong} lowHint="None" highHint="Severe" />
          <Scale label="Fatigue" value={fatigue} onChange={setFatigue} accent={theme.accentStrong} lowHint="Fresh" highHint="Spent" />
        </Card>

        {msg ? (
          <View style={{ marginTop: 14 }}>
            <Banner kind={msg.kind}>{msg.text}</Banner>
          </View>
        ) : null}

        <View style={{ marginTop: 16 }}>
          <PrimaryButton
            label="Save check-in"
            onPress={save}
            loading={saving}
            successLabel="Saved"
            accent={theme.accent}
            accentInk={theme.accentInk}
          />
        </View>

        <Text style={styles.sectionHeading}>Resting heart rate</Text>
        <Muted style={{ marginBottom: 10, fontSize: 13 }}>Optional — log your waking and before-bed bpm.</Muted>
        <Card style={{ gap: 14 }}>
          <View style={styles.hrRow}>
            <View style={{ flex: 1 }}>
              <Label>Waking</Label>
              <View style={{ marginTop: 6 }}>
                <TextField value={wakeHr} onChangeText={setWakeHr} placeholder="bpm" keyboardType="number-pad" editable={!hrSaving} />
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <Label>Before bed</Label>
              <View style={{ marginTop: 6 }}>
                <TextField value={bedHr} onChangeText={setBedHr} placeholder="bpm" keyboardType="number-pad" editable={!hrSaving} />
              </View>
            </View>
          </View>
          {hrMsg ? <Banner kind={hrMsg.kind}>{hrMsg.text}</Banner> : null}
          <PrimaryButton label="Save heart rate" onPress={saveHr} loading={hrSaving} successLabel="Saved" accent={theme.accent} accentInk={theme.accentInk} />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  content: { padding: 20, paddingTop: 12, paddingBottom: 32 },
  title: { fontSize: 26, fontWeight: "800", color: colors.ink, letterSpacing: -0.4 },
  sectionHeading: { fontSize: 18, fontWeight: "800", color: colors.ink, marginTop: 28 },
  hrRow: { flexDirection: "row", gap: 12 },
});
