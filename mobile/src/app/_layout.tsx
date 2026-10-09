import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { ActivityIndicator, AppState, type AppStateStatus, View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as SplashScreen from "expo-splash-screen";
import { useFonts, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold } from "@expo-google-fonts/manrope";
import { BarlowCondensed_700Bold, BarlowCondensed_800ExtraBold } from "@expo-google-fonts/barlow-condensed";
import { AuthProvider, useAuth } from "../lib/auth";
import { AthleteAskAgentOverlay, CoachAskAgentOverlay } from "../components/RoleAskAgentOverlays";
import { FeedbackHost } from "../components/FeedbackHost";
import { ConfirmHost } from "../components/ConfirmHost";
import { dashboardPathForRole } from "../lib/roles";
import { colors } from "../lib/theme";
import { MobileTourProvider, useTourRootView } from "../lib/tour/MobileTourProvider";
import { subscribeToPushMessages } from "../lib/push";
import { apiFetch } from "../lib/api";

const PRESENCE_HEARTBEAT_MS = 90_000;

SplashScreen.preventAutoHideAsync().catch(() => undefined);

const KNOWN_PUSH_ROUTES = [
  "/athlete/dashboard", "/athlete/check-in", "/athlete/rpe", "/athlete/water", "/athlete/trends",
  "/athlete/active-workout", "/athlete/meal-scan", "/athlete/coach-discovery", "/athlete/coach-profile",
  "/coach/dashboard", "/coach/athletes", "/coach/plan", "/coach/content", "/coach/profile", "/coach/messages",
  "/account", "/notifications",
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

  const heartbeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (status !== "authed") return;

    function sendHeartbeat() {
      apiFetch("/api/presence/heartbeat", { method: "POST" }).catch(() => undefined);
    }

    function startHeartbeat() {
      if (heartbeatTimer.current) return;
      sendHeartbeat();
      heartbeatTimer.current = setInterval(sendHeartbeat, PRESENCE_HEARTBEAT_MS);
    }

    function stopHeartbeat() {
      if (heartbeatTimer.current) {
        clearInterval(heartbeatTimer.current);
        heartbeatTimer.current = null;
      }
    }

    function onAppStateChange(next: AppStateStatus) {
      if (next === "active") startHeartbeat();
      else stopHeartbeat();
    }

    if (AppState.currentState === "active") startHeartbeat();
    const subscription = AppState.addEventListener("change", onAppStateChange);
    return () => {
      subscription.remove();
      stopHeartbeat();
    };
  }, [status]);

  if (status === "loading") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface }}>
        <ActivityIndicator color={colors.ink} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }} />
      {status === "authed" && user?.role === "athlete" ? <AthleteAskAgentOverlay /> : null}
      {status === "authed" && user?.role === "coach" ? <CoachAskAgentOverlay /> : null}
      <ConfirmHost />
      <FeedbackHost />
    </View>
  );
}

/**
 * Keeps legacy tour-hook consumers under the same root view without mounting
 * the old guided-tour visuals in the Fitora app shell.
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
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
    BarlowCondensed_700Bold,
    BarlowCondensed_800ExtraBold,
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
            <StatusBar style="light" />
            <Gate />
          </TourRootBoundary>
        </MobileTourProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
