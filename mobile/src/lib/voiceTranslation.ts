import { apiFetch } from "./api";
import { getVoiceLanguage, isEnglishVoiceLanguage } from "./voiceLanguage";

type TranslateResponse = { text?: string };

function looksLikeTanglishCommand(text: string): boolean {
  return /\b(naan|nan|nalla|illa|irukku|pannu|pannunga|pannen|panren|thoongi|thoonginen|thoongitu|thookam|tookam|urakkam|neram|mani|sapten|kudich|kudichen|thanni|vellam|vali|sorvu|azhutham|romba)\b/i.test(
    text
  );
}

export async function normalizeVoiceCommandForAgent(text: string): Promise<string> {
  const command = text.trim();
  const sourceLanguage = isEnglishVoiceLanguage() && looksLikeTanglishCommand(command) ? "ta-Latn-IN" : getVoiceLanguage();
  if (!command || sourceLanguage === "en-US") return command;
  const res = await apiFetch("/api/voice/translate", {
    method: "POST",
    body: JSON.stringify({
      text: command,
      targetLanguage: "en-US",
      mode: "command",
      sourceLanguage,
    }),
  });
  const payload = (await res.json().catch(() => ({}))) as TranslateResponse;
  return res.ok && payload.text?.trim() ? payload.text.trim() : command;
}

export async function localizeAgentSpeech(text: string): Promise<string> {
  const message = text.trim();
  if (!message || isEnglishVoiceLanguage()) return message;
  const res = await apiFetch("/api/voice/translate", {
    method: "POST",
    body: JSON.stringify({
      text: message,
      targetLanguage: getVoiceLanguage(),
      mode: "reply",
      sourceLanguage: "en-US",
    }),
  });
  const payload = (await res.json().catch(() => ({}))) as TranslateResponse;
  return res.ok && payload.text?.trim() ? payload.text.trim() : message;
}
