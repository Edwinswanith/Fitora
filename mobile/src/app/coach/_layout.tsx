import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, View } from "react-native";
import { Text } from "../../components/AppText";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ROLE_THEMES, colors } from "../../lib/theme";
import { CoachAskAgentOverlay } from "../../components/RoleAskAgentOverlays";

type IconName = keyof typeof Ionicons.glyphMap;

export default function CoachLayout() {
  const accent = ROLE_THEMES.coach.accent;
  const insets = useSafeAreaInsets();
  return (
    <>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarShowLabel: false,
          tabBarActiveTintColor: accent,
          tabBarInactiveTintColor: colors.inkFaint,
          tabBarStyle: {
            height: 82 + insets.bottom,
            paddingTop: 8,
            paddingBottom: Math.max(18, insets.bottom + 14),
            backgroundColor: colors.surfaceRaised,
            borderTopColor: colors.line,
          },
          tabBarItemStyle: { paddingVertical: 4 },
          sceneStyle: { backgroundColor: colors.surface },
        }}
      >
        <Tabs.Screen
          name="dashboard"
          options={{
            title: "Squad",
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name="people-outline" label="Squad" color={String(color)} focused={focused} />
            ),
          }}
        />
        <Tabs.Screen
          name="athletes"
          options={{
            title: "Roster",
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name="clipboard-outline" label="Roster" color={String(color)} focused={focused} />
            ),
          }}
        />
        <Tabs.Screen
          name="messages"
          options={{
            title: "Messages",
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name="chatbubble-ellipses-outline" label="Messages" color={String(color)} focused={focused} />
            ),
          }}
        />
        <Tabs.Screen
          name="announcements"
          options={{
            title: "Announce",
            tabBarIcon: ({ color, focused }) => (
              <TabIcon name="megaphone-outline" label="Announce" color={String(color)} focused={focused} />
            ),
          }}
        />
        <Tabs.Screen name="coaches" options={{ href: null }} />
      </Tabs>
      <CoachAskAgentOverlay />
    </>
  );
}

function TabIcon({
  name,
  label,
  color,
  focused,
}: {
  name: IconName;
  label: string;
  color: string;
  focused: boolean;
}) {
  return (
    <View style={styles.tabIcon}>
      <View style={[styles.iconBubble, focused ? { backgroundColor: ROLE_THEMES.coach.accentSoft } : null]}>
        <Ionicons name={name} color={color} size={17} />
      </View>
      <Text style={[styles.tabLabel, { color }]} numberOfLines={1}>
        {label}
      </Text>
      <View style={[styles.tabIndicator, focused ? { backgroundColor: ROLE_THEMES.coach.accent } : null]} />
    </View>
  );
}

const styles = StyleSheet.create({
  tabIcon: { minWidth: 58, alignItems: "center", justifyContent: "center", gap: 3 },
  iconBubble: { height: 30, minWidth: 42, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  tabLabel: { height: 14, fontSize: 10, lineHeight: 14, fontWeight: "600" },
  tabIndicator: { marginTop: 2, height: 2, width: 16, borderRadius: 1, backgroundColor: "transparent" },
});
