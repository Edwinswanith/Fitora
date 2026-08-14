import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "./AppText";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius } from "../lib/theme";

/** 1–5 rating selector. */
export function Scale({
  label,
  value,
  onChange,
  accent,
  lowHint,
  highHint,
}: {
  label: string;
  value: number | null;
  onChange: (v: number) => void;
  accent: string;
  lowHint?: string;
  highHint?: string;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.pills}>
        {[1, 2, 3, 4, 5].map((n) => {
          const on = value === n;
          return (
            <Pressable
              key={n}
              onPress={() => onChange(n)}
              style={[
                styles.pill,
                { borderColor: on ? accent : colors.line, backgroundColor: on ? accent : colors.surfaceInset },
              ]}
            >
              <Text style={[styles.pillText, { color: on ? "#fff" : colors.inkMuted }]}>{n}</Text>
            </Pressable>
          );
        })}
      </View>
      {lowHint || highHint ? (
        <View style={styles.hintRow}>
          <Text style={styles.hint}>{lowHint}</Text>
          <Text style={styles.hint}>{highHint}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Numeric stepper with +/- (e.g. sleep hours). */
export function Stepper({
  label,
  value,
  onChange,
  step = 0.5,
  min = 0,
  max = 14,
  unit,
  accent,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  accent: string;
}) {
  const clamp = (v: number) => Math.max(min, Math.min(max, Math.round(v * 10) / 10));
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.stepperRow}>
        <Pressable onPress={() => onChange(clamp(value - step))} style={[styles.stepBtn, { borderColor: colors.line }]}>
          <Ionicons name="remove" size={22} color={accent} />
        </Pressable>
        <Text style={styles.stepValue}>
          {value}
          {unit ? <Text style={styles.unit}> {unit}</Text> : null}
        </Text>
        <Pressable onPress={() => onChange(clamp(value + step))} style={[styles.stepBtn, { borderColor: colors.line }]}>
          <Ionicons name="add" size={22} color={accent} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: "700", color: colors.ink },
  pills: { flexDirection: "row", gap: 8 },
  pill: {
    flex: 1,
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  pillText: { fontSize: 16, fontWeight: "700" },
  hintRow: { flexDirection: "row", justifyContent: "space-between" },
  hint: { fontSize: 11, color: colors.inkFaint },
  stepperRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  stepBtn: {
    height: 48,
    width: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceInset,
  },
  stepValue: { fontSize: 24, fontWeight: "800", color: colors.ink },
  unit: { fontSize: 14, fontWeight: "600", color: colors.inkMuted },
});
