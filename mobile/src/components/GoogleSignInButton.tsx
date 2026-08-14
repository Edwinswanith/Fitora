import { useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from "react-native";
import { Text } from "./AppText";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { GoogleSignin, statusCodes } from "@react-native-google-signin/google-signin";
import { useAuth } from "../lib/auth";
import { dashboardPathForRole, type Role } from "../lib/roles";
import { colors, radius } from "../lib/theme";

// The web OAuth client ID is used as the token audience so the API can verify
// native Google sign-ins. Override per-build with EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID.
const WEB_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ??
  "895210689446-ogejtfnpokvmh6kstejcj6oeag0cfl9o.apps.googleusercontent.com";
const IOS_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ??
  "895210689446-k1mose4899m83kg5o5ghho4rnqhalajc.apps.googleusercontent.com";

let configured = false;
function ensureConfigured() {
  if (!configured) {
    GoogleSignin.configure({
      webClientId: WEB_CLIENT_ID,
      iosClientId: IOS_CLIENT_ID,
      scopes: ["profile", "email"],
    });
    configured = true;
  }
}

function googleErrorMessage(error: unknown): string {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (code === statusCodes.SIGN_IN_CANCELLED) return "Google sign-in was cancelled.";
  if (code === statusCodes.IN_PROGRESS) return "Google sign-in is already in progress.";
  if (code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
    return "Google Play Services is not available or needs an update.";
  }
  if (code === "10" || code === "DEVELOPER_ERROR") {
    if (Platform.OS === "ios") {
      return "Google Sign-In is not configured for this iOS build. Check the iOS OAuth client ID, bundle ID, and URL scheme.";
    }
    return "Google Sign-In is not configured for this Android build. Check the app package name and signing SHA in Google Cloud/Firebase.";
  }
  if (code) return `Google sign-in failed on this device (${code}).`;
  return "Could not sign in with Google on this device.";
}

export function GoogleSignInButton({
  requestedRole,
  onError,
}: {
  requestedRole: Role;
  onError: (msg: string | null) => void;
}) {
  const { signInWithGoogle } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function onPress() {
    onError(null);
    setLoading(true);
    try {
      ensureConfigured();
      if (Platform.OS === "android") {
        await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      }
      const resp = (await GoogleSignin.signIn()) as {
        type?: string;
        data?: { idToken?: string | null } | null;
        idToken?: string | null;
      };
      if (resp?.type === "cancelled") return;
      const idToken = resp?.data?.idToken ?? resp?.idToken ?? null;
      if (!idToken) {
        onError("Google sign-in did not return a token. Try again.");
        return;
      }
      const result = await signInWithGoogle(idToken, requestedRole);
      if (!result.ok) {
        if (result.error === "self_signup_role_not_supported") {
          onError("Google sign-in for this role requires an existing account.");
        } else if (result.status === 403) {
          onError("That Google account cannot sign in right now.");
        } else if (result.status === 503) {
          onError("Google sign-in is not available right now.");
        } else if (result.status === 429) {
          onError("Too many attempts. Wait a minute and try again.");
        } else if (result.status === 401 && result.error === "invalid_google_token") {
          onError("Google token was rejected by the API. Check the Android/Web OAuth client IDs.");
        } else if (result.status === 0) {
          onError("Unable to reach the API server. Check your connection.");
        } else {
          onError(`Google sign-in failed (${result.error}).`);
        }
        return;
      }
      const dest = dashboardPathForRole(result.user.role);
      if (dest) router.replace(dest as never);
    } catch (err) {
      // Includes Play Services missing or running in Expo Go with no native module.
      onError(googleErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={{ gap: 14, marginTop: 4 }}>
      <View style={styles.dividerRow}>
        <View style={styles.line} />
        <Text style={styles.or}>OR</Text>
        <View style={styles.line} />
      </View>
      <Pressable
        onPress={onPress}
        disabled={loading}
        style={({ pressed }) => [styles.btn, { opacity: loading ? 0.6 : pressed ? 0.9 : 1 }]}
      >
        {loading ? (
          <ActivityIndicator color={colors.ink} />
        ) : (
          <>
            <Ionicons name="logo-google" size={18} color="#4285F4" />
            <Text style={styles.btnText}>Sign in with Google</Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  dividerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  line: { flex: 1, height: 1, backgroundColor: colors.line },
  or: { fontSize: 10, fontWeight: "700", letterSpacing: 2, color: colors.inkFaint },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
  },
  btnText: { fontSize: 16, fontWeight: "700", color: colors.ink },
});
