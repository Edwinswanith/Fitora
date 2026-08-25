import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, View } from "react-native";
import { Text } from "../../components/AppText";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "../../lib/theme";

type IconName = keyof typeof Ionicons.glyphMap;

export default function CoachLayout() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.inkFaint,
        tabBarStyle: {
          height: 84 + insets.bottom,
          paddingTop: 9,
          paddingBottom: Math.max(14, insets.bottom + 10),
          backgroundColor: colors.surfaceRaised,
          borderTopColor: colors.line,
        },
        tabBarItemStyle: { paddingVertical: 3 },
        sceneStyle: { backgroundColor: colors.surface },
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: "Home",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name={focused ? "home" : "home-outline"} label="Home" color={String(color)} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="athletes"
        options={{
          title: "Clients",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name={focused ? "people" : "people-outline"} label="Clients" color={String(color)} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="plan"
        options={{
          title: "Plan",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name={focused ? "clipboard" : "clipboard-outline"} label="Plan" color={String(color)} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="content"
        options={{
          title: "Content",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name={focused ? "play" : "play-outline"} label="Content" color={String(color)} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name={focused ? "person" : "person-outline"} label="Profile" color={String(color)} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen name="messages" options={{ href: null }} />
      <Tabs.Screen name="announcements" options={{ href: null }} />
      <Tabs.Screen name="coaches" options={{ href: null }} />
    </Tabs>
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
      <View style={[styles.indicator, focused ? styles.indicatorOn : null]} />
      <Ionicons name={name} color={color} size={27} />
      <Text style={[styles.tabLabel, { color }, focused ? styles.tabLabelOn : null]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tabIcon: { minWidth: 62, alignItems: "center", justifyContent: "center", gap: 4 },
  indicator: { height: 3, width: 34, borderRadius: 2, backgroundColor: "transparent", marginBottom: 3 },
  indicatorOn: { backgroundColor: colors.primary },
  tabLabel: { height: 16, fontSize: 12, lineHeight: 16, fontWeight: "600" },
  tabLabelOn: { fontWeight: "800" },
});
