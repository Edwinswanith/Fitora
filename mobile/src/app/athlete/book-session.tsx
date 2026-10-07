import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "../../components/AppText";
import { ActionButton, AlertBanner, AppCard, EmptyState, ScreenContainer, SectionHeader } from "../../components/fitora";
import { apiFetch, apiJson } from "../../lib/api";
import { celebrate, errorFeedback, selectionFeedback } from "../../lib/feedback";
import { colors, radius } from "../../lib/theme";
import { addDays, dateKey, updateCachedData, type AthleteDashboardData, type CoachSession } from "../../lib/fitoraData";

// Mirrors COACH_SESSION_TYPES in server/src/models/CoachSession.ts.
const SESSION_TYPES = [
  { value: "general", label: "General check-in" },
  { value: "progress_review", label: "Progress review" },
  { value: "workout_guidance", label: "Workout guidance" },
  { value: "form_check", label: "Form check" },
  { value: "nutrition_review", label: "Nutrition review" },
  { value: "consultation", label: "Consultation" },
] as const;
type SessionType = (typeof SESSION_TYPES)[number]["value"];

const DAYS_AHEAD = 14;
// Slots that start sooner than this are hidden: the server lists every slot
// for the day, including ones already in the past.
const MIN_LEAD_MS = 15 * 60_000;

const BOOKING_ERRORS: Record<string, string> = {
  not_your_coach: "You can only book sessions with your current coach.",
  outside_availability: "That time is no longer inside your coach's availability. Pick another slot.",
  slot_conflict: "Someone just booked that time. Pick another slot.",
  max_sessions_per_day_reached: "Your coach is fully booked that day. Try another day.",
  session_allowance_exhausted: "You've used all the sessions included in your plan for this cycle.",
  live_sessions_not_included_in_plan: "Live sessions aren't included in your current plan.",
  subscription_not_active: "Your membership isn't active, so sessions can't be booked right now.",
};

type Slot = { start: string; end: string };

function dayChipLabel(key: string, index: number): { top: string; bottom: string } {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return {
    top: index === 0 ? "Today" : index === 1 ? "Tmrw" : date.toLocaleDateString(undefined, { weekday: "short" }),
    bottom: String(d),
  };
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export default function BookSessionScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ coachId?: string; coachName?: string }>();
  const coachId = typeof params.coachId === "string" ? params.coachId : "";
  const coachName = typeof params.coachName === "string" && params.coachName ? params.coachName : "your coach";

  const days = useMemo(() => {
    const today = dateKey(new Date());
    return Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(today, i));
  }, []);
  const [type, setType] = useState<SessionType>("general");
  const [day, setDay] = useState(days[0]);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [booking, setBooking] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);
  const [booked, setBooked] = useState<CoachSession | null>(null);

  useEffect(() => {
    if (!coachId) return;
    let active = true;
    setSlots(null);
    setLoadError(null);
    setSelected(null);
    apiJson<{ slots: Slot[] }>(`/api/athlete/coaches/${coachId}/available-slots?date=${day}`)
      .then((result) => {
        if (!active) return;
        const earliest = Date.now() + MIN_LEAD_MS;
        setSlots((result.slots ?? []).filter((slot) => new Date(slot.start).getTime() >= earliest));
      })
      .catch(() => {
        if (active) setLoadError("Could not load open times. Check your connection and try again.");
      });
    return () => {
      active = false;
    };
  }, [coachId, day, reloadKey]);

  async function book() {
    if (!selected || booking) return;
    setBooking(true);
    setBookError(null);
    try {
      const res = await apiFetch(`/api/athlete/coaches/${coachId}/sessions`, {
        method: "POST",
        body: JSON.stringify({ type, scheduledStart: selected.start }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; session?: CoachSession };
      if (!res.ok || !body.session) {
        errorFeedback();
        setBookError(BOOKING_ERRORS[body.error ?? ""] ?? "Could not book this session. Please try again.");
        if (body.error === "slot_conflict" || body.error === "outside_availability") setReloadKey((k) => k + 1);
        return;
      }
      const session = { ...body.session, coachName: body.session.coachName ?? coachName };
      updateCachedData<AthleteDashboardData>("athlete-dashboard", (prev) => (prev ? { ...prev, sessions: [...prev.sessions, session] } : prev));
      setBooked(session);
      celebrate({ title: "Session requested", body: `${coachName} will confirm it soon.` });
    } catch {
      errorFeedback();
      setBookError("Network error while booking. Please try again.");
    } finally {
      setBooking(false);
    }
  }

  if (!coachId) {
    return (
      <ScreenContainer>
        <Header title="Book a Session" />
        <EmptyState title="No coach selected" body="Open booking from your Coach tab." icon="calendar-outline" />
      </ScreenContainer>
    );
  }

  if (booked) {
    return (
      <ScreenContainer>
        <Header title="Session Requested" />
        <AppCard style={styles.doneCard}>
          <View style={styles.doneIcon}>
            <Ionicons name="checkmark-circle" size={44} color={colors.ok} />
          </View>
          <Text style={styles.doneTitle}>Request sent to {coachName}</Text>
          <Text style={styles.doneBody}>
            {new Date(booked.scheduledStart).toLocaleString(undefined, { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
          </Text>
          <Text style={styles.doneBody}>
            {"You'll get a notification when your coach confirms. You can join the video call from your Coach tab 10 minutes before it starts."}
          </Text>
          <ActionButton label="Back to My Coach" variant="filled" style={styles.doneButton} onPress={() => router.back()} />
        </AppCard>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <Header title="Book a Session" />
      <Text style={styles.subtitle}>with {coachName}</Text>

      <AppCard>
        <SectionHeader title="What's it about?" />
        <View style={styles.typeWrap}>
          {SESSION_TYPES.map((option) => {
            const active = option.value === type;
            return (
              <Pressable
                key={option.value}
                onPress={() => setType(option.value)}
                style={({ pressed }) => [styles.typeChip, active ? styles.typeChipActive : null, pressed ? styles.pressed : null]}
              >
                <Text style={[styles.typeChipText, active ? styles.typeChipTextActive : null]}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </AppCard>

      <AppCard>
        <SectionHeader title="Pick a day" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayRow}>
          {days.map((key, index) => {
            const label = dayChipLabel(key, index);
            const active = key === day;
            return (
              <Pressable
                key={key}
                onPress={() => setDay(key)}
                style={({ pressed }) => [styles.dayChip, active ? styles.dayChipActive : null, pressed ? styles.pressed : null]}
              >
                <Text style={[styles.dayTop, active ? styles.dayTextActive : null]}>{label.top}</Text>
                <Text style={[styles.dayBottom, active ? styles.dayTextActive : null]}>{label.bottom}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </AppCard>

      <AppCard>
        <SectionHeader title="Open times" />
        {loadError ? (
          <View style={styles.stateBox}>
            <Text style={styles.muted}>{loadError}</Text>
            <ActionButton label="Retry" onPress={() => setReloadKey((k) => k + 1)} />
          </View>
        ) : slots === null ? (
          <View style={styles.stateBox}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : slots.length === 0 ? (
          <EmptyState title="No open times" body={`${coachName} has no free slots on this day. Try another day.`} icon="calendar-clear-outline" />
        ) : (
          <View style={styles.slotGrid}>
            {slots.map((slot) => {
              const active = selected?.start === slot.start;
              return (
                <Pressable
                  key={slot.start}
                  onPress={() => {
                    selectionFeedback();
                    setSelected(slot);
                  }}
                  style={({ pressed }) => [styles.slot, active ? styles.slotActive : null, pressed ? styles.pressed : null]}
                >
                  <Text style={[styles.slotText, active ? styles.slotTextActive : null]}>{timeLabel(slot.start)}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </AppCard>

      {bookError ? <AlertBanner tone="danger" title="Couldn't book" body={bookError} /> : null}

      <ActionButton
        label={booking ? "Booking..." : selected ? `Request ${timeLabel(selected.start)} - ${timeLabel(selected.end)}` : "Pick a time"}
        variant="filled"
        disabled={!selected || booking}
        onPress={book}
      />
      <Text style={styles.footnote}>{"Your coach confirms the request before it's final."}</Text>
    </ScreenContainer>
  );
}

function Header({ title }: { title: string }) {
  const router = useRouter();
  return (
    <View style={styles.header}>
      <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={10} accessibilityLabel="Back">
        <Ionicons name="arrow-back" size={24} color={colors.ink} />
      </Pressable>
      <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
      <View style={styles.backButton} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { minHeight: 58, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  backButton: { height: 42, width: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", color: colors.ink, fontSize: 19, lineHeight: 24, fontWeight: "900" },
  subtitle: { color: colors.inkMuted, fontSize: 14, textAlign: "center", marginTop: -8, marginBottom: 4 },
  pressed: { opacity: 0.8 },
  typeWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  typeChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  typeChipActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  typeChipText: { color: colors.ink, fontSize: 13, fontWeight: "700" },
  typeChipTextActive: { color: colors.primary },
  dayRow: { gap: 8, paddingVertical: 2 },
  dayChip: { width: 54, paddingVertical: 8, borderRadius: radius.md, alignItems: "center", borderWidth: 1, borderColor: colors.line },
  dayChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayTop: { color: colors.inkMuted, fontSize: 12, fontWeight: "800" },
  dayBottom: { color: colors.ink, fontSize: 18, fontWeight: "900", marginTop: 2 },
  dayTextActive: { color: "#fff" },
  stateBox: { alignItems: "center", gap: 10, paddingVertical: 16 },
  muted: { color: colors.inkMuted, fontSize: 14, textAlign: "center" },
  slotGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  slot: { minWidth: 92, paddingVertical: 10, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, alignItems: "center" },
  slotActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  slotText: { color: colors.ink, fontSize: 14, fontWeight: "800" },
  slotTextActive: { color: "#fff" },
  footnote: { color: colors.inkFaint, fontSize: 12, textAlign: "center" },
  doneCard: { alignItems: "center", gap: 10, paddingVertical: 24 },
  doneIcon: { height: 64, width: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceInset },
  doneTitle: { color: colors.ink, fontSize: 19, fontWeight: "900", textAlign: "center" },
  doneBody: { color: colors.inkMuted, fontSize: 14, lineHeight: 20, textAlign: "center" },
  doneButton: { alignSelf: "stretch", marginTop: 6 },
});
