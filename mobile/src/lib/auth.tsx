import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  login as apiLogin,
  googleLogin as apiGoogleLogin,
  appleLogin as apiAppleLogin,
  registerAthlete as apiRegisterAthlete,
  loadStoredSession,
  validateSession,
  logout as apiLogout,
  deleteAccount as apiDeleteAccount,
  type StoredUser,
} from "./api";
import { registerPushToken, deregisterPushToken, subscribeToPushTokenUpdates } from "./push";
import type { Role } from "./roles";
import { loadVoiceLanguagePreference, setCachedVoiceLanguage } from "./voiceLanguage";
import { clearDataCache, hydrateDataCache } from "./fitoraData";

/** Who owns the on-device data cache; email covers older stored users without an id. */
function cacheOwnerFor(user: StoredUser): string {
  return user.id || user.email;
}

type Status = "loading" | "authed" | "anon";

type AuthValue = {
  status: Status;
  user: StoredUser | null;
  signIn: (email: string, password: string) => ReturnType<typeof apiLogin>;
  signInWithGoogle: (idToken: string, requestedRole: Role) => ReturnType<typeof apiGoogleLogin>;
  signInWithApple: (
    identityToken: string,
    requestedRole: Role,
    fullName?: string
  ) => ReturnType<typeof apiAppleLogin>;
  signUp: (fields: Parameters<typeof apiRegisterAthlete>[0]) => ReturnType<typeof apiRegisterAthlete>;
  signOut: () => Promise<void>;
  deleteAccount: () => ReturnType<typeof apiDeleteAccount>;
  setUser: (u: StoredUser) => void;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUserState] = useState<StoredUser | null>(null);

  useEffect(() => {
    let active = true;
    // Open instantly from what's saved on the device (local reads only), then
    // confirm with the server in the background. Only an explicit server
    // rejection signs the user out; being offline keeps the saved session.
    (async () => {
      const stored = await loadStoredSession();
      if (!active) return;
      if (!stored) {
        setStatus("anon");
        return;
      }
      await hydrateDataCache(cacheOwnerFor(stored));
      if (!active) return;
      setUserState(stored);
      setStatus("authed");
      registerPushToken();

      const check = await validateSession();
      if (!active) return;
      if (check.status === "valid") {
        setUserState(check.user);
      } else if (check.status === "invalid") {
        await clearDataCache();
        if (!active) return;
        setUserState(null);
        setStatus("anon");
      }
    })().catch(() => {
      if (active) setStatus("anon");
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (user?.voiceLanguage) {
      setCachedVoiceLanguage(user.voiceLanguage);
      void loadVoiceLanguagePreference(user.voiceLanguage);
    } else {
      void loadVoiceLanguagePreference();
    }
  }, [user?.voiceLanguage]);

  useEffect(() => {
    if (status !== "authed") return undefined;
    return subscribeToPushTokenUpdates();
  }, [status]);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await apiLogin(email, password);
    if (result.ok) {
      await hydrateDataCache(cacheOwnerFor(result.user));
      setUserState(result.user);
      setStatus("authed");
      registerPushToken();
    }
    return result;
  }, []);

  const signInWithGoogle = useCallback(async (idToken: string, requestedRole: Role) => {
    const result = await apiGoogleLogin(idToken, requestedRole);
    if (result.ok) {
      await hydrateDataCache(cacheOwnerFor(result.user));
      setUserState(result.user);
      setStatus("authed");
      registerPushToken();
    }
    return result;
  }, []);

  const signInWithApple = useCallback(async (identityToken: string, requestedRole: Role, fullName?: string) => {
    const result = await apiAppleLogin(identityToken, requestedRole, fullName);
    if (result.ok) {
      await hydrateDataCache(cacheOwnerFor(result.user));
      setUserState(result.user);
      setStatus("authed");
      registerPushToken();
    }
    return result;
  }, []);

  const signUp = useCallback(async (fields: Parameters<typeof apiRegisterAthlete>[0]) => {
    const result = await apiRegisterAthlete(fields);
    if (result.ok) {
      await hydrateDataCache(cacheOwnerFor(result.user));
      setUserState(result.user);
      setStatus("authed");
      registerPushToken();
    }
    return result;
  }, []);

  const signOut = useCallback(async () => {
    await deregisterPushToken();
    await apiLogout();
    await clearDataCache();
    setUserState(null);
    setStatus("anon");
  }, []);

  const deleteAccount = useCallback(async () => {
    const result = await apiDeleteAccount();
    if (result.ok) {
      await clearDataCache();
      setUserState(null);
      setStatus("anon");
    }
    return result;
  }, []);

  const setUser = useCallback((u: StoredUser) => setUserState(u), []);

  const value = useMemo(
    () => ({ status, user, signIn, signInWithGoogle, signInWithApple, signUp, signOut, deleteAccount, setUser }),
    [status, user, signIn, signInWithGoogle, signInWithApple, signUp, signOut, deleteAccount, setUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
