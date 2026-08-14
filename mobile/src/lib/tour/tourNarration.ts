import * as Speech from "expo-speech";
import { localizeAgentSpeech } from "../voiceTranslation";
import { getVoiceSpeechLanguage } from "../voiceLanguage";

let narrationRun = 0;

export async function stopTourNarration(): Promise<void> {
  narrationRun++;
  await Speech.stop().catch(() => undefined);
}

export async function speakTourStep(text: string): Promise<void> {
  const message = await localizeAgentSpeech(text.trim()).catch(() => text.trim());
  if (!message) return;

  const myRun = ++narrationRun;
  await Speech.stop().catch(() => undefined);

  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    Speech.speak(message, {
      language: getVoiceSpeechLanguage(),
      rate: 0.9,
      pitch: 1,
      onDone: done,
      onStopped: done,
      onError: done,
    });

    const timeoutMs = Math.max(6000, Math.min(25000, message.length * 75));
    setTimeout(() => {
      if (narrationRun === myRun) done();
    }, timeoutMs);
  });
}
