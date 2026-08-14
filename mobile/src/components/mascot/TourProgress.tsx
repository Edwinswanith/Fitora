import { StyleSheet, View } from "react-native";
import { Text } from "../AppText";
import { colors } from "../../lib/theme";

type TourProgressProps = {
  index: number;
  total: number;
  accent: string;
};

export function TourProgress({ index, total, accent }: TourProgressProps) {
  const pct = total ? ((index + 1) / total) * 100 : 0;
  return (
    <View>
      <Text style={styles.count} accessibilityLiveRegion="polite">
        Step {index + 1} of {total}
      </Text>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%`, backgroundColor: accent }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  count: { color: colors.inkFaint, fontSize: 10, fontWeight: "700", marginBottom: 6 },
  track: { height: 4, borderRadius: 999, backgroundColor: colors.surfaceInset, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 999 },
});
