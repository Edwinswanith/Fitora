import { StyleSheet, View } from "react-native";
import { Text } from "./AppText";
import { ProgressChart } from "react-native-chart-kit";
import { colors } from "../lib/theme";

export type GaugeBand = "green" | "amber" | "red" | "neutral";

const BAND_COLOR: Record<GaugeBand, string> = {
  green: colors.ok,
  amber: colors.warn,
  red: colors.bad,
  neutral: colors.inkFaint,
};

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const value = parseInt(clean, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/**
 * Small react-native-chart-kit progress ring — the mobile counterpart to the
 * web Gauge (recharts). `pct` (0–100) drives the ring fill; `displayValue`/
 * `displayUnit` render as their own center label independent of the fill.
 */
export function Gauge({
  pct,
  band,
  size = 76,
  strokeWidth = 9,
  displayValue,
  displayUnit,
}: {
  pct: number;
  band: GaugeBand;
  size?: number;
  strokeWidth?: number;
  displayValue: string;
  displayUnit?: string;
}) {
  const ratio = Math.max(0, Math.min(1, pct / 100));
  const color = BAND_COLOR[band];
  const [r, g, b] = hexToRgb(color);

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View style={StyleSheet.absoluteFill}>
        <ProgressChart
          data={{ data: [ratio], colors: [color] }}
          width={size}
          height={size}
          strokeWidth={strokeWidth}
          radius={size / 2 - strokeWidth - 2}
          hideLegend
          withCustomBarColorFromData
          chartConfig={{
            backgroundGradientFrom: colors.surfaceRaised,
            backgroundGradientTo: colors.surfaceRaised,
            color: (opacity = 1) => `rgba(${r},${g},${b},${opacity})`,
          }}
        />
      </View>
      <View style={styles.center} pointerEvents="none">
        <Text style={[styles.value, { color }]} numberOfLines={1} adjustsFontSizeToFit>
          {displayValue}
        </Text>
        {displayUnit ? <Text style={styles.unit}>{displayUnit}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },
  value: { fontSize: 16, lineHeight: 18, fontWeight: "800", includeFontPadding: false, textAlignVertical: "center" },
  unit: {
    fontSize: 9,
    lineHeight: 11,
    fontWeight: "700",
    color: colors.inkFaint,
    marginTop: 1,
    includeFontPadding: false,
    textAlignVertical: "center",
  },
});
