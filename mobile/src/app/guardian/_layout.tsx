import { Stack } from "expo-router";
import { colors } from "../../lib/theme";

export default function GuardianLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }} />
  );
}
