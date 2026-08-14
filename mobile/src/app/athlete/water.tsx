import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Text } from "../../components/AppText";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from "react-native-svg";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { apiFetch, apiJson } from "../../lib/api";
import { colors, radius } from "../../lib/theme";
import { Card, Muted } from "../../components/ui";

// The web hydration card renders a blue water ring — mirror that here rather
// than the athlete gold accent, so both platforms read as the same feature.
const WATER = "#2f7df6";
const OK = colors.ok;

const today = () => new Date().toISOString().slice(0, 10);
const QUICK = [250, 500, 750];
const GOAL_PRESETS = [2000, 2500, 3000, 3500];
const REMINDER_KEY = "scp.hydration.reminders";
type ReminderMinutes = 60 | 90 | 120;

type Entry = { id: string; amountMl: number; loggedAt: string };
type WaterDay = { date: string; goalMl: number; totalMl: number; entries: Entry[] };
type WaterPoint = { date: string; totalMl: number | null };
type WaterSeries = { days: number; goalMl: number; series: WaterPoint[] };

const litres = (ml: number): string => (ml / 1000).toFixed(ml % 1000 === 0 ? 0 : 1);
const shortDate = (d: string) => d.split("-").slice(1).join("-");

/** Circular progress ring (SVG) — the % of today's goal reached. */
function WaterRing({ pct, reached }: { pct: number; reached: boolean }) {
  const size = 176;
  const stroke = 16;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (Math.min(100, pct) / 100) * c;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.surfaceInset} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={reached ? OK : WATER}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
        />
      </Svg>
      <Text style={styles.ringPct}>{Math.round(pct)}%</Text>
      <Text style={[styles.ringLabel, { color: reached ? OK : WATER }]}>{reached ? "Goal met" : "Complete"}</Text>
    </View>
  );
}

function MetricTile({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={[styles.tileValue, good ? { color: OK } : null]}>{value}</Text>
    </View>
  );
}

/** Weekly / monthly hydration area chart (SVG) with a dashed goal line + dots. */
function HydrationBars({ series, goalMl }: { series: WaterPoint[]; goalMl: number }) {
  const [w, setW] = useState(0);
  const height = 150;
  const padX = 8;
  const padTop = 10;
  const padBottom = 6;
  if (series.length === 0) return <Muted style={{ fontSize: 12 }}>No chart data yet.</Muted>;
  const max = Math.max(goalMl, ...series.map((p) => p.totalMl ?? 0), 1) * 1.12;
  const plotW = Math.max(1, w - padX * 2);
  const plotH = height - padTop - padBottom;
  const n = series.length;
  const x = (i: number) => padX + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => padTop + (1 - v / max) * plotH;
  const pts = series.map((p, i) => ({
    x: x(i),
    y: y(p.totalMl ?? 0),
    met: (p.totalMl ?? 0) >= goalMl,
    missing: p.totalMl === null,
  }));
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const baseline = padTop + plotH;
  const area = `${line} L ${pts[n - 1].x} ${baseline} L ${pts[0].x} ${baseline} Z`;
  const goalY = y(goalMl);
  return (
    <View>
      <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ height }}>
        {w > 0 ? (
          <Svg width={w} height={height}>
            <Defs>
              <LinearGradient id="waterArea" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor={WATER} stopOpacity={0.32} />
                <Stop offset="100%" stopColor={WATER} stopOpacity={0.03} />
              </LinearGradient>
            </Defs>
            <Path d={area} fill="url(#waterArea)" />
            <Line x1={padX} x2={w - padX} y1={goalY} y2={goalY} stroke={OK} strokeWidth={1} strokeDasharray="4 4" opacity={0.7} />
            <Path d={line} stroke={WATER} strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
            {pts.map((p, i) => (
              <Circle key={i} cx={p.x} cy={p.y} r={3} fill={colors.surfaceRaised} stroke={p.met ? OK : WATER} strokeWidth={2} opacity={p.missing ? 0.4 : 1} />
            ))}
          </Svg>
        ) : null}
      </View>
      <View style={styles.chartAxis}>
        <Text style={styles.axisText}>{shortDate(series[0].date)}</Text>
        <Text style={styles.axisText}>Goal {litres(goalMl)} L</Text>
        <Text style={styles.axisText}>{shortDate(series[series.length - 1].date)}</Text>
      </View>
    </View>
  );
}

export default function Water() {
  const [day, setDay] = useState<WaterDay | null>(null);
  const [historyDays, setHistoryDays] = useState<7 | 30>(7);
  const [history, setHistory] = useState<WaterSeries | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [goalDraft, setGoalDraft] = useState("");
  const [amountDraft, setAmountDraft] = useState("");
  const [goalError, setGoalError] = useState<string | null>(null);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [remindersEnabled, setRemindersEnabled] = useState(false);
  const [reminderMinutes, setReminderMinutes] = useState<ReminderMinutes>(120);
  const [reminderError, setReminderError] = useState<string | null>(null);

  const loadDay = useCallback(async () => {
    try {
      const next = await apiJson<WaterDay>(`/api/athlete/water?date=${today()}`);
      setDay(next);
      setGoalDraft(String(next.goalMl));
    } catch {
      // keep last known
    } finally {
      setLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await apiJson<WaterSeries>(`/api/athlete/analytics/water?days=${historyDays}`));
    } catch {
      // keep last known
    }
  }, [historyDays]);

  useEffect(() => {
    void loadDay();
  }, [loadDay]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  // Restore persisted reminder settings.
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(REMINDER_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as { enabled?: boolean; minutes?: number };
        setRemindersEnabled(Boolean(parsed.enabled));
        if (parsed.minutes === 60 || parsed.minutes === 90 || parsed.minutes === 120) setReminderMinutes(parsed.minutes);
      } catch {
        // ignore
      }
    })();
  }, []);

  async function mutate(run: () => Promise<Response>) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await run();
      if (res.ok) {
        setDay(await res.json());
        await loadHistory();
      }
    } finally {
      setBusy(false);
    }
  }

  const add = (amountMl: number) =>
    mutate(() => apiFetch("/api/athlete/water", { method: "POST", body: JSON.stringify({ amountMl, date: today() }) }));

  async function addCustom() {
    const amountMl = Number(amountDraft);
    if (!Number.isFinite(amountMl) || amountMl < 50 || amountMl > 3000) {
      setAmountError("Amount must be between 50 and 3000 ml.");
      return;
    }
    setAmountError(null);
    await add(Math.round(amountMl));
    setAmountDraft("");
  }

  const remove = (id: string) => mutate(() => apiFetch(`/api/athlete/water/${id}`, { method: "DELETE" }));

  async function saveGoal(next?: number) {
    const goalMl = next ?? Number(goalDraft);
    if (!Number.isFinite(goalMl) || goalMl < 500 || goalMl > 8000) {
      setGoalError("Goal must be between 500 and 8000 ml.");
      return;
    }
    setGoalError(null);
    setBusy(true);
    try {
      const rounded = Math.round(goalMl);
      const res = await apiFetch("/api/athlete/me", { method: "PATCH", body: JSON.stringify({ hydrationGoalMl: rounded }) });
      if (!res.ok) {
        setGoalError("Could not save goal.");
        return;
      }
      setGoalDraft(String(rounded));
      setDay((d) => (d ? { ...d, goalMl: rounded } : d));
      await Promise.all([loadDay(), loadHistory()]);
    } finally {
      setBusy(false);
    }
  }

  // On-device local reminders (expo-notifications), mirroring the web toggle.
  async function persistReminders(enabled: boolean, minutes: ReminderMinutes) {
    await AsyncStorage.setItem(REMINDER_KEY, JSON.stringify({ enabled, minutes })).catch(() => undefined);
  }

  async function applyReminders(enabled: boolean, minutes: ReminderMinutes) {
    setReminderError(null);
    try {
      await Notifications.cancelAllScheduledNotificationsAsync();
      if (!enabled) return;
      const perm = await Notifications.getPermissionsAsync();
      let granted = perm.granted;
      if (!granted) granted = (await Notifications.requestPermissionsAsync()).granted;
      if (!granted) {
        setRemindersEnabled(false);
        await persistReminders(false, minutes);
        setReminderError("Allow notifications to use reminders.");
        return;
      }
      await Notifications.scheduleNotificationAsync({
        content: { title: "Hydration reminder", body: "Time for a drink — keep your water goal on track." },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: minutes * 60,
          repeats: true,
        },
      });
    } catch {
      setReminderError("Reminders aren't available on this device.");
    }
  }

  async function toggleReminders() {
    const nextEnabled = !remindersEnabled;
    setRemindersEnabled(nextEnabled);
    await persistReminders(nextEnabled, reminderMinutes);
    await applyReminders(nextEnabled, reminderMinutes);
  }

  async function chooseMinutes(minutes: ReminderMinutes) {
    setReminderMinutes(minutes);
    await persistReminders(remindersEnabled, minutes);
    if (remindersEnabled) await applyReminders(true, minutes);
  }

  const total = day?.totalMl ?? 0;
  const goal = day?.goalMl ?? 3000;
  const remaining = Math.max(0, goal - total);
  const pct = goal > 0 ? Math.min(100, (total / goal) * 100) : 0;
  const reached = total >= goal;
  const historyGoal = history?.goalMl ?? goal;
  const achievedDays = useMemo(
    () => (history?.series ?? []).filter((p) => (p.totalMl ?? 0) >= historyGoal).length,
    [history?.series, historyGoal]
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Water</Text>
        <Muted style={{ marginBottom: 16 }}>Stay on top of hydration.</Muted>

        {loading && !day ? (
          <ActivityIndicator color={WATER} style={{ marginTop: 40 }} />
        ) : (
          <View style={{ gap: 12 }}>
            {/* Water goal — ring + Drunk / Remaining / Goal + status */}
            <Card>
              <Text style={styles.cardTitle}>Water goal</Text>
              <View style={{ alignItems: "center", gap: 16, marginTop: 8 }}>
                <WaterRing pct={pct} reached={reached} />
                <View style={styles.tileRow}>
                  <MetricTile label="Drunk" value={`${litres(total)} L`} />
                  <MetricTile label="Remaining" value={`${litres(remaining)} L`} good={reached} />
                  <MetricTile label="Goal" value={`${litres(goal)} L`} />
                </View>
                <View style={[styles.statusBox, reached ? styles.statusBoxOk : null]}>
                  <Text style={[styles.statusText, reached ? { color: OK } : null]}>
                    {reached ? "Daily hydration achieved" : `${remaining} ml remaining today`}
                  </Text>
                  <Text style={styles.statusSub}>
                    {achievedDays} of last {historyDays} days reached the goal.
                  </Text>
                </View>
              </View>
            </Card>

            {/* Daily goal presets + custom */}
            <Card>
              <Text style={styles.cardTitle}>Daily water goal</Text>
              <View style={styles.presetRow}>
                {GOAL_PRESETS.map((ml) => (
                  <Pressable
                    key={ml}
                    disabled={busy}
                    onPress={() => saveGoal(ml)}
                    style={[styles.preset, goal === ml ? styles.presetOn : null]}
                  >
                    <Text style={[styles.presetText, goal === ml ? styles.presetTextOn : null]}>{litres(ml)} L</Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.inlineRow}>
                <TextInput
                  value={goalDraft}
                  onChangeText={setGoalDraft}
                  keyboardType="number-pad"
                  placeholder="ml"
                  placeholderTextColor={colors.inkFaint}
                  style={styles.input}
                />
                <Pressable disabled={busy} onPress={() => saveGoal()} style={[styles.primaryBtn, { backgroundColor: WATER }]}>
                  <Text style={styles.primaryBtnText}>Save</Text>
                </Pressable>
              </View>
              {goalError ? <Text style={styles.errText}>{goalError}</Text> : null}
            </Card>

            {/* Log intake */}
            <Card>
              <Text style={styles.cardTitle}>Log water intake</Text>
              <View style={styles.quickRow}>
                {QUICK.map((q) => (
                  <Pressable key={q} disabled={busy} onPress={() => add(q)} style={styles.quick}>
                    <Ionicons name="water" size={17} color={WATER} />
                    <Text style={styles.quickText}>+{q} ml</Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.inlineRow}>
                <TextInput
                  value={amountDraft}
                  onChangeText={setAmountDraft}
                  keyboardType="number-pad"
                  placeholder="Custom ml"
                  placeholderTextColor={colors.inkFaint}
                  style={styles.input}
                />
                <Pressable disabled={busy || !amountDraft.trim()} onPress={addCustom} style={[styles.primaryBtn, { backgroundColor: WATER, opacity: !amountDraft.trim() ? 0.5 : 1 }]}>
                  <Text style={styles.primaryBtnText}>Add</Text>
                </Pressable>
              </View>
              {amountError ? <Text style={styles.errText}>{amountError}</Text> : null}
            </Card>

            {/* Reminders (on-device local notifications) */}
            <Card>
              <Text style={styles.cardTitle}>Reminder notifications</Text>
              <View style={styles.reminderHead}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.reminderTitle}>Hydration reminders</Text>
                  <Text style={styles.reminderSub}>
                    {remindersEnabled ? `Every ${reminderMinutes} minutes.` : "Off"}
                  </Text>
                </View>
                <Pressable onPress={toggleReminders} style={[styles.toggle, remindersEnabled ? { backgroundColor: WATER, borderColor: WATER } : null]}>
                  <Text style={[styles.toggleText, remindersEnabled ? { color: "#fff" } : null]}>
                    {remindersEnabled ? "On" : "Enable"}
                  </Text>
                </Pressable>
              </View>
              <View style={styles.presetRow}>
                {[60, 90, 120].map((m) => (
                  <Pressable
                    key={m}
                    onPress={() => chooseMinutes(m as ReminderMinutes)}
                    style={[styles.preset, reminderMinutes === m ? styles.presetOn : null]}
                  >
                    <Text style={[styles.presetText, reminderMinutes === m ? styles.presetTextOn : null]}>{m} min</Text>
                  </Pressable>
                ))}
              </View>
              {reminderError ? <Text style={styles.errText}>{reminderError}</Text> : null}
            </Card>

            {/* Weekly / monthly chart */}
            <Card>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle}>{historyDays === 7 ? "Weekly chart" : "Monthly chart"}</Text>
                <View style={styles.seg}>
                  {[7, 30].map((d) => (
                    <Pressable
                      key={d}
                      onPress={() => setHistoryDays(d as 7 | 30)}
                      style={[styles.segBtn, historyDays === d ? styles.segBtnOn : null]}
                    >
                      <Text style={[styles.segText, historyDays === d ? styles.segTextOn : null]}>{d === 7 ? "Week" : "Month"}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <HydrationBars series={history?.series ?? []} goalMl={historyGoal} />
            </Card>

            {/* History list */}
            <Card>
              <Text style={styles.cardTitle}>Hydration history</Text>
              {history && history.series.length > 0 ? (
                <View>
                  {[...history.series].reverse().slice(0, 10).map((p, i) => {
                    const amount = p.totalMl ?? 0;
                    const met = amount >= historyGoal;
                    return (
                      <View key={p.date} style={[styles.histRow, i > 0 ? styles.histDivider : null]}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.histDate}>{shortDate(p.date)}</Text>
                          <Text style={styles.histSub}>{met ? "Goal achieved" : `${Math.max(0, historyGoal - amount)} ml remaining`}</Text>
                        </View>
                        <Text style={[styles.histValue, met ? { color: OK } : null]}>{litres(amount)} L</Text>
                      </View>
                    );
                  })}
                </View>
              ) : (
                <Muted style={{ fontSize: 12 }}>No hydration history yet.</Muted>
              )}
            </Card>

            {/* Today's entries */}
            <Card>
              <Text style={styles.cardTitle}>Today&apos;s entries</Text>
              {day && day.entries.length > 0 ? (
                <View style={styles.entryWrap}>
                  {[...day.entries].reverse().map((e) => (
                    <Pressable key={e.id} disabled={busy} onPress={() => remove(e.id)} style={styles.entryChip}>
                      <Text style={styles.entryChipText}>{e.amountMl} ml</Text>
                      <Ionicons name="close" size={12} color={colors.inkFaint} />
                    </Pressable>
                  ))}
                </View>
              ) : (
                <Muted style={{ fontSize: 12 }}>No water logged for this date.</Muted>
              )}
            </Card>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  content: { padding: 20, paddingTop: 12, paddingBottom: 32 },
  title: { fontSize: 26, fontWeight: "800", color: colors.ink, letterSpacing: -0.4 },
  cardTitle: { fontSize: 15, fontWeight: "800", color: colors.ink },
  cardTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  // Ring
  ringPct: { position: "absolute", fontSize: 34, fontWeight: "800", color: colors.ink },
  ringLabel: { position: "absolute", marginTop: 44, fontSize: 12, fontWeight: "700" },
  // Tiles
  tileRow: { flexDirection: "row", gap: 8, width: "100%" },
  tile: { flex: 1, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceInset, paddingHorizontal: 10, paddingVertical: 10 },
  tileLabel: { fontSize: 10, fontWeight: "800", color: colors.inkFaint, textTransform: "uppercase", letterSpacing: 1 },
  tileValue: { marginTop: 3, fontSize: 18, fontWeight: "800", color: colors.ink },
  // Status
  statusBox: { width: "100%", borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceInset, paddingHorizontal: 12, paddingVertical: 10 },
  statusBoxOk: { borderColor: `${OK}55`, backgroundColor: `${OK}14` },
  statusText: { fontSize: 14, fontWeight: "800", color: colors.ink },
  statusSub: { marginTop: 2, fontSize: 11, color: colors.inkMuted },
  // Presets
  presetRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  preset: { flex: 1, height: 40, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceInset, alignItems: "center", justifyContent: "center" },
  presetOn: { borderColor: WATER, backgroundColor: `${WATER}18` },
  presetText: { fontSize: 12, fontWeight: "800", color: colors.inkMuted },
  presetTextOn: { color: WATER },
  // Inline input + button
  inlineRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  input: { flex: 1, height: 46, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceInset, paddingHorizontal: 12, color: colors.ink, fontSize: 14 },
  primaryBtn: { height: 46, borderRadius: radius.sm, paddingHorizontal: 18, alignItems: "center", justifyContent: "center" },
  primaryBtnText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  errText: { marginTop: 8, fontSize: 11, fontWeight: "700", color: colors.bad },
  // Quick add
  quickRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  quick: { flex: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", height: 48, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceRaised },
  quickText: { fontSize: 13, fontWeight: "700", color: colors.ink },
  // Reminders
  reminderHead: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 },
  reminderTitle: { fontSize: 14, fontWeight: "800", color: colors.ink },
  reminderSub: { marginTop: 2, fontSize: 11, color: colors.inkMuted },
  toggle: { height: 36, borderRadius: 999, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceInset, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  toggleText: { fontSize: 12, fontWeight: "800", color: colors.inkMuted },
  // Chart
  seg: { flexDirection: "row", gap: 4, backgroundColor: colors.surfaceInset, borderRadius: radius.sm, padding: 3 },
  segBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.sm - 2 },
  segBtnOn: { backgroundColor: WATER },
  segText: { fontSize: 11, fontWeight: "800", color: colors.inkMuted },
  segTextOn: { color: "#fff" },
  chartAxis: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  axisText: { fontSize: 10, color: colors.inkFaint, fontWeight: "600" },
  // History
  histRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 },
  histDivider: { borderTopWidth: 1, borderTopColor: colors.line },
  histDate: { fontSize: 14, fontWeight: "700", color: colors.ink },
  histSub: { marginTop: 1, fontSize: 11, color: colors.inkMuted },
  histValue: { fontSize: 16, fontWeight: "800", color: colors.ink },
  // Entries
  entryWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  entryChip: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 999, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceInset, paddingHorizontal: 10, paddingVertical: 6 },
  entryChipText: { fontSize: 11, fontWeight: "700", color: colors.inkMuted },
});
