import { Router } from "express";
import type { Response } from "express";
import multer from "multer";
import { env } from "../config/env";
import { requireAuth } from "../middleware/auth";
import { writeRateLimit } from "../middleware/rateLimit";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
});

type DeepgramTranscriptResponse = {
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        transcript?: string;
      }>;
    }>;
  };
};

const LANGUAGE_NAMES: Record<string, string> = {
  "en-US": "English",
  en: "English",
  "hi-IN": "Hindi",
  hi: "Hindi",
  "ta-IN": "Tamil",
  ta: "Tamil",
  "ta-Latn-IN": "Tamil / Tanglish",
  tanglish: "Tamil / Tanglish",
  "te-IN": "Telugu",
  te: "Telugu",
  "kn-IN": "Kannada",
  kn: "Kannada",
  "ml-IN": "Malayalam",
  ml: "Malayalam",
};

function languageFromRequest(value: unknown): string {
  const raw = typeof value === "string" ? value : "";
  return LANGUAGE_NAMES[raw] ? raw : "en";
}

function deepgramHeaders(contentType: string): Record<string, string> {
  return {
    Authorization: `Token ${env.deepgram.apiKey}`,
    "Content-Type": contentType,
  };
}

function requireDeepgram(): boolean {
  return Boolean(env.deepgram.apiKey);
}

function prerecordedSttModel(): string {
  // Flux is a turn-based WebSocket model. The recorder fallback posts a complete
  // audio file to /v1/listen, so keep that path on Nova while streaming can use Flux.
  return env.deepgram.sttModel.startsWith("flux-") ? "nova-3" : env.deepgram.sttModel;
}

router.use(requireAuth);
router.use(writeRateLimit({ windowMs: 60_000, max: 30 }));

router.post("/transcribe", upload.single("audio"), async (req, res) => {
  if (!requireDeepgram()) {
    res.status(503).json({ error: "deepgram_not_configured", message: "Voice transcription is not configured." });
    return;
  }
  if (!req.file?.buffer?.length || req.file.size < 1_500) {
    res.status(422).json({ error: "empty_audio", message: "I could not hear a command in that recording." });
    return;
  }

  const contentType = req.file.mimetype || "audio/mp4";
  const language = languageFromRequest(req.query.language);
  const model = prerecordedSttModel();
  const params = new URLSearchParams({
    model,
    smart_format: "true",
  });
  if (model.startsWith("flux-")) params.set("language_hint", language);
  else params.set("language", language);
  const response = await fetch(
    `https://api.deepgram.com/v1/listen?${params.toString()}`,
    {
      method: "POST",
      headers: deepgramHeaders(contentType),
      body: new Uint8Array(req.file.buffer),
      signal: AbortSignal.timeout(20_000),
    }
  );

  if (!response.ok) {
    const status = response.status === 400 || response.status === 408 || response.status === 422 ? 422 : 502;
    res.status(status).json({ error: "transcription_unavailable", message: "I could not hear that command." });
    return;
  }

  const payload = (await response.json()) as DeepgramTranscriptResponse;
  const transcript = payload.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "";
  if (!transcript) {
    res.status(422).json({ error: "empty_transcript", message: "I could not hear a command in that recording." });
    return;
  }

  res.json({ transcript });
});

router.post("/translate", async (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text.trim().slice(0, 2000) : "";
  const targetLanguage = languageFromRequest(req.body?.targetLanguage);
  const sourceLanguage = languageFromRequest(req.body?.sourceLanguage);
  const mode = req.body?.mode === "command" ? "command" : "reply";
  if (!text) {
    res.status(400).json({ error: "empty_text" });
    return;
  }
  if (targetLanguage === sourceLanguage || !env.gemini.apiKey) {
    res.json({ text });
    return;
  }

  const targetName = LANGUAGE_NAMES[targetLanguage] ?? "English";
  const sourceName = LANGUAGE_NAMES[sourceLanguage] ?? "the source language";
  const commandInstruction =
    sourceLanguage === "ta-Latn-IN" || sourceLanguage === "tanglish"
      ? "Translate this sports coaching app voice command to simple English. The input may be Tamil script, Roman Tamil/Tanglish, or mixed Tamil-English. Preserve names, dates, numbers, AM/PM session words, and metrics. Map 'sleep score', 'sleep quality', 'thookam score', and similar Tamil/Tanglish phrases to sleep quality, not sleep hours. Only treat a sleep value as hours when the user says hours, hrs, mani, or neram. Return only the translated command."
      : `Translate this sports coaching app voice command from ${sourceName} to English. Preserve names, dates, numbers, AM/PM session words, metrics, and intent. Map sleep score or sleep quality to sleep quality, not sleep hours. Return only the translated command.`;
  const instruction =
    mode === "command"
      ? commandInstruction
      : `Translate this short sports coaching app assistant reply from ${sourceName} to ${targetName}. Preserve numbers, dates, names, and metric labels. Return only the translated reply.`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      env.gemini.model
    )}:generateContent?key=${encodeURIComponent(env.gemini.apiKey)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: instruction }] },
        contents: [{ parts: [{ text }] }],
        generationConfig: { temperature: 0 },
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      res.json({ text });
      return;
    }
    const payload = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const translated = payload.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    res.json({ text: translated || text });
  } catch {
    res.json({ text });
  }
});

async function speak(text: string, res: Response) {
  if (!requireDeepgram()) {
    res.status(503).json({ error: "deepgram_not_configured", message: "Voice output is not configured." });
    return;
  }
  const message = text.trim().slice(0, 2000);
  if (!message) {
    res.status(400).json({ error: "empty_text" });
    return;
  }

  const response = await fetch(
    `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(env.deepgram.ttsModel)}`,
    {
      method: "POST",
      headers: deepgramHeaders("application/json"),
      body: JSON.stringify({ text: message }),
      signal: AbortSignal.timeout(20_000),
    }
  );

  if (!response.ok) {
    res.status(502).json({ error: "speech_unavailable" });
    return;
  }

  const audio = Buffer.from(await response.arrayBuffer());
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", response.headers.get("content-type") ?? "audio/mpeg");
  res.send(audio);
}

router.get("/speak", async (req, res) => {
  await speak(typeof req.query.text === "string" ? req.query.text : "", res);
});

router.post("/speak", async (req, res) => {
  await speak(typeof req.body?.text === "string" ? req.body.text : "", res);
});

export default router;
