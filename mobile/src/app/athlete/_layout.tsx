import { Stack } from "expo-router";
import { AthleteAskAgentOverlay } from "../../components/RoleAskAgentOverlays";
import { colors } from "../../lib/theme";

export default function AthleteLayout() {
  return (
    <>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }} />
      <AthleteAskAgentOverlay />
    </>
  );
}
