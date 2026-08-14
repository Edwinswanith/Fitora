import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Text } from "./AppText";
import { useAuth } from "../lib/auth";
import { dashboardPathForRole, type Role } from "../lib/roles";
import { colors } from "../lib/theme";

const clientId =
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ??
  "895210689446-ogejtfnpokvmh6kstejcj6oeag0cfl9o.apps.googleusercontent.com";
const GIS_SRC = "https://accounts.google.com/gsi/client";

type GoogleId = {
  accounts: {
    id: {
      initialize: (cfg: {
        client_id: string;
        callback: (resp: { credential?: string }) => void;
      }) => void;
      renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
    };
  };
};

declare global {
  interface Window {
    google?: GoogleId;
  }
}

function loadGis(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("no_window"));
      return;
    }
    if (window.google?.accounts?.id) {
      resolve();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("gis_load_failed")));
      return;
    }
    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("gis_load_failed"));
    document.head.appendChild(script);
  });
}

/**
 * Browser Google Sign-In via Google Identity Services. The native
 * @react-native-google-signin module does not implement web.
 */
export function GoogleSignInButton({
  requestedRole,
  onError,
}: {
  requestedRole: Role;
  onError: (msg: string | null) => void;
}) {
  const { signInWithGoogle } = useAuth();
  const router = useRouter();
  const containerRef = useRef<View>(null);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;

    async function handleCredential(credential: string) {
      const result = await signInWithGoogle(credential, requestedRole);
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
          onError("Google token was rejected. Add this origin in Google Cloud Console.");
        } else if (result.status === 0) {
          onError("Unable to reach the API server. Check your connection.");
        } else {
          onError(`Google sign-in failed (${result.error ?? "unknown"}).`);
        }
        return;
      }
      const dest = dashboardPathForRole(result.user.role);
      if (dest) router.replace(dest as never);
    }

    loadGis()
      .then(() => {
        if (cancelled || !window.google || !containerRef.current) return;
        const el = containerRef.current as unknown as HTMLElement | null;
        if (!el) return;
        el.innerHTML = "";
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (resp) => {
            if (resp.credential) void handleCredential(resp.credential);
          },
        });
        window.google.accounts.id.renderButton(el, {
          type: "standard",
          theme: "outline",
          size: "large",
          text: "signin_with",
          shape: "pill",
          logo_alignment: "center",
          width: Math.min(el.offsetWidth || 320, 400),
        });
      })
      .catch(() => onError("Couldn't load Google sign-in."));

    return () => {
      cancelled = true;
    };
  }, [requestedRole, router, signInWithGoogle, onError]);

  if (!clientId) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.dividerRow}>
        <View style={styles.line} />
        <Text style={styles.or}>OR</Text>
        <View style={styles.line} />
      </View>
      <View ref={containerRef} style={styles.buttonHost} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14, marginTop: 4, width: "100%" },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  line: { flex: 1, height: 1, backgroundColor: colors.line },
  or: { fontSize: 10, fontWeight: "700", letterSpacing: 2, color: colors.inkFaint },
  buttonHost: { width: "100%", minHeight: 44, alignItems: "center" },
});
