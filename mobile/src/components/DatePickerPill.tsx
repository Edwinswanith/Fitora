import { useEffect, useMemo, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { Text } from "./AppText";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius } from "../lib/theme";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parseDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day);
}

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function displayDate(value: string): string {
  return value.split("-").reverse().join(" - ");
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Compact label for tight header rows: "26 Jun" instead of "26-06-2026".
function shortDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return displayDate(value);
  return `${day} ${SHORT_MONTHS[month - 1]}`;
}

function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function sameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export function DatePickerPill({
  value,
  onChange,
  accessibilityLabel = "Choose date",
  accent = "#ff7e1a",
  accentInk = "#1a0c00",
  compact = false,
  iconOnly = false,
  openSignal,
}: {
  value: string;
  onChange: (value: string) => void;
  accessibilityLabel?: string;
  accent?: string;
  accentInk?: string;
  /** Narrower pill with a short "26 Jun" label — for crowded header rows. */
  compact?: boolean;
  /** Render only a calendar icon button (no date text) — for header action rows. */
  iconOnly?: boolean;
  /** Increment this value to open the picker from an external command. */
  openSignal?: number;
}) {
  const selected = useMemo(() => parseDate(value), [value]);
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => new Date(selected.getFullYear(), selected.getMonth(), 1));
  const lastOpenSignal = useRef(openSignal);
  const today = useMemo(() => new Date(), []);
  const todayKey = dateKey(today);
  const selectedKey = dateKey(selected);

  const cells = useMemo(() => {
    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();
    const first = new Date(year, month, 1);
    const start = first.getDay();
    const total = new Date(year, month + 1, 0).getDate();
    const days: { key: string; label: string; date: Date | null }[] = [];

    for (let i = 0; i < start; i++) days.push({ key: `blank-start-${i}`, label: "", date: null });
    for (let day = 1; day <= total; day++) {
      const d = new Date(year, month, day);
      days.push({ key: dateKey(d), label: String(day), date: d });
    }
    while (days.length % 7 !== 0) {
      days.push({ key: `blank-end-${days.length}`, label: "", date: null });
    }
    return days;
  }, [viewMonth]);

  function openPicker() {
    setViewMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
    setOpen(true);
  }

  function choose(date: Date) {
    onChange(dateKey(date));
    setOpen(false);
  }

  function chooseToday() {
    onChange(todayKey);
    setOpen(false);
  }

  useEffect(() => {
    if (openSignal === undefined) return;
    if (lastOpenSignal.current === openSignal) return;
    lastOpenSignal.current = openSignal;
    openPicker();
  }, [openSignal]);

  return (
    <>
      {iconOnly ? (
        <Pressable
          onPress={openPicker}
          hitSlop={8}
          style={({ pressed }) => [styles.iconButton, pressed ? { opacity: 0.82 } : null]}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
        >
          <Ionicons name="calendar-outline" size={20} color={colors.ink} />
        </Pressable>
      ) : (
        <Pressable
          onPress={openPicker}
          hitSlop={8}
          style={({ pressed }) => [styles.pill, compact ? styles.pillCompact : null, pressed ? { opacity: 0.82 } : null]}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
        >
          <Text style={styles.pillText}>{compact ? shortDate(value) : displayDate(value)}</Text>
          <Ionicons name="calendar-outline" size={14} color={colors.inkMuted} />
        </Pressable>
      )}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
            <View style={styles.monthHeader}>
              <Pressable
                onPress={() => setViewMonth((month) => addMonths(month, -1))}
                hitSlop={10}
                style={styles.monthButton}
                accessibilityLabel="Previous month"
              >
                <Ionicons name="chevron-back" size={18} color={colors.ink} />
              </Pressable>
              <View style={styles.monthTitleWrap}>
                <Text style={styles.monthTitle}>
                  {MONTHS[viewMonth.getMonth()]} {viewMonth.getFullYear()}
                </Text>
                <Text style={styles.monthSub}>Selected {displayDate(value)}</Text>
              </View>
              <Pressable
                onPress={() => setViewMonth((month) => addMonths(month, 1))}
                hitSlop={10}
                style={styles.monthButton}
                accessibilityLabel="Next month"
              >
                <Ionicons name="chevron-forward" size={18} color={colors.ink} />
              </Pressable>
            </View>

            <View style={styles.weekRow}>
              {WEEKDAYS.map((day) => (
                <Text key={day} style={styles.weekday}>
                  {day}
                </Text>
              ))}
            </View>

            <View style={styles.grid}>
              {cells.map((cell) => {
                if (!cell.date) return <View key={cell.key} style={styles.dayCell} />;
                const key = dateKey(cell.date);
                const isSelected = key === selectedKey;
                const isToday = key === todayKey;
                const inCurrent = sameMonth(cell.date, viewMonth);
                return (
                  <Pressable
                    key={cell.key}
                    onPress={() => choose(cell.date!)}
                    style={[
                      styles.dayCell,
                      isSelected ? { backgroundColor: accent } : null,
                      !isSelected && isToday ? styles.dayToday : null,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Choose ${displayDate(key)}`}
                  >
                    <Text
                      style={[
                        styles.dayText,
                        !inCurrent ? styles.dayMuted : null,
                        isSelected ? { color: accentInk, fontWeight: "900" } : null,
                        !isSelected && isToday ? styles.dayTodayText : null,
                      ]}
                    >
                      {cell.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.footer}>
              <Pressable onPress={() => setOpen(false)} style={styles.footerButton}>
                <Text style={styles.footerText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={chooseToday} style={[styles.footerButton, { backgroundColor: accent }]}>
                <Text style={[styles.todayText, { color: accentInk }]}>Today</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  pill: {
    height: 36,
    minWidth: 132,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceInset,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
    paddingHorizontal: 10,
  },
  pillCompact: { minWidth: 0, paddingHorizontal: 9 },
  pillText: { fontSize: 12, fontWeight: "800", color: colors.ink },
  iconButton: {
    height: 40,
    width: 40,
    borderRadius: 14,
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
  backdrop: {
    flex: 1,
    justifyContent: "center",
    padding: 20,
    backgroundColor: "rgba(28,26,22,0.24)",
  },
  sheet: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surfaceRaised,
    padding: 14,
    shadowColor: "#2b251f",
    shadowOpacity: 0.07,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 12 },
    elevation: 3,
  },
  monthHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  monthButton: {
    height: 38,
    width: 38,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceInset,
  },
  monthTitleWrap: { flex: 1, minWidth: 0, alignItems: "center" },
  monthTitle: { color: colors.ink, fontSize: 16, fontWeight: "800" },
  monthSub: { marginTop: 2, color: colors.inkFaint, fontSize: 11 },
  weekRow: { flexDirection: "row", marginTop: 14 },
  weekday: { flex: 1, textAlign: "center", color: colors.inkFaint, fontSize: 10, fontWeight: "800" },
  grid: { flexDirection: "row", flexWrap: "wrap", marginTop: 8 },
  dayCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
  },
  dayToday: { backgroundColor: colors.surfaceInset },
  dayText: { color: colors.ink, fontSize: 14, fontWeight: "700" },
  dayMuted: { color: colors.inkFaint },
  dayTodayText: { color: colors.ink, fontWeight: "900" },
  footer: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  footerButton: {
    height: 38,
    minWidth: 82,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  footerText: { color: colors.inkMuted, fontSize: 13, fontWeight: "800" },
  todayText: { fontSize: 13, fontWeight: "900" },
});
