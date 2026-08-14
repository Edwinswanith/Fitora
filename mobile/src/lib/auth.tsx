import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  login as apiLogin,
  googleLogin as apiGoogleLogin,
  appleLogin as apiAppleLogin,
  registerAthlete as apiRegisterAthlete,
  loadSession,
  logout as apiLogout,
  deleteAccount as apiDeleteAccount,
  type StoredUser,
} from "./api";
import { registerPushToken, deregisterPushToken, subscribeToPushTokenUpdates } from "./push";
import type { Role } from "./roles";
import { loadVoiceLanguagePreference, setCachedVoiceLanguage } from "./voiceLanguage";

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
    loadSession()
      .then((u) => {
        if (!active) return;
        setUserState(u);
        setStatus(u ? "authed" : "anon");
        if (u) registerPushToken();
      })
      .catch(() => active && setStatus("anon"));
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
      setUserState(result.user);
      setStatus("authed");
      registerPushToken();
    }
    return result;
  }, []);

  const signInWithGoogle = useCallback(async (idToken: string, requestedRole: Role) => {
    const result = await apiGoogleLogin(idToken, requestedRole);
    if (result.ok) {
      setUserState(result.user);
      setStatus("authed");
      registerPushToken();
    }
    return result;
  }, []);

  const signInWithApple = useCallback(async (identityToken: string, requestedRole: Role, fullName?: string) => {
    const result = await apiAppleLogin(identityToken, requestedRole, fullName);
    if (result.ok) {
      setUserState(result.user);
      setStatus("authed");
      registerPushToken();
    }
    return result;
  }, []);

  const signUp = useCallback(async (fields: Parameters<typeof apiRegisterAthlete>[0]) => {
    const result = await apiRegisterAthlete(fields);
    if (result.ok) {
      setUserState(result.user);
      setStatus("authed");
      registerPushToken();
    }
    return result;
  }, []);

  const signOut = useCallback(async () => {
    await deregisterPushToken();
    await apiLogout();
    setUserState(null);
    setStatus("anon");
  }, []);

  const deleteAccount = useCallback(async () => {
    const result = await apiDeleteAccount();
    if (result.ok) {
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
