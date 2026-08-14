import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export type VoiceLanguage = {
  code: string;
  deepgramHint: string;
  recognitionCode?: string;
  label: string;
  nativeLabel: string;
};

export const DEFAULT_VOICE_LANGUAGE = "en-US";

export const VOICE_LANGUAGES: VoiceLanguage[] = [
  { code: "en-US", deepgramHint: "en", label: "English", nativeLabel: "English" },
  { code: "hi-IN", deepgramHint: "hi", label: "Hindi", nativeLabel: "\u0939\u093f\u0928\u094d\u0926\u0940" },
  { code: "ta-IN", deepgramHint: "ta", label: "Tamil", nativeLabel: "\u0ba4\u0bae\u0bbf\u0bb4\u0bcd" },
  { code: "ta-Latn-IN", deepgramHint: "ta", recognitionCode: "ta-IN", label: "Tamil / Tanglish", nativeLabel: "Tamil + Tanglish" },
  { code: "te-IN", deepgramHint: "te", label: "Telugu", nativeLabel: "\u0c24\u0c46\u0c32\u0c41\u0c17\u0c41" },
  { code: "kn-IN", deepgramHint: "kn", label: "Kannada", nativeLabel: "\u0c95\u0ca8\u0ccd\u0ca8\u0ca1" },
  { code: "ml-IN", deepgramHint: "ml", label: "Malayalam", nativeLabel: "\u0d2e\u0d32\u0d2f\u0d3e\u0d33\u0d02" },
];

const KEY = "scp.voice.language";
let cachedLanguage = DEFAULT_VOICE_LANGUAGE;

function validLanguage(code: string | undefined | null): string {
  return VOICE_LANGUAGES.some((language) => language.code === code) ? (code as string) : DEFAULT_VOICE_LANGUAGE;
}

async function getStoredItem(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    return (globalThis as { localStorage?: { getItem(key: string): string | null } }).localStorage?.getItem(key) ?? null;
  }
  return SecureStore.getItemAsync(key);
}

async function setStoredItem(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    (globalThis as { localStorage?: { setItem(key: string, value: string): void } }).localStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export function getVoiceLanguage(): string {
  return cachedLanguage;
}

export function getVoiceLanguageInfo(code = cachedLanguage): VoiceLanguage {
  return VOICE_LANGUAGES.find((language) => language.code === code) ?? VOICE_LANGUAGES[0];
}

export function getDeepgramLanguageHint(code = cachedLanguage): string {
  return getVoiceLanguageInfo(code).deepgramHint;
}

export function getVoiceRecognitionLanguage(code = cachedLanguage): string {
  const language = getVoiceLanguageInfo(code);
  return language.recognitionCode ?? language.code;
}

export function getVoiceSpeechLanguage(code = cachedLanguage): string {
  const language = getVoiceLanguageInfo(code);
  return language.recognitionCode ?? language.code;
}

export function isEnglishVoiceLanguage(code = cachedLanguage): boolean {
  return getVoiceLanguageInfo(code).deepgramHint === "en";
}

export function setCachedVoiceLanguage(code: string | undefined | null): string {
  cachedLanguage = validLanguage(code);
  return cachedLanguage;
}

export async function loadVoiceLanguagePreference(fallback?: string | null): Promise<string> {
  const stored = await getStoredItem(KEY).catch(() => null);
  cachedLanguage = validLanguage(fallback ?? stored);
  return cachedLanguage;
}

export async function setVoiceLanguagePreference(code: string): Promise<string> {
  cachedLanguage = validLanguage(code);
  await setStoredItem(KEY, cachedLanguage).catch(() => undefined);
  return cachedLanguage;
}
