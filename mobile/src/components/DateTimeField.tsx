import { useState, type ReactNode } from "react";
import { Modal, Platform, Pressable, StyleSheet, View } from "react-native";
import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "./AppText";
import { colors, radius } from "../lib/theme";
import {
  clampDateString,
  displayDate,
  displayTime,
  formatLocalDate,
  formatLocalTime,
  parseLocalDate,
  prefers24HourClock,
  timeToPickerDate,
  todayLocalDate,
} from "../lib/dateTimeValues";
import type { DateFieldProps, TimeFieldProps } from "./dateTimeFieldTypes";

// Native (iOS/Android) date + time fields. Web uses DateTimeField.web.tsx
// (a real <input type="date|time">), since the community picker has no web
// implementation. Both files export the same API and take/return plain
// strings: dates as local "YYYY-MM-DD", times as 24h "HH:MM".
//
// Android: tapping opens the system dialog (DateTimePickerAndroid.open, the
// library's recommended imperative API). iOS: tapping opens a bottom sheet
// with a spinner and a Done button.

export type { DateFieldProps, TimeFieldProps } from "./dateTimeFieldTypes";

export function DateField({
  value,
  onChange,
  minimumDate,
  maximumDate,
  initialPickerDate,
  ...shell
}: DateFieldProps) {
  const [iosDraft, setIosDraft] = useState<Date | null>(null);

  function startDate(): Date {
    const fallback = clampDateString(initialPickerDate ?? todayLocalDate(), minimumDate, maximumDate);
    return parseLocalDate(value) ?? parseLocalDate(fallback) ?? new Date();
  }

  function commit(date: Date) {
    onChange(clampDateString(formatLocalDate(date), minimumDate, maximumDate));
  }

  function open() {
    if (shell.disabled) return;
    const start = startDate();
    const min = minimumDate ? parseLocalDate(minimumDate) ?? undefined : undefined;
    const max = maximumDate ? parseLocalDate(maximumDate) ?? undefined : undefined;
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: start,
        mode: "date",
        minimumDate: min,
        maximumDate: max,
        onValueChange: (_event, date) => commit(date),
      });
      return;
    }
    setIosDraft((current) => (current ? null : start));
  }

  function done() {
    if (iosDraft) commit(iosDraft);
    setIosDraft(null);
  }

  return (
    <FieldShell
      {...shell}
      icon="calendar-outline"
      hint="Opens a date picker"
      displayValue={value ? displayDate(value) : ""}
      expanded={iosDraft != null}
      onPress={open}
    >
      {iosDraft ? (
        <IosSheet title={shell.label ?? shell.accessibilityLabel} onDone={done}>
          <DateTimePicker
            value={iosDraft}
            mode="date"
            display="spinner"
            themeVariant="light"
            textColor={colors.ink}
            minimumDate={minimumDate ? parseLocalDate(minimumDate) ?? undefined : undefined}
            maximumDate={maximumDate ? parseLocalDate(maximumDate) ?? undefined : undefined}
            onValueChange={(_event, date) => {
              setIosDraft(date);
              commit(date);
            }}
          />
        </IosSheet>
      ) : null}
    </FieldShell>
  );
}

export function TimeField({ value, onChange, initialPickerTime, minuteInterval, ...shell }: TimeFieldProps) {
  const [iosDraft, setIosDraft] = useState<Date | null>(null);

  function startDate(): Date {
    const base = new Date();
    return timeToPickerDate(value, base) ?? timeToPickerDate(initialPickerTime ?? "09:00", base) ?? base;
  }

  function commit(date: Date) {
    onChange(formatLocalTime(date));
  }

  function open() {
    if (shell.disabled) return;
    const start = startDate();
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: start,
        mode: "time",
        is24Hour: prefers24HourClock(),
        onValueChange: (_event, date) => commit(date),
      });
      return;
    }
    setIosDraft((current) => (current ? null : start));
  }

  function done() {
    if (iosDraft) commit(iosDraft);
    setIosDraft(null);
  }

  return (
    <FieldShell
      {...shell}
      icon="time-outline"
      hint="Opens a time picker"
      displayValue={value ? displayTime(value) : ""}
      expanded={iosDraft != null}
      onPress={open}
    >
      {iosDraft ? (
        <IosSheet title={shell.label ?? shell.accessibilityLabel} onDone={done}>
          <DateTimePicker
            value={iosDraft}
            mode="time"
            display="spinner"
            themeVariant="light"
            textColor={colors.ink}
            minuteInterval={minuteInterval}
            onValueChange={(_event, date) => {
              setIosDraft(date);
              commit(date);
            }}
          />
        </IosSheet>
      ) : null}
    </FieldShell>
  );
}

function FieldShell({
  label,
  accessibilityLabel,
  placeholder,
  disabled,
  style,
  fieldStyle,
  textStyle,
  labelStyle,
  icon,
  hint,
  displayValue,
  expanded,
  onPress,
  children,
}: Omit<DateFieldProps, "value" | "onChange" | "minimumDate" | "maximumDate" | "initialPickerDate"> & {
  icon: "calendar-outline" | "time-outline";
  hint: string;
  displayValue: string;
  expanded: boolean;
  onPress: () => void;
  children?: ReactNode;
}) {
  const name = accessibilityLabel ?? label ?? "Date";
  return (
    <View style={[styles.wrap, style]}>
      {label ? <Text style={[styles.label, labelStyle]}>{label}</Text> : null}
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={name}
        accessibilityValue={{ text: displayValue || "Not set" }}
        accessibilityHint={hint}
        accessibilityState={{ disabled: Boolean(disabled), expanded }}
        style={({ pressed }) => [
          styles.field,
          expanded ? styles.fieldActive : null,
          disabled ? styles.fieldDisabled : null,
          pressed ? styles.pressed : null,
          fieldStyle,
        ]}
      >
        <Text style={[styles.value, displayValue ? null : styles.placeholder, textStyle]} numberOfLines={1}>
          {displayValue || placeholder || "Select"}
        </Text>
        <Ionicons name={icon} size={17} color={expanded ? colors.primary : colors.inkMuted} />
      </Pressable>
      {children}
    </View>
  );
}

/**
 * iOS bottom sheet holding the spinner. A modal (not an inline expansion) so
 * the full-width spinner fits even when the field sits in a narrow column.
 * Tapping the backdrop behaves like Done.
 */
function IosSheet({ title, onDone, children }: { title?: string; onDone: () => void; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onDone} supportedOrientations={["portrait", "landscape"]}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.backdrop} onPress={onDone} accessibilityRole="button" accessibilityLabel="Close picker" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle} numberOfLines={1}>{title ?? ""}</Text>
            <Pressable onPress={onDone} accessibilityRole="button" accessibilityLabel="Done" style={styles.doneButton} hitSlop={6}>
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 5 },
  label: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "900", textTransform: "uppercase" },
  field: {
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  fieldActive: { borderColor: colors.primary },
  fieldDisabled: { backgroundColor: colors.surfaceInset, opacity: 0.6 },
  pressed: { opacity: 0.72 },
  value: { flex: 1, minWidth: 0, color: colors.ink, fontSize: 13, fontWeight: "800" },
  placeholder: { color: colors.inkFaint, fontWeight: "600" },
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  backdrop: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.overlay },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.surfaceRaised,
    paddingTop: 10,
  },
  sheetHeader: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingBottom: 4 },
  sheetTitle: { flex: 1, minWidth: 0, color: colors.ink, fontSize: 15, fontWeight: "900" },
  doneButton: {
    minHeight: 36,
    paddingHorizontal: 16,
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  doneText: { color: colors.onPrimary, fontSize: 14, fontWeight: "900" },
});
