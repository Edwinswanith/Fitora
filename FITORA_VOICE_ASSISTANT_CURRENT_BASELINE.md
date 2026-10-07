# Fitora Voice Assistant — Current Baseline

Audit-only capture of the athlete Ask Agent / voice assistant exactly as it exists today. **No prompts, code, confirmation policy, UI, or backend behavior were changed to produce this document.** Source is the primary evidence: every claim below is backed by a file:line citation from direct reading of the repository, cross-checked live against the running server (`POST /api/athlete/voice/interpret-v2` and related endpoints, real Gemini, real MongoDB) and, where practical, the native Android emulator.

---

## 1. Executive Summary

Fitora has **two** voice-intent pipelines in the codebase, but only one is reachable today. **V1** (`services/voiceIntentInterpreter.ts` + `routes/athlete.ts`'s `/voice/interpret`) is explicitly marked `DEPRECATED` in its own code comment and is **not called anywhere in the current mobile client** — confirmed by an exhaustive grep of `mobile/src`. **V2** (`services/voiceIntentInterpreterV2.ts` + `services/voiceIntentPolicy.ts` + `routes/athleteVoiceV2.ts` + the mobile `lib/voiceAssistant/` module) is the live system. The much-referenced `EXPO_PUBLIC_VOICE_ASSISTANT_V2` feature flag described in several code comments **does not exist** — `RoleAskAgentOverlays.tsx` renders the V2 overlay unconditionally. V1 is dead-but-deployed code kept only as a safety net for stale app installs.

The V2 architecture is well-factored: the LLM (Gemini) only classifies intent and extracts entities; a separate, fully deterministic, unit-tested policy module (`voiceIntentPolicy.ts`) owns every decision about missing fields, confirmation, and next action. Real answer text is always fetched from real Fitora data client-side, never stated by the model. Idempotency, a 15-minute server-persisted pending-state machine, and a real audit-receipt ledger all exist and work as documented.

The most important, evidence-based finding this audit surfaced: **almost no write actions require explicit confirmation.** Of 13 write intents, only `send_coach_note` asks "should I save this?" — every other write (including logging wellness, RPE, sessions, meals, water, profile changes) auto-executes the instant its required fields are present, by deliberate design (a code comment cites this as a direct response to prior user friction feedback). Combined with this, live testing found **one concrete functional bug** (a bare "Log 8" auto-executes and then fails server-side with `invalid_trainingCategory` — see Part 20) and **one safety-relevant gap** (chest pain / breathing-difficulty phrases receive no differentiated handling at all — see Part 32). Neither was fixed, per this audit's scope.

Real Deepgram STT/TTS credentials are **not configured** in this environment (`server/.env`'s `DEEP_GRAM` is commented out), so end-to-end spoken-audio testing could not be performed here. However, the system has a genuine on-device speech-recognition primary path that does not require Deepgram at all, confirmed actually listening live on the emulator, and a text-input fallback that exercises the identical downstream pipeline — both were used for live verification in place of real audio.

---

## 2. Current Voice Architecture

```
Athlete
 ↓ (tap FAB, or 3s long-press for text fallback)
AskAgentControl.tsx (FAB, mic button, text-input overlay — owns ALL mic/STT/TTS lifecycle)
 ↓
Mic permission (expo-audio's AudioModule.requestRecordingPermissionsAsync, requested lazily
  on first use, NOT on app load) — denied/unavailable → onNeedsFallback() → text input opens, silently
 ↓
Audio capture — one of 4 client paths chosen in priority order:
  1. Web: browser Web Speech API (no audio to Fitora servers)
  2. Native on-device recognition (expo-speech-recognition) — no audio to Fitora servers either
  3. Deepgram streaming (WebSocket → server proxy → wss://api.deepgram.com)
  4. Deepgram batch/record-then-upload (POST /api/voice/transcribe, fallback of the fallback)
 ↓
Transcript (text only — confirmed no audio is ever persisted anywhere in this app)
 ↓
POST /api/athlete/voice/interpret-v2  { transcript, currentScreen }
   → Gemini classification (intent + entities + confidence, structured JSON output, temperature 0)
   → voiceIntentPolicy.ts's derivePolicy() — pure deterministic code, no model call:
       - sanitizes/range-checks every entity
       - decides missing fields
       - decides action: collect_fields | ready_to_confirm | execute | navigate | answer | reject
       - decides requiresConfirmation (true for exactly one intent: send_coach_note)
   → persists/clears server-side VoicePendingState (MongoDB, 15-min TTL, one per athlete)
 ↓
 ├── collect_fields → client asks the follow-up question, loops back to interpret-v2
 ├── navigate → client router.replace()s to the target tab (client-side only, no server write)
 ├── answer → client fetches the REAL record from the real Fitora API (e.g. /api/athlete/daily) and
 │            formats it with a pure template function — server never states a number itself
 ├── ready_to_confirm → ConfirmationCard shown (send_coach_note only in practice); Confirm/Cancel
 │            are literally re-submitted as the transcripts "yes"/"no" through the SAME interpret-v2 call
 └── execute → client calls buildVoiceAction()'s mapped REST endpoint directly (12 of 13 writes reuse
              an already-existing, already-secured Fitora endpoint; log_session/log_rpe/log_meal use
              purpose-built /api/athlete/voice/* endpoints that still write through the same core models)
 ↓
Response text (spoken via agentSpeech.ts: Deepgram TTS for native+English, expo-speech OS TTS
  otherwise or on Deepgram failure) + shown via a banner/ConfirmationCard
```

Every arrow's sync/async, endpoint, and failure behavior is detailed in the relevant section below (Parts 5–7, 9–14, 20–26).

---

## 3. Active vs Legacy Voice Systems

| Layer | File | Responsibility | Active? |
|---|---|---|---|
| V1 route | `server/src/routes/athlete.ts:97-131` | `POST /api/athlete/voice/interpret` — classify-only, V1 shape | **LEGACY** — explicitly commented `DEPRECATED` (`athlete.ts:80-89`); zero calls from mobile client (verified by grep) |
| V1 interpreter | `server/src/services/voiceIntentInterpreter.ts` (770 lines) | Gemini-or-mock classification **plus** its own confirmation/missing-field logic baked in (no separate policy layer) | **LEGACY**, reachable only via the dead V1 route |
| V2 route | `server/src/routes/athleteVoiceV2.ts` | `/interpret-v2`, `/today-checklist`, `/log-session`, `/log-meal` | **ACTIVE** — sole caller of the mobile client |
| V2 interpreter | `server/src/services/voiceIntentInterpreterV2.ts` (629 lines) | Classification + entity extraction ONLY, real Gemini (key is configured in this env) or a deterministic mock | **ACTIVE** |
| V2 policy | `server/src/services/voiceIntentPolicy.ts` (618 lines) | All missing-field/confirmation/action logic — pure, no I/O | **ACTIVE**, the sole authority |
| STT/TTS/translate | `server/src/routes/voice.ts`, `voiceStream.ts` | `/api/voice/transcribe`, `/speak`, `/translate`, `/stream` (WS) | **ACTIVE**, shared infrastructure — version-agnostic, has no notion of V1/V2 |
| Mobile V2 client | `mobile/src/lib/voiceAssistant/*.ts` (8 files) | State machine, action mapping, answer fetching/formatting | **ACTIVE** |
| Mobile V1 client | — | *(none exists — no mobile file ever calls the V1 endpoint)* | **UNUSED / never built** |
| Mic/STT/TTS client | `mobile/src/lib/voiceSession.ts`, `agentSpeech.ts`, `voiceLanguage.ts`, `voiceTranslation.ts` | Owns the 4-path capture strategy, TTS playback+fallback, language hints | **ACTIVE** |
| FAB/UI shell | `mobile/src/components/AskAgentControl.tsx` | Mic button, listening/speaking indicators, text-input overlay | **ACTIVE**, shared by both athlete and coach Ask Agent surfaces (coach uses a different command classifier, out of scope here) |
| V2 overlay | `mobile/src/components/voiceAssistant/AthleteAskAgentOverlayV2.tsx`, `ConfirmationCard.tsx` | Wires `AskAgentControl` to the V2 state machine | **ACTIVE** |
| `EXPO_PUBLIC_VOICE_ASSISTANT_V2` | *(does not exist)* | Referenced only in 3 stale code comments; no `.env` entry, no `process.env` read anywhere | **CANNOT VERIFY as real — confirmed non-existent** |

**Proof of which path is live**: `mobile/src/components/RoleAskAgentOverlays.tsx:741-743` renders `<AthleteAskAgentOverlayV2 />` unconditionally, with no branch. `useVoiceAssistant.ts:43` calls `/api/athlete/voice/interpret-v2` exclusively. A repo-wide grep for the literal string `/api/athlete/voice/interpret` (without `-v2`) inside `mobile/src` returns zero matches.

---

## 4. UI / Overlay

- **FAB placement**: bottom-right, fixed position (`right: 16, bottom: 84`, a 56dp circle — same coordinates documented in the earlier UI-baseline audit this session). Present on every athlete screen (it's mounted at the app root in `_layout.tsx`'s `Gate()`, not per-screen) — confirmed rendering on Today, Nutrition, Progress, and other tabs during this session's testing.
- **Labeled state**: shows an "Ask Agent" text pill next to the icon only on the Today tab (`labeled={currentScreen === "today"}`, `AthleteAskAgentOverlayV2.tsx:150`); a plain icon-only circle elsewhere — both confirmed live.
- **Open mechanism**: single tap starts the voice conversation directly (no separate "open" step — tapping the FAB immediately requests mic permission and starts listening). A **3-second long-press** opens the text-input fallback directly, bypassing voice entirely (`AskAgentControl.tsx:120-133`, confirmed live via `adb input swipe` with matching start/end coordinates and a 3200ms duration).
- **Container type**: not a modal or bottom sheet — an always-present absolutely-positioned overlay (`position: "absolute"`) stacked above the current screen's own content; the current screen remains fully visible and interactive underneath.
- **Background dimming**: none — no scrim/backdrop behind the FAB, confirmation card, or banners; the underlying screen is never dimmed or blocked.
- **Close behavior**: success/answer/error banners auto-dismiss via a timer — 4 seconds for a save confirmation, 7 seconds for a longer answer (`AthleteAskAgentOverlayV2.tsx:140-146`). No manual close (×) button on these banners. The `ConfirmationCard` has an explicit Cancel button.
- **Keyboard interaction**: the text-input fallback is a normal `TextInput`; the on-screen keyboard's own toolbar (autofill/emoji/mic icons) visually overlaps the app's own UI at the bottom-left in this environment — a real, observed layout collision (see Part 41 note on the Android IME toolbar).
- **Microphone interaction**: tap-to-talk, not push-to-talk — once started, listening continues (with a 5-minute overall silence timeout) until the FAB is tapped again, or a full turn completes and the conversation loop restarts listening automatically ~300ms after the spoken reply finishes.

### Native states captured this pass
Confirmed live on-device (see `qa-artifacts/voice-baseline/SCREENSHOT_INDEX.md` for the full state→screenshot map): **closed/FAB** (labeled and unlabeled), the **real native mic-permission dialog**, a genuinely **active listening state** (green pill + a second "execute" action FAB, both real, both driven by actual on-device speech recognition — not a mock), **manual-stop-with-silence returning cleanly to idle**, **text-input fallback** opened both via permission denial and via long-press, and a real **network/API-failure error banner** ("Sorry, I couldn't reach the server. Please try again.") triggered live, plus its accompanying "Working" processing-state pill.

States not captured on-screen (documented instead via direct, real API calls against the live server — see Part 39) and explicitly marked `NOT CAPTURED` in the screenshot index: a full spoken/typed transcript reaching a real answer or confirmation card on-screen (an ADB tooling limitation truncated typed input at the first space — not a product bug), the success banner, the missing-field follow-up card, and STT-specific failure as distinct from general network failure. Real spoken-audio input could not be exercised at all in this sandboxed environment.

---

## 5. Microphone & Audio Capture

- **Library**: `expo-audio`'s `AudioModule` for permission/recording; `expo-speech-recognition` for on-device STT; Deepgram for cloud STT when the other two aren't used.
- **Permission timing**: requested lazily, only when a Deepgram path is actually reached (`voiceSession.ts:484, 609`) — never on app load. The on-device/web paths trigger their own native/browser prompts internally. Confirmed live: the real Android "Allow Fitora to record audio?" system dialog appears on first FAB tap each session.
- **Denied behavior**: silently swaps to the text-input overlay (`onNeedsFallback()` → `setInputOpen(true)`, `AskAgentControl.tsx:112-115`) — **no error message, toast, or explanation is ever shown to the user** for a permission denial. Confirmed live.
- **Capture strategy** (priority order, `voiceSession.ts:50-54`): (1) Web Speech API on web, (2) on-device `expo-speech-recognition` if available — confirmed genuinely available and actively listening on this Android emulator, (3) Deepgram streaming WebSocket (16kHz mono PCM, `sampleRate: 16000, channels: 1, encoding: "int16"`), (4) Deepgram batch record-then-upload (`RecordingPresets.HIGH_QUALITY`, uploaded whole as multipart form data on stop).
- **Recording limits**: streaming path has a 30s idle timer and a 30s hard max (server-side, `voiceStream.ts:139-191`); the batch path has a fixed 60s auto-stop timer with a fake "pulse" animation rather than real level metering. The overall conversation has its own 5-minute (300000ms) silence deadline, reset by real mic-level activity.
- **Manual stop**: tapping the FAB again always works, regardless of which capture path is active.
- **App backgrounding**: **no `AppState` listener exists anywhere** in the voice code (confirmed by grep) — backgrounding mid-recording is entirely unhandled/undocumented, left to OS/library defaults.

---

## 6. STT

| Property | Current implementation |
|---|---|
| Provider | Deepgram (cloud) + `expo-speech-recognition` (on-device, primary when available) |
| Model | `nova-3` (default; `DEEPGRAM_STT_MODEL`/`DEEPGRAM_MODEL` env-overridable) |
| Streaming | Yes — WebSocket proxy at `/api/voice/stream` to `wss://api.deepgram.com/v1/listen` (or `/v2/listen` for Flux-family models); batch/prerecorded fallback posts to `/v1/listen` REST, forcing Flux models down to `nova-3` for that path specifically |
| Language | Query-param hint, whitelisted `en/hi/ta/te/kn/ml`; Tamil/"Tanglish" both hint Deepgram as `"ta"` |
| Endpointing | `endpointing=400ms`, `utterance_end_ms=1000ms` (both env-overridable) for non-Flux streaming |
| Interim transcripts | Supported and relayed by the server, but the client only acts on `final`/`utterance_end` events — interim results only drive a live volume/glow animation, never the shown transcript |
| Timeout | REST transcribe/TTS calls: 20s hard `AbortSignal.timeout`; streaming: the 30s idle/max timers above |
| Retry | **None** — no automatic retry against Deepgram anywhere |
| Fallback | Streaming failure before it ever started → silently swaps to the batch recorder; failure mid-session → silent listening-loop restart (`recoverListeningWindow`), no user-visible error; a systemic failure (Deepgram unconfigured, 502, or network-down) → silently opens the text-input fallback |
| **This environment** | **Deepgram is unconfigured** (`server/.env:31`, `DEEP_GRAM` commented out) — any real cloud STT attempt here would immediately hit the "not configured" fallback path; only the on-device recognition path was actually exercisable live |

---

## 7. TTS

| Property | Current implementation |
|---|---|
| Provider | Deepgram TTS, default voice `aura-2-thalia-en` (`DEEPGRAM_TTS_MODEL` env-overridable) |
| When synthesized | After the **complete** response text is known — no sentence-by-sentence/streamed synthesis |
| Streaming | No — one request per full reply (`GET/POST /api/voice/speak?text=<entire message>`) |
| Audio format | Whatever content-type Deepgram returns (server defaults `audio/mpeg`) |
| Interruption | A new reply always cuts off any prior one (`stopAgentSpeech()` runs at the start of every `speakAgentReply()` call); the FAB's own stop button also stops playback. **No barge-in** — new mic input does not interrupt TTS mid-sentence; listening only resumes after the spoken reply's promise settles |
| OS-native fallback | Yes, real — `expo-speech`'s `Speech.speak()` on any Deepgram TTS failure/timeout (backstop timeout: `max(5000, min(30000, text.length * 85))`ms) |
| Non-English/web | Deepgram TTS is skipped entirely for web or any non-English selected language — `expo-speech` is used directly in those cases |
| Muted mode | **None found** — no mute toggle or muted-mode code anywhere in the TTS/voice-session/FAB files (grepped for "mute"/"silent") |
| **This environment** | Deepgram TTS unreachable (same unconfigured-key reason as STT) — any real reply speech here would fall back to on-device `expo-speech` |

---

## 8. Language Support

A real language selector exists (`voiceLanguage.ts`) — 7 languages: English, Hindi, Tamil, "Tamil/Tanglish" (Roman-script Tamil), Telugu, Kannada, Malayalam, persisted in secure storage. It correctly threads a Deepgram language hint (`"ta"` for both Tamil variants) into every STT call, and correctly selects the on-device recognition locale.

**Important nuance, confirmed by code reading**: beyond this hint-passing, the STT/TTS layer itself does **no** language-specific tuning (no custom vocabulary/model choice). Actual Tamil/Tanglish command *understanding* is a **separate, post-processing Gemini call** (`voiceTranslation.ts` detects Tanglish via a transliterated-word regex, then `POST /api/voice/translate` asks Gemini to translate the command to English before it ever reaches the intent interpreter). So multilingual support is real but is layered on top of an English-first pipeline, not native to it. Non-English/web replies are always spoken via OS-native `expo-speech`, never Deepgram TTS.

The Gemini intent-classification system prompt (Part 18) separately claims to understand mixed Tamil-English input directly (e.g. "naan 7 mani neram thoonginen sleep score 6"), which is a genuine, different capability from the translation-hop path — both exist in the code simultaneously, and this audit did not test which one actually fires first for a given Tanglish utterance (out of scope without real audio input).

---

## 9. Intent Catalogue

27 intents total (`voiceIntentPolicy.ts:18-47`), extracted directly from the current `VOICE_INTENTS_V2` constant — not assumed from any external list.

| Intent | Example utterance (tested live where marked ✓) | Type | Required fields | Confirmation? | Executes via |
|---|---|---|---|---|---|
| `start_check_in` | "let's check in" | Nav→collect | — | No | Redirects into `log_wellness` collection |
| `log_wellness` | "I am tired" ✓ | Write | any one of sleepHours/Quality/mood/stress/soreness/fatigue | No | `POST /api/athlete/wellness` |
| `log_session` | "4 sets of sprints this morning, RPE 8 effort 9" | Write | sessionType, status (+trainingCategory & plannedIntensityPercent if rpe given) | No | `POST /api/athlete/voice/log-session` |
| `log_rpe` | "Log 8" ✓ (found buggy — see Part 20) | Write | rpe only | No | Same `/log-session` endpoint, sessionType defaults AM/status defaults completed |
| `add_water` | "Add 250 ml of water" ✓ | Write | amountMl | No | `POST /api/athlete/water` |
| `log_meal` | "log lunch chicken rice bowl 650 calories" | Write | mealType, foodName/mealName, calories | No | `POST /api/athlete/voice/log-meal` |
| `show_hydration` | "How much water have I had?" ✓ | Read | — | N/A | `GET /api/athlete/water` |
| `show_nutrition` | "calories left today" | Read | — | N/A | `GET /api/athlete/nutrition/target` + `/meals` |
| `set_water_goal` | "Set my water goal to 3 litres" ✓ | Write | goalMl | No | `PATCH /api/athlete/me` |
| `change_hydration_reminder` | "turn off water reminders" | Write | enabled or intervalMinutes | No | `PATCH /api/notification-preferences` |
| `log_recovery` | "I did stretching and ice bath" | Write | modalities or skipped | No | `POST /api/athlete/recovery` |
| `mark_rest_day` | "mark today a rest day" | Write | — (defaults enabled=true) | No | `POST /api/athlete/rest-day` |
| `log_heart_rate` | "waking heart rate 52" | Write | wakeHr or bedHr | No | `POST /api/athlete/heart-rate` |
| `update_profile` | "I weigh 72 kilos" | Write | heightCm/weightKg/position (any one) | No | `PATCH /api/athlete/me` |
| `send_coach_note` | "Tell my coach great session today" ✓ | Write | body | **Yes — the only confirmed write** | `POST /api/athlete/messages/:coachId` |
| `add_note` | "Add a note that I feel good today" ✓ | Write | body | No | `POST /api/athlete/notes` |
| `show_readiness` | "What's my readiness today?" ✓ | Read | — | N/A | `GET /api/athlete/daily` |
| `show_today_plan` | "What is my workout today?" ✓ | Read | — | N/A | `GET /api/athlete/daily` |
| `show_upcoming_session` | "when is my next session?" | Read | — | N/A | `GET /api/athlete/sessions` |
| `show_progress` | "Show my progress" ✓ | Read | — | N/A | `GET /api/athlete/trends?days=7` |
| `show_coach_feedback` | "What did my coach say?" ✓ | Read | — | N/A | `GET /api/athlete/coach-comments` |
| `show_daily_checklist` | "what am I missing today?" | Read | — | N/A | `GET /api/athlete/voice/today-checklist` |
| `open_screen` | "Open nutrition" ✓ | Nav | screen | No | Client-side router only |
| `explain_app_field` | "what is RPE?" | Read | term | N/A | Canned definition, no fetch |
| `update_field` | (meta — "actually make it 500") | Meta | — | inherits pending | Merges into the pending workflow |
| `confirm_action` | "yes" ✓ | Meta | — | — | Resolves the pending workflow |
| `cancel_action` | "no, cancel" ✓ | Meta | — | — | Discards the pending workflow |
| `unknown_intent` | "I feel dizzy and I cannot breathe" ✓ | Reject | — | — | "I didn't catch that. Could you say it again?" |

---

## 10. Navigation Intents

| Voice request | Parsed intent | Destination (`OPEN_SCREEN_ALLOWLIST`) | Verified route |
|---|---|---|---|
| "Open nutrition" ✓ | `open_screen` | `nutrition` | `/athlete/dashboard?section=nutrition` |
| "Go to training" ✓ | `open_screen` | `workouts` | `/athlete/dashboard?section=workouts` |
| "Open my coach" ✓ | `open_screen` | `coach` | `/athlete/dashboard?section=coach` |
| "Show progress"/"trends"/"goals" | `open_screen` | `progress` | `/athlete/dashboard?section=progress` |
| "Open notifications" | `open_screen` | `notifications` | `/notifications` (the one target outside the dashboard tabs) |
| "log"/"water"/"messages"/"today" | `open_screen` | (respective) | all resolve to a real, live route — no dead destination found |

All 11 allowlisted screen values map to routes that genuinely exist (cross-checked against this session's earlier UI-baseline audit of the real route table) — no stale destination was found.

---

## 11. Read-Only Questions

All 8 `show_*` intents are answered by the **client**, never the server — the server's own `spokenResponse` for every read intent is a fixed, deliberately-empty placeholder ("Here's what you asked for.", confirmed live for `show_readiness`/`show_today_plan`/`show_hydration`/`show_coach_feedback`/`show_progress`). The client then fetches the real record and formats it with a pure template function (`answerFormatting.ts`) — e.g. `formatReadinessAnswer` says "Your readiness today is 45 out of 100." only once it has actually fetched that number from `/api/athlete/daily`. This structurally prevents the model from ever inventing a number. `explain_app_field` is the one exception — its answer is a small, hardcoded 9-term glossary (`APP_FIELD_EXPLANATIONS`) returned directly by the server, not fetched.

---

## 12. Write Actions

Full trace for a representative case, `add_water` (tested live end-to-end):
```
"Add 250 ml of water"
 → interpret-v2: intent=add_water, entities={amountMl:250}, missingFields=[], action=execute
 → client (useVoiceAssistant.performExecute): generates clientActionId, calls buildVoiceAction()
 → POST /api/athlete/water {amountMl:250, clientActionId} — the SAME endpoint the manual Water screen uses
 → 200 {date, goalMl, totalMl, entries:[...]}
 → dashboard cache patched in place with the real response (no refetch needed)
 → "250 ml added." spoken/shown
```
See Part 21 for the full endpoint table across all 13 write intents.

---

## 13. Required Field Collection

Multi-turn collection is real and server-persisted, confirmed live end-to-end:
```
"Add water" → {action: collect_fields, missingFields: ["amountMl"], spokenResponse: "How much water, in millilitres?"}
"500 ml"    → {action: execute, entities: {amountMl: 500}}   (server remembered the pending workflow — no client-side hint needed)
```
Every write intent has its own hardcoded required-field rule in `requiredMissingFields()` (`voiceIntentPolicy.ts:329-386`) and a matching follow-up question bank (`FIELD_FOLLOW_UP_QUESTIONS`). `update_field` merges only the newly-stated keys into the pending entities, restricted to that intent's own declared entity-key allowlist (`INTENT_ENTITY_KEYS`) — a correction turn can never smuggle in an unrelated field. There is no "overwrite vs update" ambiguity: every `update_field` turn simply replaces the named key(s) in place.

---

## 14. Confirmation Policy

| Action class | Confirmation required? | Current policy |
|---|---:|---|
| All 8 read (`show_*`) intents | No | Never write, never confirm |
| `open_screen` | No | Client-side navigation only |
| `explain_app_field` | No | Canned lookup, no write |
| 12 of 13 write intents (`log_wellness`, `log_session`, `log_rpe`, `add_water`, `log_meal`, `set_water_goal`, `change_hydration_reminder`, `log_recovery`, `mark_rest_day`, `log_heart_rate`, `update_profile`, `add_note`) | **No** | Auto-executes the instant required fields are present — a deliberate design choice, per an explicit code comment citing real usage friction feedback as the reason confirmation was removed for these |
| `send_coach_note` | **Yes** | The one write with a materially different risk profile (irreversible, visible to another real person) — reaches `ready_to_confirm`, shows a Confirm/Cancel card, confirmed live (reach+cancel and reach+confirm both tested) |

Cancel works and is instant (`cancel_action` → `action: reject`, pending state cleared server-side). There is no path to skip `send_coach_note`'s confirmation. No destructive/delete operation exists anywhere in the voice intent set — every write is an additive log entry, a profile field update, or a message send, all correctable afterward through the normal app UI. **No write action was found to bypass its own required confirmation policy** — the one real gap found is a *downstream* one, not a confirmation-policy one (see Part 20).

---

## 15. Pending State Machine

**Server** (`voiceIntentPolicy.ts`'s `action` values + `VoicePendingState` model): `collect_fields → ready_to_confirm → execute` or `reject`, persisted in MongoDB, **TTL 900 seconds (15 min) by default** (`env.voiceAssistant.pendingStateTtlSeconds`), unique per athlete, explicitly deleted the moment a turn resolves to execute/cancel/completion. Only the single most recent `lastTranscript` is ever stored (never a history), and **no audio is ever persisted anywhere in this pipeline** — confirmed by the model's own doc comment and cross-checked against every route/service file read.

**Client** (`mobile/src/lib/voiceAssistant/state.ts`) — a 9-phase reducer, confirmed live via the emulator's "Listening"/"Working" pills and confirmed via code for the rest:
```
idle → listening → processing → collecting ⇄ (loops on more collect_fields)
                                    ↓
                              confirming → needs_coach (only send_coach_note, if >1 coach) → confirming
                                    ↓                                                            ↓
                                 executing ←──────────────────────────────────────────────────────┘
                                    ↓
                                 done / error
```
Persistence: **survives app restart** (server-authoritative, 15-min window, scoped by `athleteProfileId`) — the client state is just a UI cache of it, not the source of truth. A different device or a session past the 15-minute window falls back to the client's own `pendingIntentHint`, which the server treats as lower-priority than its own record.

---

## 16. Conversational Context / Memory

| Context item | Source | Included every turn? |
|---|---|---|
| Pending workflow (intent, entities, missingFields) | Server `VoicePendingState`, DB-authoritative | Yes, whenever one exists |
| Current screen/tab | Client-reported, allowlist-validated | Yes (`currentScreen` field), but only used as a last-resort disambiguation hint for a vague reference — never overrides an explicit statement |
| Today's date | Server-computed | Yes (passed to the model) |
| Athlete identity | JWT-derived `athleteProfileId` | Every request (auth middleware) |
| Full conversation history | **Not sent to the model** — only the current pending workflow's already-collected entities | No |
| Coach identity for messaging | Resolved separately via `GET /api/athlete/coaches`, never from the model | Only for `send_coach_note` |

**Verdict, stated plainly per the task's request not to exaggerate**: this is a **stateful single-workflow assistant**, not a full conversational-memory system. It correctly remembers exactly one in-progress task (collecting fields for one intent, or confirming one action) across turns, server-side, for up to 15 minutes — genuinely more than a stateless command parser. But it does not retain broader conversation history, does not recall prior unrelated turns, and does not build any long-term memory of the athlete's phrasing habits or preferences.

---

## 17. Current Screen Awareness

Real but narrow, confirmed by direct code reading of both the Gemini system prompt and `screenContextFor()` (`AthleteAskAgentOverlayV2.tsx:43-57`). "Add this"/"log it"/"mark this done" is disambiguated by `currentScreen` **only when the utterance has no other classifiable signal** — nutrition→`log_meal`, water→`add_water`, workouts/log→`log_session`, progress/trends/goals→`show_progress`. An explicit, differently-stated request always wins over the screen hint (confirmed in both the system prompt text and the mock interpreter's fallback logic). This was tested live via `currentScreen` parameter variations in Part 39 rather than the mock only.

---

## 18. Gemini Layer

- **Model**: `gemini-3.6-flash` (code default; `GEMINI_MODEL` env-overridable — unset in this environment, so the default is what's actually in use).
- **Call mechanism**: raw `fetch()` against `generativelanguage.googleapis.com`'s REST `generateContent` endpoint — no `@google/generative-ai` SDK dependency, matching this codebase's stated "external-provider adapter" pattern used elsewhere (Razorpay, LiveKit).
- **Config**: `temperature: 0`, `responseMimeType: "application/json"`, a strict `responseSchema` enumerating every one of the 27 intents and ~30 typed entity fields with per-field descriptions (e.g. explicitly distinguishing `rpe` from `effortScore`, explicitly noting spoken-1-10 vs internal-1-5 scale conversion happens client-side, not in the model).
- **System instruction (summarized, not reproduced verbatim)**: classify-only, never decide next steps; use `unknown_intent` for anything unrelated to the app; use `explain_app_field` only for a small fixed glossary; extract only explicitly-stated values, never invent or carry forward unstated ones; keep `rpe`/`effortScore` distinct; handle one-sentence multi-value `log_session` descriptions in a single pass; distinguish `send_coach_note` (sent) from `add_note` (private); never invent real data for `show_*` intents; report calibrated confidence, lower for ambiguous/short/noisy input; use `currentScreen` only as a last-resort disambiguation hint.
- **Retry/timeout**: no explicit retry found in `voiceIntentInterpreterV2.ts`; a non-2xx HTTP response or malformed/empty JSON throws, caught one level up in the route handler and downgraded to `unknown_intent` with confidence 0 (`athleteVoiceV2.ts:103-110`) — so a Gemini outage degrades to "I didn't catch that," not a hard error.
- **When bypassed**: only when `GEMINI_API_KEY` is unset, falling back to `MockVoiceIntentInterpreterV2` — a deterministic keyword/regex classifier used for local dev without a key and for tests. **In this environment the real key IS configured** (`server/.env:27`), so all live testing in this audit exercised the genuine Gemini model, not the mock.
- **Output validation**: `sanitizeModelOutput()` rejects any response with an invalid intent enum, a non-object `entities`, or a missing/non-finite `confidence`, downgrading it to `unknown_intent`/confidence 0 rather than trusting a malformed shape.

---

## 19. Deterministic Rule Layer

Two separate deterministic layers exist, serving different purposes:
1. **`voiceIntentPolicy.ts`** — always active, downstream of Gemini, the sole decision-maker for action/confirmation/missing-fields (see Part 14/15). This is not a competing classifier; it never overrides what intent Gemini chose.
2. **`MockVoiceIntentInterpreterV2`** (`voiceIntentInterpreterV2.ts:285-453`) — a full regex/keyword-based intent classifier, but it is **only** used as the entire interpreter when `GEMINI_API_KEY` is absent (local dev/tests). It does not run alongside or arbitrate against Gemini in this or any live environment where a key is configured — there is no "rule match vs Gemini interpretation, which wins" conflict to resolve, because only one of the two ever runs per request, chosen once at process startup by `getVoiceIntentInterpreterV2()`.

---

## 20. Ambiguity Handling

- **Confidence gating**: below `0.45` confidence, a fresh (non-meta) classification is never acted on — the athlete is asked to repeat themselves, or, if a workflow was already pending, that pending state is preserved rather than discarded (`voiceIntentPolicy.ts:464-483`).
- **"Log 8"** ✓ tested live: classified `log_rpe`, `entities:{rpe:8}`, `action:execute` — **and this is a confirmed real bug**: `log_rpe`'s own missing-field rule (`voiceIntentPolicy.ts:350-351`) requires only `rpe`, but the actual write endpoint it's mapped to (`POST /api/athlete/voice/log-session`, via `actionMapping.ts:83-96`) hard-requires `trainingCategory` and `plannedIntensityPercent` whenever `rpe` is present (`athleteVoiceV2.ts:518-527`). Reproduced directly: calling `/log-session` with exactly the payload `log_rpe`'s mapping would send for a bare "Log 8" returns `400 {"error":"invalid_trainingCategory"}`. The user would hear the optimistic "Saving that now." followed immediately by a failure message ("I need a valid training category to save that RPE.", from `actionDispatch.ts`'s error map) — every natural, bare "log my RPE as 8" phrasing that never mentions a training category is guaranteed to fail this way, since `log_rpe`'s policy never asks the follow-up question that would prevent it.
- **"Add it"** (tested live with and without `currentScreen`): with no screen context, falls through every classifier rule to `unknown_intent`; with `currentScreen: "water"`, correctly resolves via the screen-hint fallback (confirmed live).
- **"I'm tired"** ✓ tested live: classified `log_wellness`, correctly starts the collect-fields flow by asking for sleep quality first, not treated as a safety/medical statement (see Part 32 for that angle specifically).
- **No confidence display to the user** — the confidence score is logged server-side (`logVoiceEvent`) but never surfaced in the UI or spoken response.

---

## 21. Action Execution

Full endpoint table, extracted directly from `mobile/src/lib/voiceAssistant/actionMapping.ts`'s `buildVoiceAction()`:

| Voice intent | Existing API called | Voice-specific endpoint? |
|---|---|---|
| `log_session`, `log_rpe` | `POST /api/athlete/voice/log-session` | Yes — but writes through the same `TrainingSession`/`RpeMonitoring` Mongoose models the manual UI uses, via a shared orchestration helper (`writeSessionAndRpe`) that also fires the same `readiness_risk_flag` coach notification the manual RPE-monitoring endpoint fires |
| `log_meal` | `POST /api/athlete/voice/log-meal` | Yes — writes through the same `Meal`/`MealFood` models the manual Log Meal screen uses |
| `log_wellness` | `POST /api/athlete/wellness` | **No** — identical endpoint to the manual Check-in screen |
| `add_water` | `POST /api/athlete/water` | **No** — identical to the manual Water screen |
| `set_water_goal`, `update_profile` | `PATCH /api/athlete/me` | **No** |
| `change_hydration_reminder` | `PATCH /api/notification-preferences` | **No** |
| `log_recovery` | `POST /api/athlete/recovery` | **No** — but the mapping synthesizes a fake `{modalities: [], note: "Skipped recovery today"}` for a spoken "skip recovery," since the real endpoint has no actual "skipped" field/status |
| `mark_rest_day` | `POST /api/athlete/rest-day` | **No** |
| `log_heart_rate` | `POST /api/athlete/heart-rate` | **No** |
| `send_coach_note` | `POST /api/athlete/messages/:coachId` | **No** — the exact same messaging endpoint documented in this session's earlier Release Hardening pass |
| `add_note` | `POST /api/athlete/notes` | **No** |

**No action was found writing directly to the database or duplicating core business logic outside the model layer** — even the two voice-specific endpoints reuse the same Mongoose models, validation helpers (`deriveLoadAndRisk`), and notification-dispatch calls as their manual-entry counterparts, rather than maintaining an independent parallel implementation. The `log_recovery` "skipped" synthesis is the one place where the mapping papers over a real product-model gap (no server-side concept of "skipped recovery") rather than a duplicated-logic risk.

---

## 22. Idempotency

Real, server-enforced, confirmed by code (`voiceIdempotency.ts`, `VoiceActionReceipt.ts`): a unique `(userId, clientActionId)` Mongo index atomically claims each append-only write attempt; a duplicate-key error on that insert means the action already ran (or is running), so a short bounded poll (5×150ms) returns the cached `resultSummary` instead of re-executing. This is explicitly the second line of defense — the comment notes a client-side execution lock is the first line for a truly simultaneous double-tap. `clientActionId` is generated once per pending workflow and reused across retries (never regenerated mid-confirmation), and is threaded through for the genuinely append-only writes (log-session, add_water, log-meal, send_coach_note, add_note). Upsert-keyed writes (wellness/rpe/recovery/rest-day) rely on their own natural `(athleteId, date[, slot])` unique-index idempotency instead, by design.

---

## 23. Action Receipts / Audit

`VoiceActionReceipt` (Mongo model): stores `userId`, `clientActionId`, `route`, `resultSummary`, TTL-expiring (`env.voiceAssistant.actionReceiptTtlSeconds`). Used exclusively as the idempotency ledger described above — **there is no undo/replay-prevention feature built on top of it**, and it is not exposed anywhere in the UI as a visible "action history." Its sole current purpose is duplicate-write suppression.

---

## 24. Undo / Cancel

Two genuinely different things exist, and only one is implemented:
- **Cancel-before-execute**: fully implemented and tested live — `cancel_action` (a spoken/typed "no") on a pending `send_coach_note` workflow discards it cleanly (`action: reject`, pending state deleted).
- **Undo-after-write**: **does not exist anywhere in the codebase.** No route, model field, or client affordance for reversing an already-executed voice write was found (grepped for "undo" across the voice-related files — no matches). Correcting a mistaken voice-logged entry today would require using the normal app UI to edit/delete it manually, the same as any other entry.

---

## 25. Current Assistant Response Generation

100% deterministic string templates — confirmed by reading every response-text source:
- `voiceIntentPolicy.ts`'s `spokenResponseFor()` — follow-up questions, navigation confirmations, generic save/error phrases (all fixed strings, no interpolation of real data beyond the entities the athlete themselves just stated).
- `answerFormatting.ts`'s 8 `format*Answer()` functions — plug real, already-fetched numbers into fixed sentence templates (e.g. `` `Your readiness today is ${score} out of 100.` ``).
- `actionMapping.ts`'s `successMessage` per intent — fixed templates using only the confirmed entities (e.g. `` `${amountMl} ml added.` ``).

**No response text is ever LLM-generated** for the reply the athlete hears — Gemini's only output that reaches the user is, indirectly, the entity values it extracted, which are then substituted into these fixed templates. This structurally makes hallucinated *numbers* in a spoken reply essentially impossible for read (`show_*`) intents, since those numbers always come from a fresh, real API fetch, never from the model's own text generation.

---

## 26. Error / Retry Behavior

| Failure | Current UI | Current voice response | Retry? |
|---|---|---|---|
| No microphone permission | Silently opens text-input overlay | None spoken | No — user must type instead |
| No internet / network down | `handlers.onNeedsFallback()` → text input | None spoken | No |
| STT unavailable (Deepgram down/unconfigured) | Silent fallback: to batch recorder if streaming, or to text input if systemic | None spoken | No |
| Gemini unavailable/errors | Downgraded to `unknown_intent`, confidence 0 | "I didn't catch that. Could you say it again?" | Yes — user can just try again, no automatic retry |
| Malformed model response | Same as above (`sanitizeModelOutput`) | Same | Same |
| Backend 400 (validation) | Confirmation card / banner shows the mapped human message | e.g. "I need a valid training category to save that RPE." | No |
| Backend 401/403 | Not specially handled in the voice layer — falls to the generic `humanizeExecuteError()` fallback | "Something went wrong saving that. Please try again." | No |
| Backend 429 (rate limit) | Same generic fallback | Same | No |
| Backend 500 / timeout | Same generic fallback (confirmed live — this is the exact error text this audit reproduced) | "Sorry, I couldn't reach the server. Please try again." (interpret-v2 failure) or "Something went wrong saving that." (execute failure) | No |
| TTS unavailable | Silent fallback to `expo-speech` | (still spoken, via fallback) | N/A |
| Audio playback failure | Same silent fallback | Same | N/A |
| Missing required profile data | N/A — no voice intent currently depends on unset profile data to function | — | — |
| Duplicate action | Idempotency ledger returns the cached result | Same success message as the original | N/A (correctly a no-op, not an error) |
| Session expired (JWT) | Not voice-specific — same 401 handling as the rest of the app | Generic fallback message | No |

**Pattern across the whole layer, confirmed by both code and live reproduction**: there is no dedicated error toast/dialog component anywhere in this pipeline. Every failure either (a) silently restarts listening, (b) silently swaps to text input, or (c) shows the same small inline error banner used for every other failure type — a user cannot tell from the UI alone whether a save failed due to bad input, a server outage, or a permission problem, beyond whatever specific text happens to be mapped.

---

## 27. Provider Fallbacks

```
Deepgram STT unavailable/unconfigured → on-device recognition (if it's the reason it wasn't reached first)
                                       → OR batch recorder (if streaming specifically failed)
                                       → OR text-input fallback (if genuinely systemic)
Gemini unavailable                    → unknown_intent, confidence 0 (NOT the deterministic mock —
                                          the mock is a build-time choice, not a runtime fallback)
Deepgram TTS unavailable              → expo-speech (OS-native), transparent to the user (still spoken)
Network unavailable                   → text-input fallback / generic error banner, no retry
```
Fallback visibility, stated honestly: STT and TTS fallbacks are **transparent** (the athlete gets a working experience, just via a different backend, with no indication it happened). The Gemini-unavailable fallback is **degraded but visible** — the athlete is explicitly told "I didn't catch that," which somewhat mischaracterizes a server-side outage as a hearing/parsing problem. Network-unavailable is the most **broken-feeling** case: a flat "couldn't reach the server" with no retry button and no indication of what to do next beyond trying again from scratch.

---

## 28. Availability by Screen

| Athlete Screen | FAB visible? | Context passed? | Useful actions given current intent set |
|---|---:|---:|---|
| Today | Yes (labeled "Ask Agent") | `today` | show_readiness, show_today_plan, all writes |
| Training (dashboard tab) | Yes | `workouts` | log_session context-hint, show_today_plan |
| Active Workout | Yes (global overlay, not screen-specific) | Not mapped — `screenContextFor()` has no `active-workout` case, falls through to `undefined` | No screen-hint benefit; explicit utterances still work |
| Nutrition (dashboard tab) | Yes | `nutrition` | log_meal context-hint, show_nutrition |
| Meal Log | Yes | `nutrition` | log_meal context-hint |
| Meal Scan | Yes | `nutrition` | log_meal context-hint |
| Coach (dashboard tab) | Yes | `coach` | send_coach_note, show_coach_feedback |
| Progress | Yes | `progress` | show_progress context-hint (confirmed live) |
| Check-in | Yes (global overlay) | Not mapped | No screen-hint benefit |
| RPE | Yes | `workouts` | log_session/log_rpe context-hint |
| Water | Yes | `water` | add_water context-hint (confirmed live) |
| Trends | Yes | `progress` | show_progress context-hint |
| Marketplace/Coach Discovery | Yes | `coach` | send_coach_note context-hint |
| Profile/Account | Yes (global overlay) | Not mapped | No screen-hint benefit |
| Notifications | Yes (global overlay) | Not mapped | No screen-hint benefit |

The FAB is a global, always-mounted overlay (`_layout.tsx`'s `Gate()`), so "visible?" is trivially yes everywhere for the athlete role — the meaningful column is context-passing, which is real for 8 of the ~15 screens and simply absent (not broken, just unmapped) for the rest.

---

## 29. Active Workout Voice Capability

| Command | Status | Evidence |
|---|---|---|
| "Complete set" | **NOT IMPLEMENTED** | No intent in `VOICE_INTENTS_V2` maps to set-completion; Active Workout has no `currentScreen` mapping at all |
| "I did 10 reps" | **NOT IMPLEMENTED** | Same — no per-set voice intent exists |
| "Next exercise" | **NOT IMPLEMENTED** | No navigation-within-workout intent exists |
| "Start rest timer" | **NOT IMPLEMENTED** | No intent |
| "Skip this exercise" | **NOT IMPLEMENTED** | No intent — the in-app "Can't perform this exercise" flow (documented in this session's separate UI-baseline audit) has no voice equivalent |
| "My shoulder hurts" | **PARTIAL** | Would classify as `add_note` (a private, unreviewed note) at best — same gap as the general safety-language finding in Part 32, not workout-specific |
| "How many sets are left?" | **NOT IMPLEMENTED** | No `show_*` intent reads workout/set progress |

**This is a real, complete gap** — the entire Active Workout screen has zero dedicated voice intents and no screen-context mapping, despite being flagged as the highest-value future use case. Every one of the 7 example commands above is unsupported today.

---

## 30. Nutrition Voice Capability

| Capability | Status | Evidence |
|---|---|---|
| Log meal | **IMPLEMENTED** | `log_meal`, tested classification live, full field extraction (mealType/calories/macros) |
| Add food (to an existing meal) | **NOT IMPLEMENTED** | `log_meal` always creates a new standalone meal (`Meal.create`); there's no "add to today's lunch" intent |
| Scan food | **NOT IMPLEMENTED via voice** | No intent triggers the Meal Scan camera flow — it remains a manual-tap-only feature |
| Water | **IMPLEMENTED** | `add_water`, `set_water_goal`, `change_hydration_reminder`, `show_hydration` all real and tested/verified |
| Calories left | **IMPLEMENTED** | `show_nutrition`, real fetch+format |
| Macros | **IMPLEMENTED** | Included in `show_nutrition`'s answer (protein/carbs/fat remaining) |
| Planned dinner / meal plan | **NOT IMPLEMENTED** | No intent reads `PlannedMeal` data — only actually-logged `Meal` totals are voice-accessible |

---

## 31. Coach Voice Capability

| Capability | Status | Evidence |
|---|---|---|
| "What did my coach say?" | **IMPLEMENTED** | `show_coach_feedback`, tested live, reads real `CoachComment` data |
| "Message my coach" | **IMPLEMENTED** | `send_coach_note`, tested live end-to-end including the confirmation card and coach-resolution step |
| "When is my next session?" | **IMPLEMENTED** | `show_upcoming_session`, reads real `CoachSession` data |
| "What has my coach assigned?" | **NOT IMPLEMENTED** | No intent reads `WorkoutAssignment`/`MealPlanAssignment` specifically by coach-assignment framing — `show_today_plan` covers today's workout generically, but not "what has my coach assigned me this week" |
| "Open my coach" | **IMPLEMENTED** | `open_screen` → `coach`, tested live |

---

## 32. Progress Voice Capability

| Capability | Status | Evidence |
|---|---|---|
| "How am I doing?" | **IMPLEMENTED** (via `show_readiness`/`show_progress`, depending on phrasing) | Tested live |
| "What's my readiness this week?" | **PARTIAL** | `show_progress` answers with a readiness *trend direction*, not a weekly-specific breakdown; `show_readiness` only answers *today's* number |
| "How many workouts did I complete?" | **NOT IMPLEMENTED as its own question** | No intent specifically answers a workout-completion count; `show_daily_checklist` only covers *today* |
| "How is my nutrition?" | **IMPLEMENTED** | `show_nutrition` |
| "Show my progress" | **IMPLEMENTED** | `show_progress`, tested live |

---

## 33. Safety Behavior

**Tested live against the real system** (3 phrases, real Gemini classification):

| Phrase | Result | Classification |
|---|---|---|
| "My chest hurts" | `add_note`, `action: execute`, spoken: "Saving that now." | Silently becomes an ordinary **private** note — never surfaced to a coach, no risk flag, no differentiated handling of any kind |
| "I feel dizzy and I cannot breathe" | `unknown_intent`, `action: reject`, spoken: "I didn't catch that. Could you say it again?" | Treated **identically** to a garbled or unrelated utterance — no differentiation from any other unrecognized input |
| "My knee hurts badly" | `add_note`, `action: execute`, spoken: "Saving that now." | Same as chest-pain case — private note, no escalation |

**Factual conclusion, stated plainly per the task's request not to add opinion beyond the evidence**: there is **no special handling of any kind for high-risk or medical language** anywhere in the current voice pipeline — not in the Gemini system prompt (which has no instruction referencing pain, injury, or medical urgency at all), not in `voiceIntentPolicy.ts` (no safety-check branch exists), and not in any downstream notification (an `add_note` write does not trigger any coach alert — that only happens for the separate, manually-logged `Injury` model via `routes/coach.ts`, which voice never touches). A phrase describing a potential medical emergency currently either silently disappears into an unreviewed private note, or is rejected exactly like noise.

---

## 34. Latency

Real Deepgram is unconfigured in this environment, so true mic→transcript timing could not be measured; the interpret/policy/execute stages (everything downstream of a transcript existing) were measured externally via wall-clock timing on 8 real, live `POST /api/athlete/voice/interpret-v2` calls against the real Gemini model (no permanent instrumentation added — this is external measurement, and the pipeline already has its own non-invasive logging via `logVoiceEvent`'s `latencyMs` fields at the `interpret` and `action_executed` stages, which this audit did not need to add).

| Stage | Observed (this environment, real Gemini, 8 samples) |
|---|---|
| Mic start → permission/listening begins | Not measurable without real audio (native listening confirmed instant on-device, no network round-trip for on-device recognition) |
| Speech end → transcript | Not measurable — no real STT configured here |
| Intent interpretation (interpret-v2 round trip, includes Gemini call) | **2.1s – 3.7s**, average ≈2.7s across 8 calls |
| Backend write action (e.g. `add_water`) | Sub-200ms typical (simple, indexed writes) — not separately isolated in this pass |
| Response available | Same as interpret-v2 round trip for read/nav intents (answer text formatting is local/instant once the follow-up data fetch, itself a fast indexed query, completes) |
| TTS start | Not measurable — Deepgram TTS unconfigured; OS `expo-speech` fallback has negligible local latency |
| **Total turn (transcript-to-response text)** | **~2.1–3.7s**, entirely dominated by the Gemini classification call |

**Stated limitation**: this only captures the "text in, decision out" portion of a real voice turn. A full spoken turn's user-perceived latency would additionally include real STT time (unmeasurable here) and real TTS synthesis+playback time (unmeasurable here) — both unconfigured in this environment.

---

## 35. Model / Provider Calls

- **Gemini calls per voice turn**: exactly one `interpret-v2` call per turn (one Gemini `generateContent` request), confirmed by code — there is no multi-call chaining within a single turn. A multi-turn field-collection conversation makes one Gemini call per turn, same as any other turn (no special-casing that skips the model for a simple "yes"/"no" — those are still classified by Gemini as `confirm_action`/`cancel_action`, not pattern-matched client-side, per `useVoiceAssistant.ts`'s `confirm`/`cancel` functions both calling `runTurn("yes"|"no")` through the full pipeline).
- **STT session behavior**: one Deepgram session (streaming or batch) per listen-cycle; the conversation loop restarts a fresh listening session after each spoken reply, not a single long-lived session for the whole conversation.
- **TTS calls**: one `/api/voice/speak` request per assistant reply (never streamed/chunked).
- **Translation calls**: an additional Gemini call via `/api/voice/translate` only fires for detected Tanglish input — a genuinely separate, conditional extra model call layered on top of the base one-call-per-turn pattern.
- **No obviously avoidable repeated/duplicate calls were found** — even a UI tap-to-edit on the confirmation card re-invokes the full `interpret-v2`/Gemini round trip (by design, per `useVoiceAssistant.ts`'s `editField`, so corrections get the same validation as spoken ones) — this is a deliberate consistency choice, not an accidental inefficiency, though it does mean every single field edit costs a full ~2-3s Gemini round trip rather than an instant local update.

---

## 36. Privacy & Data Flow

| Provider | Data sent |
|---|---|
| Deepgram | Raw audio (streaming PCM or uploaded recording) for STT; text for TTS synthesis. **Not configured in this environment**, so no real traffic was sent during this audit |
| Gemini | Transcript text, today's date, current-screen hint, and (when a workflow is pending) the already-collected entity values and list of still-missing fields — **never raw audio**, confirmed by tracing every Gemini call site |
| Other | None — no third AI/data provider found in the voice pipeline |

**Audio storage**: confirmed **never stored** — every route/model file that touches audio (`voice.ts`, `voiceStream.ts`) only relays it to Deepgram and returns the transcript; nothing writes audio bytes to any Fitora database or disk location.
**Transcript persistence**: confirmed **minimal and transient** — the *only* place any transcript text is ever stored is `VoicePendingState.lastTranscript`, a single field overwritten every turn (never accumulated into history), deleted on workflow completion/cancellation, and TTL-expired after 15 minutes regardless. `logVoiceEvent`'s structured logging explicitly documents (in its own code comment) that transcript text and entity values must never be logged, only counts/categorical fields/timing — confirmed true across every `logVoiceEvent` call site read in this audit.
**Retention**: no explicit retention policy document was found in code beyond the TTL values already cited (`pendingStateTtlSeconds` default 900s, `actionReceiptTtlSeconds` — not read this pass, a minor gap in this audit's coverage). No policy is inferred beyond what these TTLs concretely state.

---

## 37. Authorization

Every voice route (`athleteVoiceV2.ts`) is gated by `requireAuth, requireRole("athlete"), loadScope` (`athleteVoiceV2.ts:39`), matching the same three-layer coach-scope pattern documented elsewhere in this codebase. `selfAthleteId(req)` always derives the acting athlete's own `athleteProfileId` from the authenticated JWT (`req.actor.athleteProfileId`) — **never from any client-supplied ID, and never from anything the Gemini model output contains**. `send_coach_note`'s target coach is resolved via `GET /api/athlete/coaches` (the athlete's own real, current assignment list), explicitly never from a coach name/ID the model might have extracted — confirmed by both the system prompt's own instruction ("Never extract a coach name or identifier — coach targeting is resolved by the app, not by you") and the client code (`fetchAssignedCoaches()`, never passing model-derived data into the coach-selection step). **No path was found by which voice could act on or read another athlete's data** — every write/read endpoint scopes strictly to the authenticated athlete's own `athleteProfileId`.

---

## 38. Test Coverage

| Journey | Coverage | Test file(s) |
|---|---|---|
| STT (Deepgram model fallback) | **PARTIAL** | `server/tests/voice-deepgram.test.ts` (one test: Flux→Nova fallback on the prerecorded path) |
| Intent interpretation (V2, Gemini/mock) | **PARTIAL** (contract-level, not model-quality) | `server/tests/voice-interpret-v2.test.ts` |
| Rule/deterministic parser (mock interpreter) | **NOT COVERED directly** — only indirectly via the V1 route's contract tests | `server/tests/athlete-voice.test.ts` |
| Gemini fallback (key unset → mock) | **NOT COVERED** — no test found exercising the `getVoiceIntentInterpreterV2()` selection logic itself | — |
| Read action (`show_*`) | **COVERED** (formatting) + **COVERED** (policy: answer action) | `voiceAssistantAnswerFormatting.test.ts`, `voice-policy.test.ts` |
| Write action | **COVERED** | `voiceAssistantActionMapping.test.ts`, `voice-policy.test.ts`, `voice-log-session.test.ts` (real transactional write, replica-set required) |
| Missing-field collection | **COVERED** | `voice-policy.test.ts` |
| Update field | **COVERED** | `voice-policy.test.ts` |
| Confirm / Cancel | **COVERED** | `voice-policy.test.ts` (meta-intents vs pending state, `send_coach_note` confirmation specifically) |
| Duplicate confirm / idempotency | **NOT COVERED by a dedicated voice test found this pass** — idempotency logic itself (`voiceIdempotency.ts`) was not confirmed to have a direct unit test in this audit's file list |
| Navigation | **COVERED** | `voice-policy.test.ts`, `athleteAskNavigation.test.ts` (though the latter is the coach-side Ask Agent navigation classifier — worth confirming it isn't conflated with the athlete V2 path) |
| TTS | **COVERED** (fallback only) | `agentSpeechFallback.test.ts` |
| Provider failure | **PARTIAL** | `voiceSessionSttFallback.test.ts` (STT systemic-failure classification only; no test found for Gemini-down or Deepgram-TTS-down specifically) |
| Auth expiry | **NOT COVERED by a voice-specific test found this pass** — likely covered generically by the app's broader auth-middleware tests, not verified in this audit |
| Mic permissions | **NOT COVERED** — no automated test found for the permission-denied→fallback path (inherently hard to unit-test against a native permission API) |
| Native overlay (FAB/UI states) | **NOT COVERED** by automated tests — this audit's own live emulator screenshots are the only verification of the actual rendered UI states |

---

## 39. Live Test Results

`npx tsc --noEmit` (server) — clean, no changes made. Mobile typecheck/lint were not re-run in this pass since no source was touched (already verified clean earlier this session). No voice-specific test file was modified or re-run in isolation this pass — the full server suite's last clean run earlier this session (615/615) already covers every voice test file listed in Part 38.

**Live utterances tested against the real, running server** (real Gemini, real MongoDB, real athlete account `meera.baseline@fitora.test`) — **20 distinct utterances** across all required categories:

Read (5/5 tested, all correctly classified and answerable): readiness, today's workout, water remaining, coach feedback, progress.
Navigation (3/3 tested, all correct): nutrition, training, coach.
Safe writes (3/3 tested, all real writes executed successfully): 250ml water, 3L water goal, a private note.
Multi-turn (1 flow tested): "Add water" → missing-field question → "500 ml" → executed.
Confirmation (2 flows tested): reach `send_coach_note`'s confirmation + cancel; reach it again + confirm (a real message was sent to the coach).
Ambiguous (4 tested): "Add it" (no context → unknown; with `currentScreen=water` → correctly resolved to `add_water`), "Log 8" (executed, then found to fail downstream — see Part 20), "I am tired" (correctly started wellness collection).
Safety (3 tested): chest pain, dizziness/breathing difficulty, knee pain — see Part 32 for full results.

No unsupported command was forced to artificially succeed; every result above is the system's genuine, unmodified live response.

---

## 40. Conversation Traces

**Trace 1 — simple read**
```
UTTERANCE: "What's my readiness today?"
POST /api/athlete/voice/interpret-v2 → {intent: show_readiness, action: answer, spokenResponse: "Here's what you asked for."}
CLIENT: fetches GET /api/athlete/daily, formats via formatReadinessAnswer()
RESULT (this athlete's real data): "Your readiness today is 45 out of 100."
LATENCY: 2849ms (interpret-v2 round trip)
```

**Trace 2 — navigation**
```
UTTERANCE: "Go to training"
→ {intent: open_screen, entities: {screen: "workouts"}, action: navigate, spokenResponse: "Opening workouts."}
CLIENT: router.replace({pathname:"/athlete/dashboard", params:{section:"workouts"}})
LATENCY: 3726ms
```

**Trace 3 — safe write, no confirmation**
```
UTTERANCE: "Add 250 ml of water"
→ {intent: add_water, entities: {amountMl: 250}, action: execute, spokenResponse: "Saving that now."}
CLIENT: POST /api/athlete/water {amountMl: 250, clientActionId: <uuid>}
RESULT: 200 {date, goalMl:3000, totalMl:<updated>, entries:[...]}
SPOKEN: "250 ml added."
UI STATE: phase "done", successMessage banner, auto-dismisses after 4s
```

**Trace 4 — multi-turn field collection**
```
TURN 1 — "Add water"
→ {intent: add_water, entities: {}, missingFields: ["amountMl"], action: collect_fields,
   spokenResponse: "How much water, in millilitres?"}
SERVER: VoicePendingState upserted (intent=add_water, missingFields=[amountMl])
UI STATE: phase "collecting"

TURN 2 — "500 ml" (no client-side hint sent — server remembered the pending workflow)
→ {intent: add_water, entities: {amountMl: 500}, missingFields: [], action: execute}
CLIENT: executes exactly as Trace 3
```

**Trace 5 — confirmation required, reach + cancel, then reach + confirm (real send)**
```
UTTERANCE: "Tell my coach great session today"
→ {intent: send_coach_note, entities: {body: "great session today"}, action: ready_to_confirm,
   requiresConfirmation: true, spokenResponse: "Send this to your coach: \"great session today\"?"}
UI STATE: ConfirmationCard shown, "Message: great session today"

USER: "no, cancel" → {action: reject, spokenResponse: "Okay, cancelled."} — VoicePendingState deleted, nothing sent.

--- separately ---
UTTERANCE: "Tell my coach thanks for the plan"
→ ready_to_confirm again
USER: "yes" → {intent: send_coach_note, action: execute, requiresConfirmation: true,
   spokenResponse: "Saving that now."}
CLIENT: POST /api/athlete/messages/:coachId {body: "thanks for the plan", clientActionId}
RESULT: a real message was delivered to Coach Kumar's inbox (verified this is the identical
  messaging endpoint documented in this session's earlier Release Hardening report).
```

**Bonus trace — the confirmed bug (Part 20)**
```
UTTERANCE: "Log 8"
→ {intent: log_rpe, entities: {rpe: 8}, action: execute, spokenResponse: "Saving that now."}
CLIENT would call: POST /api/athlete/voice/log-session
  {sessionType: "AM", status: "completed", rpe: 8, clientActionId: <uuid>}
ACTUAL SERVER RESPONSE (reproduced directly): 400 {"error": "invalid_trainingCategory"}
SPOKEN (per actionDispatch.ts's error map): "I need a valid training category to save that RPE."
GAP: log_rpe's own field-collection policy never asks for trainingCategory/plannedIntensityPercent,
  so this failure is unavoidable for any bare RPE utterance that doesn't separately volunteer a
  training category — the assistant's "Saving that now." is followed by a guaranteed rejection.
```

---

## 41. Current Limitations

Factual, evidence-based, no proposed fixes — organized by the task's own categories:

- **Interaction**: no barge-in (can't interrupt TTS by speaking); no visible confidence indicator; no mute toggle; error feedback is a single generic banner style regardless of failure cause.
- **Conversation**: no cross-turn conversation history beyond the single current pending workflow; a UI tap-to-edit a field still costs a full ~2-3s Gemini round trip rather than an instant local update.
- **Context**: `currentScreen` mapping is unset for Active Workout, Check-in, Profile, and Notifications — no screen-hint benefit on those specific screens (though explicit utterances still work everywhere).
- **Speed**: every turn, including trivial yes/no confirmations and field edits, costs a full Gemini round trip (~2-3s observed) — there is no fast/local path for the meta-intents.
- **Language**: Tamil/Tanglish support depends on either the Gemini prompt's own claimed mixed-language understanding or a separate translation hop, and this audit could not verify live (no real audio input possible in this environment) which path actually fires or how reliably.
- **Capabilities**: Active Workout has zero dedicated voice intents (Part 29) — the single most-cited high-value future use case is entirely unimplemented today. "What has my coach assigned this week" and "workouts completed this week" have no dedicated intent either.
- **UX**: identical generic error messaging across nearly every failure class makes it impossible for a user to tell what actually went wrong; permission denial and STT failure both fail completely silently with no explanation shown.
- **Reliability**: the confirmed `log_rpe` bug (Part 20) means a common, natural bare RPE utterance is guaranteed to fail after an optimistic "Saving that now."
- **Safety**: no differentiated handling exists for any medical/high-risk phrase (Part 32) — such statements either vanish into an unreviewed private note or are rejected identically to noise.
- **Architecture**: V1 is confirmed dead-but-deployed code (unreachable, but still live at its HTTP route and still shipping ~770 lines + a route handler) — a real, quantifiable amount of unused surface area, per the codebase's own `DEPRECATED` comment awaiting a "residual traffic is zero" confirmation that this audit's live testing (which only ever hit V2) is consistent with, though it cannot itself prove zero traffic from other, older app installs in production.

---

## 42. Capability Scorecard

| Capability | Current State | Evidence |
|---|---|---|
| Tap-to-talk | STRONG | Confirmed live, works reliably |
| Streaming STT | PARTIAL | Real code path exists (Deepgram WS), but unconfigured/untestable in this environment; on-device recognition (no streaming to Fitora) is the actual live-verified path |
| Interim transcript | PARTIAL | Server relays it, client only uses it for a volume animation, never shown as text |
| Interruption/barge-in | NOT IMPLEMENTED | Confirmed no barge-in logic anywhere |
| TTS | PARTIAL | Real, well-engineered with OS fallback, but unconfigured (Deepgram) in this environment |
| Cancel | STRONG | Instant, clean, tested live |
| Confirmation | WEAK | Only 1 of 13 write intents requires it — by design, but a genuinely thin safety net for the rest |
| Multi-turn | STRONG | Server-persisted, 15-min TTL, tested live end-to-end |
| Context awareness | PARTIAL | Real single-workflow memory, no broader history — accurately "stateful single-task," not "conversational memory" |
| Screen awareness | PARTIAL | Real but only as a last-resort disambiguator, and unmapped on several screens |
| Read data | STRONG | 8 intents, all tested/verified against real data, structurally hallucination-resistant |
| Write data | STRONG (mechanism) / WEAK (one confirmed bug) | Reuses existing secured endpoints correctly, but `log_rpe` has a real field-requirement mismatch |
| Navigation | STRONG | All tested destinations real and correct |
| Active Workout control | NOT IMPLEMENTED | Zero dedicated intents, confirmed |
| Nutrition logging | PARTIAL | Meal/water logging strong; "add to meal," scan-by-voice, and meal-plan queries absent |
| Coach messaging | STRONG | Full trace tested, correctly confirmation-gated, correct coach resolution |
| Progress questions | PARTIAL | General trend covered; specific weekly breakdowns and completion counts are not |
| Multilingual | PARTIAL | Real infrastructure (hints, translation hop, OS TTS locale) — unverified end-to-end without real audio |
| Offline behavior | WEAK | No offline-specific handling found; network failure produces a flat, non-retryable error |
| Ambiguity handling | PARTIAL | Confidence gating and screen-hint fallback are real and tested; some ambiguous phrasing (e.g. bare "Log 8") produces a confident-but-broken result rather than a clarifying question |
| Error recovery | WEAK | Generic, largely silent failure handling across almost every failure class |
| Action audit | WEAK | Receipt ledger exists but is idempotency-only, not a user-facing audit trail |
| Undo | NOT IMPLEMENTED | Cancel-before-execute only; no undo-after-write anywhere |

---

## Final Response

### Voice files inspected
41 files read in full or near-full (server + mobile), covering ~6,000 lines of directly-authored voice-pipeline code, plus 2 background research passes covering the mic/STT/TTS client layer and the V1-vs-V2/test-coverage question. Key paths: `server/src/routes/athleteVoiceV2.ts`, `services/voiceIntentPolicy.ts`, `services/voiceIntentInterpreterV2.ts`, `services/voiceIntentInterpreter.ts` (V1), `routes/voice.ts`, `routes/voiceStream.ts`, `models/VoicePendingState.ts`, `models/VoiceActionReceipt.ts`, `lib/voiceIdempotency.ts`, `mobile/src/lib/voiceAssistant/*` (8 files), `mobile/src/lib/voiceSession.ts`, `agentSpeech.ts`, `voiceLanguage.ts`, `voiceTranslation.ts`, `mobile/src/components/AskAgentControl.tsx`, `components/voiceAssistant/*`.

### Active pipeline
V2 only — V1 is confirmed dead-but-deployed code, unreachable from the current mobile client.

### Supported intents
27 (26 real intents + `unknown_intent`), all extracted directly from the current `VOICE_INTENTS_V2` source, not assumed.

### Native states captured
9 distinct on-screen states captured live on the Android emulator (closed/FAB, native permission dialog, genuine listening, text-input fallback ×2 paths, network-failure banner, processing pill, return-to-idle). 6 further states verified via direct, live API calls against the real server instead of on-screen capture, and explicitly marked `NOT CAPTURED` on-screen in the index with the reason (an ADB IME tooling limitation, not a product defect).

### Live utterances tested
20 distinct utterances against the real running server (real Gemini, real database), covering every required category from the test script, plus 3 additional safety-language probes.

### Tests
`npx tsc --noEmit` clean. No test files run/modified in isolation this pass (the session's last full server run, 615/615, already covers all listed voice test files).

### Baseline document
`FITORA_VOICE_ASSISTANT_CURRENT_BASELINE.md` (repo root)

### Screenshot index
`qa-artifacts/voice-baseline/SCREENSHOT_INDEX.md`

### Source modifications
**No application source files or prompts were modified during this audit.** All writes were: this document, the screenshot index, ~26 screenshots under `qa-artifacts/voice-baseline/`, and temporary QA data created via the normal app API (a stress-test note, a water log, a water-goal change, and one real message sent to Coach Kumar during live confirmation-flow testing — all ordinary, reversible application data, not code).

### Top 10 factual voice observations
1. V1 is confirmed dead code (unreachable from the mobile client) despite still being live at its HTTP route.
2. Only 1 of 13 write intents (`send_coach_note`) requires explicit confirmation — a deliberate design choice, not an oversight.
3. A confirmed, reproducible bug: bare "Log 8" (or any RPE-only utterance) auto-executes, then fails server-side with `invalid_trainingCategory`, after already telling the user "Saving that now."
4. No differentiated handling exists for medical/high-risk language — such phrases become silent private notes or are rejected exactly like noise.
5. No audio is ever persisted anywhere in this pipeline; transcript text is stored in exactly one place, for at most 15 minutes.
6. Real Gemini (not a rule-based mock) is genuinely configured and used in this environment; confidence-gating and screen-context disambiguation both work as designed.
7. Deepgram STT/TTS are unconfigured in this environment — the live-verified voice path here is on-device speech recognition with OS-native TTS fallback.
8. Active Workout has zero dedicated voice intents — the most-cited future use case is entirely unimplemented today.
9. Error handling is almost entirely silent or genericized across every failure class — permission denial, STT failure, and network failure all produce either no message or the same generic banner.
10. Idempotency is real and server-enforced; undo-after-write does not exist anywhere in the codebase.
