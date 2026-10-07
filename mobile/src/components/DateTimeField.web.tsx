import { useState, type CSSProperties } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "./AppText";
import { colors } from "../lib/theme";
import { clampDateString, isValidDateString, isValidTimeString } from "../lib/dateTimeValues";
import type { DateFieldProps, TimeFieldProps } from "./dateTimeFieldTypes";

// Web build of DateField/TimeField (see DateTimeField.tsx for native). The
// community datetimepicker has no web implementation, so this renders a real
// <input type="date|time">: the browser supplies a localized display, a
// calendar/clock popup, keyboard entry and screen-reader semantics. Its value
// is already the "YYYY-MM-DD" / "HH:MM" string the native fields produce.

export type { DateFieldProps, TimeFieldProps } from "./dateTimeFieldTypes";

type InputEvent = { currentTarget: HTMLInputElement };

/** Chrome/Edge/Safari only open the popup from the icon; showPicker() opens it from anywhere in the box. */
function openNativePicker(event: InputEvent) {
  try {
    (event.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.();
  } catch {
    // Not supported or not allowed here: the input still works by keyboard/icon.
  }
}

export function DateField({
  value,
  onChange,
  minimumDate,
  maximumDate,
  label,
  accessibilityLabel,
  disabled,
  style,
  fieldStyle,
  textStyle,
  labelStyle,
}: DateFieldProps) {
  const [focused, setFocused] = useState(false);

  function handleChange(event: InputEvent) {
    const next = event.currentTarget.value;
    // A half-typed date reports "" with badInput set; passing that up would make
    // React reset the input and wipe what the user is typing.
    if (next === "" && event.currentTarget.validity.badInput) return;
    if (next === "" || isValidDateString(next)) onChange(next);
  }

  function handleBlur(event: InputEvent) {
    setFocused(false);
    // Browsers don't stop typed dates outside min/max; snap them back on blur
    // (not while typing, where the year passes through values like 0002).
    const current = event.currentTarget.value;
    if (current && isValidDateString(current)) {
      const clamped = clampDateString(current, minimumDate, maximumDate);
      if (clamped !== current) onChange(clamped);
    }
  }

  return (
    <View style={[styles.wrap, style]}>
      {label ? <Text style={[styles.label, labelStyle]}>{label}</Text> : null}
      <input
        type="date"
        value={value}
        min={minimumDate}
        max={maximumDate}
        disabled={disabled}
        aria-label={accessibilityLabel ?? label ?? "Date"}
        onChange={handleChange}
        onClick={openNativePicker}
        onFocus={() => setFocused(true)}
        onBlur={handleBlur}
        style={inputStyle({ focused, disabled: Boolean(disabled), hasValue: Boolean(value), fieldStyle, textStyle })}
      />
    </View>
  );
}

export function TimeField({
  value,
  onChange,
  minuteInterval,
  label,
  accessibilityLabel,
  disabled,
  style,
  fieldStyle,
  textStyle,
  labelStyle,
}: TimeFieldProps) {
  const [focused, setFocused] = useState(false);

  function handleChange(event: InputEvent) {
    const next = event.currentTarget.value;
    if (next === "" && event.currentTarget.validity.badInput) return;
    // step >= 60s keeps the value as "HH:MM"; trim seconds defensively anyway.
    const trimmed = next.slice(0, 5);
    if (trimmed === "" || isValidTimeString(trimmed)) onChange(trimmed);
  }

  return (
    <View style={[styles.wrap, style]}>
      {label ? <Text style={[styles.label, labelStyle]}>{label}</Text> : null}
      <input
        type="time"
        value={value}
        step={(minuteInterval ?? 1) * 60}
        disabled={disabled}
        aria-label={accessibilityLabel ?? label ?? "Time"}
        onChange={handleChange}
        onClick={openNativePicker}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={inputStyle({ focused, disabled: Boolean(disabled), hasValue: Boolean(value), fieldStyle, textStyle })}
      />
    </View>
  );
}

function inputStyle({
  focused,
  disabled,
  hasValue,
  fieldStyle,
  textStyle,
}: {
  focused: boolean;
  disabled: boolean;
  hasValue: boolean;
  fieldStyle: DateFieldProps["fieldStyle"];
  textStyle: DateFieldProps["textStyle"];
}): CSSProperties {
  // Carry over the few box/text overrides a screen passes so the web input
  // matches that screen's other inputs (e.g. the taller fields on Account).
  const box = StyleSheet.flatten(fieldStyle) ?? {};
  const text = StyleSheet.flatten(textStyle) ?? {};
  const num = (v: unknown, fallback: number) => (typeof v === "number" ? v : fallback);
  return {
    boxSizing: "border-box",
    width: "100%",
    minWidth: 0,
    minHeight: num(box.minHeight, 42),
    borderRadius: num(box.borderRadius, 10),
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: focused ? colors.primary : colors.lineStrong,
    backgroundColor: disabled ? colors.surfaceInset : colors.surfaceRaised,
    paddingLeft: num(box.paddingHorizontal, 12),
    paddingRight: num(box.paddingHorizontal, 10),
    color: hasValue ? colors.ink : colors.inkFaint,
    fontFamily: "Inter_700Bold, Inter, system-ui, -apple-system, sans-serif",
    fontSize: num(text.fontSize, 13),
    outline: "none",
    // Replaces the removed default outline so keyboard focus stays visible.
    boxShadow: focused ? `0 0 0 3px ${colors.primarySoft}` : "none",
    opacity: disabled ? 0.6 : 1,
    cursor: disabled ? "default" : "pointer",
    colorScheme: "light",
  };
}

const styles = StyleSheet.create({
  wrap: { gap: 5 },
  label: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "900", textTransform: "uppercase" },
});
