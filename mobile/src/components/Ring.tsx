import { StyleSheet, View } from "react-native";
import { Text } from "./AppText";
import Svg, { Circle } from "react-native-svg";
import { colors } from "../lib/theme";

export function bandColor(score: number | null): string {
  if (score == null) return colors.inkFaint;
  if (score >= 80) return colors.ok;
  if (score >= 60) return colors.warn;
  return colors.bad;
}

/** Circular readiness gauge (0–100) with the value in the center. */
export function Ring({
  score,
  size = 120,
  stroke = 10,
  label,
}: {
  score: number | null;
  size?: number;
  stroke?: number;
  label?: string;
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = score == null ? 0 : Math.max(0, Math.min(1, score / 100));
  const color = bandColor(score);

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.surfaceInset} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <Text
        style={{
          fontSize: size * 0.3,
          lineHeight: size * 0.3,
          fontWeight: "800",
          color,
          includeFontPadding: false,
          textAlignVertical: "center",
        }}
      >
        {score ?? "—"}
      </Text>
      {label ? (
        <Text
          style={[styles.label, { maxWidth: size * 0.72 }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.5}
        >
          {label}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 11,
    lineHeight: 13,
    fontWeight: "700",
    color: colors.inkMuted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginTop: 2,
    textAlign: "center",
    includeFontPadding: false,
    textAlignVertical: "center",
  },
});
