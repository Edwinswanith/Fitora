import { ReactNode, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleProp, StyleSheet, TextInput, TextInputProps, View, ViewStyle } from "react-native";
import { Text } from "./AppText";
import { Ionicons } from "@expo/vector-icons";
import { colors, fonts } from "../lib/theme";

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Label({ children }: { children: ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}

export function H1({ children, style }: { children: ReactNode; style?: object }) {
  return <Text style={[styles.h1, style]}>{children}</Text>;
}

export function Muted({ children, style }: { children: ReactNode; style?: object }) {
  return <Text style={[styles.muted, style]}>{children}</Text>;
}

/**
 * Primary CTA. When `successLabel` is set and `onPress` returns a Promise, the
 * button shows a spinner while it runs, then flips to a green "✓ <successLabel>"
 * confirmation for ~1.6s before reverting — the common "Save → Saved ✓" reaction.
 * A promise that resolves `false` (or throws) is treated as failure: no flash.
 */
export function PrimaryButton({
  label,
  onPress,
  loading,
  disabled,
  accent = colors.primary,
  accentInk = colors.onPrimary,
  successLabel,
  successDurationMs = 1600,
  icon,
}: {
  label: string;
  onPress: () => void | boolean | Promise<void | boolean>;
  loading?: boolean;
  disabled?: boolean;
  accent?: string;
  accentInk?: string;
  successLabel?: string;
  successDurationMs?: number;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const [phase, setPhase] = useState<"idle" | "busy" | "done">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const busy = loading || phase === "busy";
  const off = disabled || busy || phase === "done";

  async function handlePress() {
    const result = onPress();
    const isPromise = !!result && typeof (result as { then?: unknown }).then === "function";
    if (!successLabel || !isPromise) return;
    setPhase("busy");
    let ok = true;
    try {
      ok = (await result) !== false;
    } catch {
      ok = false;
    }
    if (!ok) {
      setPhase("idle");
      return;
    }
    setPhase("done");
    timer.current = setTimeout(() => setPhase("idle"), successDurationMs);
  }

  return (
    <Pressable
      onPress={handlePress}
      disabled={off}
      style={({ pressed }) => [
        styles.btn,
        {
          backgroundColor: phase === "done" ? colors.ok : accent,
          opacity: off && phase !== "done" ? 0.45 : pressed ? 0.9 : 1,
          transform: [{ scale: pressed && !off ? 0.97 : 1 }],
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={accentInk} />
      ) : phase === "done" ? (
        <View style={styles.btnRow}>
          <Ionicons name="checkmark-circle" size={18} color={colors.onPrimary} />
          <Text style={[styles.btnText, { color: colors.onPrimary }]}>{successLabel}</Text>
        </View>
      ) : icon ? (
        <View style={styles.btnRow}>
          <Ionicons name={icon} size={17} color={accentInk} />
          <Text style={[styles.btnText, { color: accentInk }]}>{label}</Text>
        </View>
      ) : (
        <Text style={[styles.btnText, { color: accentInk }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function TextField(props: TextInputProps & { isPassword?: boolean }) {
  const { isPassword, style, onFocus, onBlur, ...rest } = props;
  const [show, setShow] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.fieldWrap}>
      <TextInput
        {...rest}
        onFocus={(e) => { setFocused(true); onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); onBlur?.(e); }}
        secureTextEntry={isPassword && !show}
        placeholderTextColor={colors.inkFaint}
        style={[styles.field, focused ? styles.fieldFocused : null, isPassword ? { paddingRight: 44 } : null, style as object]}
      />
      {isPassword ? (
        <Pressable
          onPress={() => setShow((s) => !s)}
          hitSlop={10}
          style={styles.eye}
          accessibilityLabel={show ? "Hide password" : "Show password"}
        >
          <Ionicons name={show ? "eye-off-outline" : "eye-outline"} size={20} color={colors.inkFaint} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function Banner({ kind, children }: { kind: "error" | "ok"; children: ReactNode }) {
  const c = kind === "error" ? colors.bad : colors.ok;
  return (
    <View style={[styles.banner, { borderColor: c + "40", backgroundColor: kind === "error" ? colors.badSoft : colors.okSoft }]} accessibilityRole="alert">
      <Ionicons name={kind === "error" ? "alert-circle" : "checkmark-circle"} size={18} color={c} />
      <Text style={[styles.bannerText, { color: c }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Matches the AppCard look in components/fitora.tsx so legacy screens sit in the same system.
  card: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    shadowColor: "#0b3a36",
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  label: { fontSize: 13, fontWeight: "700", color: colors.inkMuted },
  h1: { fontFamily: fonts.display, fontSize: 34, lineHeight: 37, color: colors.ink, textTransform: "uppercase", letterSpacing: 0.3 },
  muted: { fontSize: 14, color: colors.inkMuted, lineHeight: 20 },
  btn: {
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  btnRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  btnText: { fontSize: 16, fontWeight: "800" },
  fieldWrap: { position: "relative", justifyContent: "center" },
  field: {
    height: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceInset,
    paddingHorizontal: 14,
    fontSize: 16,
    color: colors.ink,
    fontFamily: "Manrope_500Medium",
    fontWeight: "normal",
    includeFontPadding: false,
  },
  fieldFocused: { borderColor: colors.primary, borderWidth: 1.5 },
  eye: { position: "absolute", right: 12, height: 52, width: 32, alignItems: "center", justifyContent: "center" },
  banner: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  bannerText: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: "600" },
});
