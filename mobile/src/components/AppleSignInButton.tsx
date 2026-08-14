import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import { useRouter } from "expo-router";
import { Text } from "./AppText";
import { useAuth } from "../lib/auth";
import { dashboardPathForRole, type Role } from "../lib/roles";
import { colors, radius } from "../lib/theme";

function appleFullName(fullName: AppleAuthentication.AppleAuthenticationFullName | null): string | undefined {
  if (!fullName) return undefined;
  return [fullName.givenName, fullName.middleName, fullName.familyName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ") || undefined;
}

export function AppleSignInButton({
  requestedRole,
  onError,
}: {
  requestedRole: Role;
  onError: (msg: string | null) => void;
}) {
  const { signInWithApple } = useAuth();
  const router = useRouter();
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    if (Platform.OS !== "ios") return;
    AppleAuthentication.isAvailableAsync()
      .then((ok) => {
        if (active) setAvailable(ok);
      })
      .catch(() => {
        if (active) setAvailable(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function onPress() {
    onError(null);
    setLoading(true);
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) {
        onError("Apple sign-in did not return a token. Try again.");
        return;
      }

      const result = await signInWithApple(
        credential.identityToken,
        requestedRole,
        appleFullName(credential.fullName)
      );
      if (!result.ok) {
        // Clean, non-technical messages only — the specific failure reason
        // (audience mismatch, expired token, etc.) is in the server's own
        // logs, never exposed to the end user.
        if (result.error === "self_signup_role_not_supported") {
          onError("Apple sign-in for this role requires an existing account.");
        } else if (result.status === 403) {
          onError("That Apple account can't sign in right now.");
        } else if (result.status === 429) {
          onError("Too many attempts. Wait a minute and try again.");
        } else if (result.status === 0) {
          onError("Unable to reach the server. Check your connection.");
        } else {
          onError("Unable to sign in with Apple. Please try again.");
        }
        return;
      }

      const dest = dashboardPathForRole(result.user.role);
      if (dest) router.replace(dest as never);
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
      if (code !== "ERR_REQUEST_CANCELED") {
        onError("Unable to sign in with Apple. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  if (!available) return null;

  return (
    <View style={{ marginTop: 12 }}>
      {loading ? (
        <Pressable disabled style={styles.loadingButton}>
          <ActivityIndicator color={colors.ink} />
        </Pressable>
      ) : (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={radius.md}
          style={styles.appleButton}
          onPress={onPress}
        />
      )}
      <Text style={styles.note}>Continue with your Apple account</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  appleButton: { height: 52, width: "100%" },
  loadingButton: {
    alignItems: "center",
    justifyContent: "center",
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
  },
  note: {
    marginTop: 8,
    textAlign: "center",
    fontSize: 12,
    color: colors.inkMuted,
  },
});
