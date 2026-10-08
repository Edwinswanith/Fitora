import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, type KeyboardTypeOptions, type StyleProp, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "./AppText";
import { BackHeader, type IconName } from "./fitora";
import { colors, radius } from "../lib/theme";

/**
 * Small building blocks shared by the coach plan-builder editors
 * (app/coach/plan/workout-template.tsx and meal-plan.tsx). Visual language
 * matches components/fitora.tsx; only the form-specific pieces live here.
 */

export function EditorScreen({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function EditorHeader({ title, subtitle, onBack }: { title: string; subtitle?: string; onBack: () => void; backLabel?: string }) {
  return <BackHeader title={title} subtitle={subtitle} onBack={onBack} />;
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}

export function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline,
  keyboardType,
  maxLength,
  style,
  compact,
  accessibilityLabel,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: KeyboardTypeOptions;
  maxLength?: number;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <View style={[styles.field, style]}>
      {label ? <FieldLabel>{label}</FieldLabel> : null}
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.inkFaint}
        multiline={multiline}
        keyboardType={keyboardType}
        maxLength={maxLength}
        accessibilityLabel={accessibilityLabel ?? label}
        style={[styles.input, compact ? styles.inputCompact : null, multiline ? styles.inputMultiline : null]}
      />
    </View>
  );
}

export function Chip({ label, selected, onPress, disabled }: { label: string; selected: boolean; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      style={[styles.chip, selected ? styles.chipOn : null, disabled ? styles.disabled : null]}
    >
      <Text style={[styles.chipText, selected ? styles.chipTextOn : null]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

export function ChipRow({ children }: { children: ReactNode }) {
  return <View style={styles.chipRow}>{children}</View>;
}

export function IconButton({ icon, label, onPress, disabled, tone = "neutral" }: { icon: IconName; label: string; onPress: () => void; disabled?: boolean; tone?: "neutral" | "danger" | "primary" }) {
  const color = disabled ? colors.lineStrong : tone === "danger" ? colors.bad : tone === "primary" ? colors.primary : colors.inkMuted;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.iconButton, pressed ? styles.pressed : null]}
    >
      <Ionicons name={icon} size={19} color={color} />
    </Pressable>
  );
}

export function ErrorList({ title, errors }: { title: string; errors: string[] }) {
  if (!errors.length) return null;
  const shown = errors.slice(0, 8);
  return (
    <View style={styles.errorBox} accessibilityLiveRegion="polite">
      <View style={styles.errorHead}>
        <Ionicons name="alert-circle-outline" size={18} color={colors.bad} />
        <Text style={styles.errorTitle}>{title}</Text>
      </View>
      {shown.map((error, index) => (
        <Text key={`${index}-${error}`} style={styles.errorLine}>- {error}</Text>
      ))}
      {errors.length > shown.length ? <Text style={styles.errorLine}>...and {errors.length - shown.length} more.</Text> : null}
    </View>
  );
}

export function PrimaryButton({ label, onPress, disabled, busy, tone = "primary" }: { label: string; onPress: () => void; disabled?: boolean; busy?: boolean; tone?: "primary" | "outline" | "danger" }) {
  const isDisabled = disabled || busy;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        tone === "outline" ? styles.buttonOutline : tone === "danger" ? styles.buttonDanger : null,
        isDisabled ? styles.disabled : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <Text style={[styles.buttonText, tone === "outline" ? styles.buttonTextOutline : tone === "danger" ? styles.buttonTextDanger : null]}>
        {busy ? "Saving..." : label}
      </Text>
    </Pressable>
  );
}

export const editorStyles = StyleSheet.create({
  card: { backgroundColor: colors.surfaceRaised, borderRadius: 10, borderWidth: 1, borderColor: colors.line, padding: 12, gap: 10 },
  row: { flexDirection: "row", gap: 8 },
  flex1: { flex: 1, minWidth: 0 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  cardTitle: { flex: 1, minWidth: 0, color: colors.ink, fontSize: 15, lineHeight: 20, fontWeight: "900" },
  muted: { color: colors.inkMuted, fontSize: 12, lineHeight: 17 },
  sectionTitle: { color: colors.ink, fontSize: 16, lineHeight: 21, fontWeight: "900", marginTop: 6 },
  badge: { color: colors.primary, fontSize: 12, fontWeight: "900" },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  content: { paddingHorizontal: 15, paddingTop: 6, paddingBottom: 140, gap: 10 },
  label: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, fontWeight: "900", textTransform: "uppercase" },
  field: { gap: 4 },
  input: {
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.ink,
    fontSize: 14,
    fontWeight: "600",
  },
  inputCompact: { minHeight: 40, paddingHorizontal: 8, paddingVertical: 8, fontSize: 13 },
  inputMultiline: { minHeight: 72, textAlignVertical: "top" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { minHeight: 32, maxWidth: "100%", borderRadius: 10, borderWidth: 1, borderColor: colors.lineStrong, paddingHorizontal: 11, alignItems: "center", justifyContent: "center" },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  chipText: { color: colors.inkMuted, fontSize: 12, fontWeight: "800" },
  chipTextOn: { color: colors.primary },
  iconButton: { width: 34, height: 34, borderRadius: 9, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceInset },
  errorBox: { borderRadius: 10, borderWidth: 1, borderColor: "#5a2229", backgroundColor: colors.badSoft, padding: 11, gap: 4 },
  errorHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  errorTitle: { color: colors.bad, fontSize: 13, fontWeight: "900", flex: 1 },
  errorLine: { color: colors.ink, fontSize: 12, lineHeight: 17 },
  button: { minHeight: 46, borderRadius: 12, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 },
  buttonOutline: { backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.primary },
  buttonDanger: { backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.bad },
  buttonText: { color: colors.onPrimary, fontSize: 14, fontWeight: "900" },
  buttonTextOutline: { color: colors.primary },
  buttonTextDanger: { color: colors.bad },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.75 },
});
