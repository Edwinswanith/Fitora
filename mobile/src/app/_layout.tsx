import { useCallback, useEffect, type ReactNode } from "react";
import { ActivityIndicator, View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as SplashScreen from "expo-splash-screen";
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  Inter_900Black,
} from "@expo-google-fonts/inter";
import { AuthProvider, useAuth } from "../lib/auth";
import { dashboardPathForRole } from "../lib/roles";
import { colors } from "../lib/theme";
import { MobileTourProvider, useTourRootView } from "../lib/tour/MobileTourProvider";
import { TourOverlay } from "../components/mascot/TourOverlay";
import { MascotReactionOverlay } from "../components/mascot/MascotReactionOverlay";
import { subscribeToPushMessages } from "../lib/push";

SplashScreen.preventAutoHideAsync().catch(() => undefined);

const KNOWN_PUSH_ROUTES = [
  "/athlete/dashboard", "/athlete/check-in", "/athlete/rpe", "/athlete/water", "/athlete/trends",
  "/coach/dashboard", "/coach/athletes", "/coach/messages", "/coach/announcements", "/coach/coaches",
  "/guardian/dashboard", "/guardian/athletes", "/account", "/notifications",
];

function Gate() {
  const { status, user } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (status === "loading") return;
    const top = segments[0] as string | undefined;
    const inAuthArea =
      top === undefined || top === "index" || top === "login" || top === "register";

    if (status === "anon" && !inAuthArea) {
      router.replace("/");
    } else if (status === "authed" && inAuthArea && user) {
      const dest = dashboardPathForRole(user.role) ?? "/";
      router.replace(dest as never);
    }
  }, [status, user, segments, router]);

  useEffect(() => {
    if (status !== "authed") return;
    return subscribeToPushMessages((link) => {
      const path = link.includes("?") ? link.slice(0, link.indexOf("?")) : link;
      const known = KNOWN_PUSH_ROUTES.some((route) => path === route || path.startsWith(`${route}/`));
      const dest = known ? link : (dashboardPathForRole(user?.role ?? "") ?? "/notifications");
      router.push(dest as never);
    });
  }, [status, user, router]);

  if (status === "loading") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface }}>
        <ActivityIndicator color={colors.ink} />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }} />
  );
}

/**
 * A single `View`, mounted once here, that both the router's screen content
 * (`Gate`/`Stack`) and `TourOverlay` share as an ancestor — see
 * `measureRelativeToRoot`'s doc comment for why every tour measurement is
 * computed relative to this node instead of via `measureInWindow`: on this
 * RN/Fabric + expo-router setup, `measureInWindow` for a view inside the
 * router's navigator was observed to disagree with `TourOverlay`'s own
 * absolutely-positioned frame by exactly the top safe-area inset, which
 * this sidesteps entirely.
 */
function TourRootBoundary({ children }: { children: ReactNode }) {
  const rootRef = useTourRootView();
  return (
    <View ref={rootRef} collapsable={false} style={{ flex: 1 }}>
      {children}
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
    Inter_900Black,
  });

  const onLayoutRootView = useCallback(async () => {
    if (fontsLoaded) await SplashScreen.hideAsync();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider onLayout={onLayoutRootView}>
      <AuthProvider>
        <MobileTourProvider>
          <TourRootBoundary>
            <StatusBar style="dark" />
            <Gate />
            <TourOverlay />
            <MascotReactionOverlay />
          </TourRootBoundary>
        </MobileTourProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
