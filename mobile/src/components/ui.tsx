import { ReactNode, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleProp, StyleSheet, TextInput, TextInputProps, View, ViewStyle } from "react-native";
import { Text } from "./AppText";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius } from "../lib/theme";

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
  accent = colors.ink,
  accentInk = "#fff",
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
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={accentInk} />
      ) : phase === "done" ? (
        <View style={styles.btnRow}>
          <Ionicons name="checkmark-circle" size={18} color="#fff" />
          <Text style={[styles.btnText, { color: "#fff" }]}>{successLabel}</Text>
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
  const { isPassword, style, ...rest } = props;
  const [show, setShow] = useState(false);
  return (
    <View style={styles.fieldWrap}>
      <TextInput
        {...rest}
        secureTextEntry={isPassword && !show}
        placeholderTextColor={colors.inkFaint}
        style={[styles.field, isPassword ? { paddingRight: 44 } : null, style as object]}
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
    <View style={[styles.banner, { borderColor: c + "55", backgroundColor: c + "18" }]}>
      <Text style={{ color: c, fontSize: 14 }}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    shadowColor: "#2b251f",
    shadowOpacity: 0.024,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 8 },
    elevation: 1,
  },
  label: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: colors.inkMuted,
  },
  h1: { fontSize: 34, fontWeight: "800", color: colors.ink, letterSpacing: -0.5 },
  muted: { fontSize: 14, color: colors.inkMuted, lineHeight: 20 },
  btn: {
    height: 52,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  btnRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  btnText: { fontSize: 16, fontWeight: "700" },
  fieldWrap: { position: "relative", justifyContent: "center" },
  field: {
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceInset,
    paddingHorizontal: 14,
    fontSize: 16,
    color: colors.ink,
    fontFamily: "Inter_400Regular",
    fontWeight: "normal",
    includeFontPadding: false,
  },
  eye: { position: "absolute", right: 12, height: 52, width: 32, alignItems: "center", justifyContent: "center" },
  banner: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10 },
});
