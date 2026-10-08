# Fitora Voice Assistant (Ask Agent): Performance and Reliability Audit

Date: 2026-10-08. Scope: the whole voice pipeline, athlete and coach, mobile and server, as it exists in the code today. Read-only analysis: nothing was changed. Every finding cites `file:line` (paths relative to `mobile/src/` or `server/src/` unless stated). Latency numbers are estimates from the code unless marked "measured"; the Gemini timings come from the earlier baseline audit (`FITORA_VOICE_ASSISTANT_CURRENT_BASELINE.md` §34, 8 samples) and should be re-measured after instrumentation (see §12).

Supersedes the parts of `FITORA_VOICE_ASSISTANT_CURRENT_BASELINE.md` it contradicts (that doc misses the missing Gemini timeout, the pending-state wipe on errors, the double auth chain, and overstates `clientActionId` reuse).

---

## Progress

- **2026-10-08: Phase 0 (instrumentation) and Phase 1 (P0-1 to P0-10) implemented.** Per-turn timings on mobile (`[voice:turn]`) and server (`[voice:interpret]` with `interpreterMs`, `latencyMs`, `failureReason`). Next: collect real timings, then Phase 2 (fast path, Gemini config, TTS).

## Executive summary

**Verdict: 🔴 Critical problems.** The core design is sound (the model only classifies; a deterministic, unit-tested policy decides what to do). The problems are in the plumbing around it:

1. **The microphone never turns itself off.** A voice conversation re-listens forever until the user taps; there is no end-of-conversation rule (`lib/voiceSession.ts:75-83, 122-136`).
2. **One Gemini call is ~85-90% of every turn's latency (~2.1-3.7 s measured), and it is made even for "yes", "no" and "cancel"**, with no timeout (`services/voiceIntentInterpreterV2.ts:258`).
3. **Failures lose work silently.** A Gemini error or an unrecognised utterance deletes the athlete's half-finished command (`routes/athleteVoiceV2.ts:107-110, 135-137`), and almost every failure is reported as "couldn't reach the server" or "I didn't catch that".
4. **Several flows are simply broken**: bare "RPE 8" fails after the app says "Saving that now"; a dismissed coach announcement stays armed and can be broadcast later by any sentence starting with "send"; the batch STT path records for a fixed 60 s; streaming STT can never work on the Vercel API.
5. **There is no visible feedback while the assistant works**: no live transcript, no "thinking" state, follow-up questions exist only as audio.

**What it feels like today** (native, English, warm server, "log 500 ml of water"): roughly **3.5-7 s from the end of speech to the first word of the reply**, then the mic reopens and keeps listening indefinitely. Tamil/Tanglish adds two more sequential Gemini translate calls (+1-3 s each). A cold Vercel start adds ~2.5 s.

**What it should feel like after the plan below**: common commands (water, meals, check-in, readiness, open screen, yes/no) answered in **~1-1.8 s** without calling Gemini; everything else in **~2-3 s**; live transcript on screen while speaking; the conversation ends by itself; no lost or duplicated writes.

**No rewrite is needed.** Every P0 and most P1 fixes are local changes to existing files.

---

## 1. Current voice assistant architecture

```
                        ┌─────────────── mobile (Expo) ────────────────┐
 _layout.tsx:103-104 →  AthleteAskAgentOverlay → AthleteAskAgentOverlayV2 ──┐
                        CoachAskAgentOverlay  (client-only regex router)   │
                                    │                                       │
                        AskAgentControl.tsx (FAB, text box, UI state)       │
                                    │ startVoiceConversation()              │
                        voiceSession.ts (STT loop, 3 audio paths)           │
                                    │ onResult(text) → onCommand(text)      │
                        useVoiceAssistant.ts (athlete state machine) ───────┘
                          ├─ POST /api/athlete/voice/interpret-v2
                          ├─ actionDispatch/actionMapping → REST writes
                          ├─ answerFetchers → REST reads
                          └─ reply string → agentSpeech.ts (TTS)
                        └──────────────────────────────────────────────┘
                        ┌─────────────── server (Express) ─────────────┐
 interpret-v2 → auth ×2 → VoicePendingState → Gemini (classify) → voiceIntentPolicy (deterministic) → pending upsert/delete
 /api/voice/transcribe (Deepgram batch) · /api/voice/stream (Deepgram WS, Node server only) · /api/voice/speak (Deepgram TTS) · /api/voice/translate (Gemini)
                        └──────────────────────────────────────────────┘
```

| Layer | Files | Role |
|---|---|---|
| Mount | `app/_layout.tsx:103-104` | Root-level overlay per role; never unmounts except on logout/role change |
| Button/UI | `components/AskAgentControl.tsx` | FAB, text box, labels (Listening/Working/Speaking), long-press for text |
| Audio/STT | `lib/voiceSession.ts` | Conversation loop; picks one of 3 STT paths |
| TTS | `lib/agentSpeech.ts`, `lib/voiceTranslation.ts` | Deepgram TTS via audio player, expo-speech fallback, translate for non-English |
| Athlete brain (client) | `lib/voiceAssistant/*`, `components/voiceAssistant/*` | State machine, execute writes, fetch answers, confirmation card |
| Athlete brain (server) | `routes/athleteVoiceV2.ts`, `services/voiceIntentInterpreterV2.ts`, `services/voiceIntentPolicy.ts` | Gemini classification + deterministic policy; multi-turn state in `VoicePendingState` (15-min TTL) |
| Coach brain | `components/RoleAskAgentOverlays.tsx:120-719` | Entirely client-side regex router; no server NLU, no Gemini |
| Deprecated | V1 `/api/athlete/voice/interpret` (`routes/athlete.ts:98-131`), `askAgentReportIntents.ts`, `athleteAskNavigation.ts` | Not called by any production code |

**STT paths** (`voiceSession.ts:50-54`):
1. **On-device recognition** (production default on iOS and Google Android): `expo-speech-recognition` via `ExpoWebSpeechRecognition`, `continuous=false`, `interimResults=false` (`:276-277`); browser `SpeechRecognition` on web (`:353`).
2. **Deepgram streaming WebSocket** (`:433-554`): only if on-device is unavailable. Requires the long-running Node server (`server/src/index.ts:17-18`); **cannot work on Vercel** (`backend/pages/api/[...path].ts` handles no upgrades), and native builds point at Vercel (`mobile/eas.json`).
3. **Deepgram batch upload** (`:556-647`): fallback when streaming fails. Fixed 60 s recording, no silence detection.
4. **Text box**: on permission denial or systemic failure, or 3 s long-press.

The doc comment at `voiceSession.ts:46-49` says Deepgram streaming is primary; the code says on-device is primary.

---

## 2. End-to-end voice flow

### Athlete: "log 500 ml of water" (native, English)

| # | Stage | What happens | Mode | Typical time | Blocks next? |
|---|---|---|---|---|---|
| 1 | Tap | `press()` → `startVoice` → `startVoiceConversation` (`AskAgentControl.tsx:146-157`, `voiceSession.ts:56`) | sync | <50 ms | no |
| 2 | Mic start | Permission promise + `recognition.start()` (`voiceSession.ts:334`) | async | ~0.2-0.5 s (est.) | yes |
| 3 | Speech + endpointing | OS recognizer decides end of speech; no app-side silence threshold; no partials | streaming inside OS, single result | speech + ~0.5-1.5 s (est., OS-controlled) | yes |
| 4 | Final transcript | `onresult` joins results once (`:308-317`) → stop session (`:155`) | sync | <10 ms | yes |
| 5 | Normalize | `normalizeVoiceCommandForAgent` (`voiceTranslation.ts:11-26`); English skipped unless Tanglish regex | async | 0 (English) / 1-3 s (Gemini translate) | yes |
| 6 | Interpret | `POST /interpret-v2 {transcript, currentScreen}` (`useVoiceAssistant.ts:42-47`) | request/response | **2.2-3.9 s** (Gemini 2.1-3.7 s measured) | yes |
| 6a | ↳ server | auth ×2 (4 queries) → pending `findOne` → Gemini → policy → pending upsert/delete (`athleteVoiceV2.ts:39,92,104,106,122-137`) | all sequential | DB 20-90 ms same region, 200-500 ms cross-region | |
| 7 | Execute | `executeVoiceAction` → `POST /api/athlete/water` (`actionDispatch.ts:58-78`) | request/response | ~0.1-0.4 s (auth ×2 again + write) | yes |
| 8 | Cache sync | Patch dashboard cache (`AthleteAskAgentOverlayV2.tsx:98-100`) or ~13 background GETs for other intents (`:128-131`) | async | 0 blocking | no |
| 9 | TTS | `GET /api/voice/speak` → server buffers full Deepgram audio (`routes/voice.ts:204-208`) → player starts | request/response, not streamed | ~0.5-1.5 s to first audio (est.) | yes |
| 10 | Playback | Poll every 100 ms for finish (`agentSpeech.ts:50-69`) | async | reply length | yes |
| 11 | Re-listen | +300 ms (`voiceSession.ts:172-174`), new recognizer, loop forever | async | | |

**End of speech → first audio ≈ 3.5-7 s.** Gemini is ~60-80% of it; TTS synthesis buffering and OS endpointing are most of the rest.

### Other flows

- **Question** ("what's my readiness"): interpret (2.2-3.9 s) → `GET /api/athlete/daily` (`answerFetchers.ts:18-29`) → TTS. The answer fetch cannot start until interpret returns.
- **Coach note** (only confirmation-gated intent, `voiceIntentPolicy.ts:102`): interpret → `GET /athlete/coaches` → TTS → user taps Save → interpret("yes") **through Gemini again** → `POST /messages/:coachId` → TTS. Six sequential round trips across two user actions.
- **Coach overlay**: no LLM. Regex routing; "readiness report" with no athlete named fetches `/api/coach/dashboard` **twice, sequentially** (`RoleAskAgentOverlays.tsx:473, 558`).

### Answers to the 10 per-stage questions (condensed)

| Question | Answer |
|---|---|
| Failure propagation | Almost all failures are flattened: interpret errors → "couldn't reach the server" (`useVoiceAssistant.ts:137`); Gemini errors → 200 `reject` "I didn't catch that" (`athleteVoiceV2.ts:107-110`); STT errors → silent re-listen (`voiceSession.ts:149-151, 183-186`); TTS errors → swallowed (`:167`). |
| User interrupts | Tapping the FAB stops the conversation and TTS (`voiceSession.ts:109`). A tap **before the TTS player exists** (during translate/synthesis) does not prevent the reply from playing afterwards (`agentSpeech.ts:100-102`). No voice barge-in. |
| User speaks again immediately | While processing: the mic is closed (single-shot recognizer); speech is lost. Typed commands while busy are dropped silently (`AskAgentControl.tsx:70`). |
| Parallelism | Only the nutrition answer runs 2 GETs in parallel (`answerFetchers.ts:57-60`). Everything else is strictly sequential, including the 6 DB round trips in interpret. |
| Unnecessary work | Auth runs twice per athlete request (`app.ts:110,114`; `athlete.ts:79`; `athleteVoiceV2.ts:39`); yes/no go through Gemini; Tanglish is translated by Gemini and then classified by Gemini again; full dashboard reload (~13 GETs) after many voice writes. |

---

## 3. Current implementation assessment

| Area | Rating | Why (code-based) |
|---|---|---|
| Responsiveness | 🔴 | No partial transcripts, no "thinking" UI, 3.5-7 s to first audio |
| Accuracy | 🟡 | Good design (temp 0, JSON schema, deterministic policy, 28 intents); but "RPE 8" fails, UTC dates near midnight, first-`is_final` cut-off on streaming (`voiceSession.ts:507`) |
| Reliability | 🔴 | Endless mic loop, stuck "Tap to stop" state, no Gemini timeout, pending workflow wiped on errors, stuck idempotency receipts |
| Streaming | 🔴 | No STT partials; streaming STT unusable in production; TTS fully buffered server-side |
| Latency | 🔴 | One unbounded Gemini call per turn including yes/no; no fast path; sequential round trips |
| Error handling | 🔴 | ~30 swallowing catch blocks; errors indistinguishable to user and in logs; DB outage in auth → 401 sign-out (`middleware/auth.ts:63-65`) |
| Interruption handling | 🟡 | Tap-to-stop works; no barge-in; late TTS after stop; full-screen layer blocks the app while listening (`AskAgentControl.tsx:190`) |
| Conversation flow | 🟡 | Server-side multi-turn state is a good design; but follow-ups are audio-only, client/server state diverge after an answer mid-collection |
| State management | 🔴 | 3 copies of "busy/listening" (React state, refs, closure); card actions bypass the submit lock; no turn ids |
| UI/UX | 🟡 | Clear FAB states; but no processing/collecting UI, fake volume glow on 2 of 3 paths, card has no timeout |
| Scalability | 🟡 | In-memory rate limiters per instance; per-process WS stream cap; cost scales with Gemini calls (incl. yes/no) |
| Maintainability | 🟡 | Athlete side well-factored and partly tested; coach side is a separate 870-line regex router; dead code (V1, report-intents, LISTENING event) |
| Resource usage | 🔴 | Hot mic indefinitely, recognizer listener leak (~4 per turn), orphaned recorders/streams, Android start-beep loop |

---

## 4. Latency and bottleneck analysis

| Rank | Bottleneck | Cost per turn | Evidence | Fix (section 10) |
|---|---|---|---|---|
| 1 | Gemini classification on every turn, incl. yes/no/cancel | 2.1-3.7 s (measured) | `voiceIntentInterpreterV2.ts:258`; mock regex classifier exists but only used without API key (`:285-453, 617-624`) | Deterministic fast path (P1-1), model config (P1-2) |
| 2 | Gemini config | unknown share of #1 | ~2.5k static input tokens/call (prompt ~5.4k chars + schema ~5.6k chars); no `thinkingConfig`, no `maxOutputTokens`, shared model with vision features (`env.ts:140-143`) | Cap thinking, cap output, dedicated fast model, context caching |
| 3 | TTS fully buffered before playback | ~0.5-1.5 s (est.) | `routes/voice.ts:204-208` | Stream the Deepgram body through; on-device TTS for short replies (P1-4) |
| 4 | OS endpointing, no partials | ~0.5-1.5 s perceived (est.) | `voiceSession.ts:276-277` | Show partials (P1-3) so the wait feels shorter; tune end-of-speech where platform allows |
| 5 | Sequential round trips (interpret → execute/answer → TTS) | 2 extra RTTs, ~0.2-0.8 s | `useVoiceAssistant.ts:70-129` | Server returns answer data / executes in the same call (P2-1) |
| 6 | Double auth + hidden limiter | 2 extra DB RTTs per request (more cross-region) | `app.ts:110,114`, `athlete.ts:79,148` | Mount V2 router before `athleteRouter` (P1-6) |
| 7 | Translate for Tanglish/Tamil | +1-3 s command, +1-3 s reply | `voice.ts:117-160`; prompt already handles Tanglish (`voiceIntentInterpreterV2.ts:184-186`) | Skip command translate; return reply in target language from templates (P2-5) |
| 8 | Cold start (Vercel) | ~2.5 s first request | `backend/pages/api/[...path].ts:27-54` | Keep-warm ping or Cloud Run min instances for voice (P2-7) |
| 9 | Inline FCM push in log-session when RPE flags risk | +push RTT | `athleteVoiceV2.ts:417-435` | Fire-and-forget after response (P2-8) |

**Targets:** fast-path turn ≤ 1.8 s end-of-speech → first audio (p50), Gemini turn ≤ 3 s, live transcript visible ≤ 300 ms after speech starts.

---

## 5. Bugs and reliability issues

Severity: 🔴 broken / data loss / privacy, 🟠 frequent frustration, 🟡 occasional.

| # | Sev | Bug | Where | User impact |
|---|---|---|---|---|
| B1 | 🔴 | Conversation never ends: 5-min silence window then auto re-listen; empty/no-speech also re-listens; unbounded | `voiceSession.ts:75-83, 122-136, 183-190`; `AskAgentControl.tsx:117` (`onTimeout` no-op) | Mic stays hot, battery drain, Android start-beep every few seconds, FAB stuck "Listening" |
| B2 | 🔴 | Gemini fetch has no timeout or abort | `voiceIntentInterpreterV2.ts:258-262` | A stall hangs the turn up to the 30 s client timeout (`api.ts:323`) |
| B3 | 🔴 | Gemini error or any `unknown_intent` deletes the pending workflow | `athleteVoiceV2.ts:107-110, 135-137`; `voiceIntentPolicy.ts:557` | Half-dictated meal/session silently lost; user hears "didn't catch that" |
| B4 | 🔴 | Bare "RPE 8": policy executes with only `rpe`, endpoint requires category + intensity → 400 | `voiceIntentPolicy.ts:350-351` vs `athleteVoiceV2.ts:518-527`; `actionMapping.ts:75-96` | App says "Saving that now", then fails, every time |
| B5 | 🔴 | Coach pending announcement/note never expires; closing the sheet doesn't clear it; any later "send…/yes/do it" fires it; every other command is blocked | `RoleAskAgentOverlays.tsx:643-663, 739` | Accidental squad-wide broadcast; assistant appears stuck |
| B6 | 🔴 | Coach chat memory key not user-scoped, survives logout | `RoleAskAgentOverlays.tsx:92, 305-323`; not cleared by `clearDataCache` (`fitoraData.ts:577-586`) | Next coach on the device sees previous coach's athlete names and notes (privacy) |
| B7 | 🔴 | Translate failure leaves conversation "active" without listening | `voiceSession.ts:176-178` | UI stuck on "Tap to stop" with the screen blocked by the dismiss layer |
| B8 | 🟠 | Voice "yes" + tapping Save → two concurrent executes with different `clientActionId` | `useVoiceAssistant.ts:52-53, 154-162`; non-atomic pending read/delete `athleteVoiceV2.ts:92, 135-137` | Duplicate coach messages |
| B9 | 🟠 | Batch STT: fixed 60 s recording; manual stop uploads but discards the transcript | `voiceSession.ts:633-635, 644, 148` | Voice unusable on devices without on-device recognition |
| B10 | 🟠 | WS streaming can't work on Vercel; every attempt fails handshake then falls to B9 | `voiceSession.ts:377-382, 435, 509-519`; `server/src/index.ts:17-18` | Same devices as B9 pay an extra failed handshake |
| B11 | 🟠 | Seven write intents have no idempotency key; keys discarded on failure; new UUID per retry | `actionMapping.ts:106,146,154,162,171,181,188`; `useVoiceAssistant.ts:53` | Timeout after server commit → duplicate recovery/rest-day/heart-rate logs |
| B12 | 🟠 | Handler failure leaves a stuck receipt; error results cached for 24 h | `lib/voiceIdempotency.ts:53-54`; `athleteVoiceV2.ts:557-560, 677` | Retries get 202 `pending` or replayed error for a day |
| B13 | 🟠 | Voice writes/answers send no `date`; server uses UTC day | `actionMapping.ts:114`; `answerFetchers.ts:19,42,70`; `athleteVoiceV2.ts:97, 223`; coach `today()` UTC `RoleAskAgentOverlays.tsx:91` | India users 00:00-05:30 get logs on the wrong day; checklist/readiness for wrong day |
| B14 | 🟠 | DB error in `requireAuth` returns 401 `invalid_token` | `middleware/auth.ts:63-65` | Mongo blip can sign the user out mid-command |
| B15 | 🟠 | Hidden 40/min limiter shared with all athlete writes applies to voice; test mounts only the V2 router so it doesn't catch it | `athlete.ts:148`; `tests/voice-interpret-v2.test.ts:23-28, 547-559` | Active users can hit 429 → shown as "couldn't reach the server" |
| B16 | 🟡 | TTS deadline ignores network/cold start; reply cut and restarted in a different voice | `agentSpeech.ts:37, 107` | Jarring double speech on slow networks |
| B17 | 🟡 | Buffering pause treated as "finished" | `agentSpeech.ts:58` | Truncated replies |
| B18 | 🟡 | `/transcribe` and `/speak` have no try/catch around Deepgram (Express 4) | `routes/voice.ts:88-105, 188-204` | Requests hang until client timeout |
| B19 | 🟡 | Streaming submits on first `is_final`; ~400 ms pause cuts the command | `voiceSession.ts:507` | Half-sentences sent |
| B20 | 🟡 | `send(CloseStream)` without readyState check | `voiceStream.ts:244` | Throws while Deepgram connects |
| B21 | 🟡 | `ConfirmationCard` edit fires on submit and blur | `ConfirmationCard.tsx:69-70` | Duplicate "change X to Y" turns |
| B22 | 🟡 | `router.replace` from inner screen stacks a second dashboard; "water" opens nutrition tab | `AthleteAskAgentOverlayV2.tsx:83-89` | Back button behaves oddly; wrong screen |
| B23 | 🟡 | Access token in WS URL; Gemini key in URL query | `voiceSession.ts:381`; `voiceIntentInterpreterV2.ts:254-256` | Secrets in proxy/access logs |

---

## 6. UX problems

1. **No live transcript.** Users can't see what was heard until the reply arrives (`interimResults=false`, `voiceSession.ts:277`; no partial callback in `VoiceSessionHandlers`, `:11-20`).
2. **No "working" state for card-driven turns, no UI for processing/collecting/executing** (`AthleteAskAgentOverlayV2.tsx:158-175`). After Save the card vanishes and nothing shows for up to ~30 s.
3. **Follow-up questions are audio-only.** Muted phone or failed TTS = invisible question.
4. **Errors are generic or invisible.** STT problems never surface; rate limits, server errors and client bugs all read "couldn't reach the server".
5. **The app is unusable while the mic is on**: a full-screen transparent layer swallows every tap (`AskAgentControl.tsx:190`). Combined with B1, voice mode blocks the app until tapped off.
6. **Fake volume glow** on the main path (constant 0.25, `voiceSession.ts:306`) and batch (pulse, `:629-632`) gives no real "I hear you" feedback.
7. **Stale screens after voice writes**: `/athlete/water` keeps local state and doesn't refresh (`water.tsx:147-169`); hydration reminder written to server but the screen reads AsyncStorage (`:176-180`).
8. **Confirmation card has no timeout** and persists across every screen, including where the FAB is hidden.
9. **Voice switch mid-reply** (B16) and **late speech after stop** (a tap during translate/synthesis still plays the reply).
10. **Coach and athlete feel like two different products**: coach has a chat log, athlete has none; coach confirmation is regex text, athlete is a card.

---

## 7. Concurrency and race-condition risks

| Risk | Where | Consequence |
|---|---|---|
| Card actions bypass `submitLockRef` | `useVoiceAssistant.ts:154-171` vs `AskAgentControl.tsx:70` | Parallel interpret calls; duplicate execute (B8) |
| No request cancellation; `fetchWithTimeout` overwrites caller `signal` | `api.ts:184` | Stale responses land in arrival order; impossible to cancel a superseded turn |
| No turn id / stale-response check | `useVoiceAssistant.ts` | A slow earlier turn can overwrite a newer state |
| Server pending state read-modify-write without compare-and-set | `athleteVoiceV2.ts:92, 123, 135` | Concurrent turns resurrect or overwrite workflows |
| Execute double-tap within 80 ms orphans a conversation (live mic, unstoppable) | `AskAgentControl.tsx:159-163` | Hot mic the UI can't stop |
| Stop during `setAudioModeAsync` leaves an `AudioStream` running | `voiceSession.ts:522-533` | Mic capturing with no owner |
| `failToBatch` can run twice | `voiceSession.ts:510 vs 519` | Two recorders |
| Native recognizer handlers never cleared; ~4 listeners leak per turn and old ones keep firing | `voiceSession.ts:303-332, 124` | Memory growth; ghost events filtered only by `seq` |
| Card-triggered TTS untracked while mic may be open | `useVoiceAssistant.ts:156,161,168` | Assistant transcribes its own voice |
| Quick re-listen hits `stream_already_active` | `voiceStream.ts:174-178` | Forced onto batch path |
| No unmount cleanup in `AskAgentControl` | `AskAgentControl.tsx:1` | Mic/TTS/timers survive logout |
| log-meal append-only, executes with different ids | `athleteVoiceV2.ts` log-meal | Duplicate meals |

---

## 8. State-management problems

1. **Three sources of truth for one thing.** "Busy/listening/speaking" lives in AskAgentControl React state, in refs, and in the voiceSession closure (`AskAgentControl.tsx:43-53`, `voiceSession.ts:58-59`); the assistant's `state.phase` is a fourth notion. They diverge: `onError` sets `listening=false` but the session restarts 180 ms later; card turns never set `busy`.
2. **Client/server workflow divergence.** An answer/navigate turn mid-collection wipes the client state (`state.ts:123-127`) while the server keeps the pending workflow; conversely the server deletes pending on error while the client thinks it can retry (`state.ts:129-130` "preserves the workflow" is not true end to end).
3. **`clientActionId` lives in a ref that is nulled before the request** (`useVoiceAssistant.ts:52-53`), so the documented "reused across retries" (`state.ts:33`) is false.
4. **Dead events and types**: `LISTENING` never dispatched (`state.ts:57,88`); `PendingIntentHint` never sent (`types.ts:52-57`).
5. **Coach state** (pending action in a ref, memory in AsyncStorage) has no expiry and no user scoping (B5, B6).

---

## 9. Recommended architecture

Keep the parts that are right: **model classifies, deterministic policy decides, server owns multi-turn state, writes are idempotent.** Change the plumbing around them.

```
 tap ──► VoiceController (single store: idle → listening → thinking → acting → speaking → idle/followup)
           │  turnId per turn, AbortController per turn, one lock for voice + typed + card input
           ▼
   STT: on-device recognizer, interimResults ON ──► live transcript bubble (≤300 ms)
           │ final transcript
           ▼
   POST /voice/turn {turnId, transcript, localDate, tz, screen, clientActionId}
     server: auth once ─► pending state (atomic) ─► Tier 1: deterministic matcher (yes/no/cancel, water, meals,
             check-in, readiness, open screen…) ─► Tier 2: Gemini (timeout 6 s, no thinking, fast model, cached prefix)
             ─► policy ─► execute write OR fetch answer data IN THE SAME REQUEST ─► reply text (templates, target language)
           ◄── {reply, action, data, followUpQuestion, uiPatch}
           ▼
   UI patch (cache update) + show reply text immediately
   TTS: short/common replies on-device (instant); longer replies streamed from Deepgram (first audio ~300 ms)
           ▼
   Follow-up window: re-listen ONLY if the reply asked a question; otherwise end after 6-8 s of silence
   Barge-in: tap anywhere on the voice bar stops TTS and listens (P3: voice barge-in with echo cancellation)
```

Key properties:

- **One round trip per turn** instead of 2-3; answers and writes happen server-side where the data already is.
- **Gemini only when needed**; expected to handle a minority of real traffic once the fast path covers the common phrases (verify with logs).
- **Every turn has an id and an abort**, so a new utterance cancels the old one cleanly.
- **Conversation ends by itself.** Follow-up listening only when a question was asked.
- **Same pipeline for coach and athlete** (coach intents added to the server policy), so fixes land once.

---

## 10. Prioritized improvement plan

### P0: Critical (broken or harmful behavior). Do first.

| ID | Problem → cause | Fix | Where | Expected gain | Trade-off |
|---|---|---|---|---|---|
| P0-1 | Endless listening (B1): re-listen loop has no exit | End the conversation after one turn unless the reply asked a question; follow-up window of ~6-8 s of silence; cap at N empty re-listens (e.g. 2) | `voiceSession.ts:75-83, 122-136, 183-190`; pass `silenceTimeoutMs` from `AskAgentControl.tsx` | Mic off when done; no beeps; battery | Users who chain commands tap again (acceptable) |
| P0-2 | Stuck "Tap to stop" (B7) | In the `.catch` at `:176-178`, re-listen or stop and reset UI | `voiceSession.ts:176-178` | No dead state | none |
| P0-3 | Gemini can hang (B2) | `AbortSignal.timeout(6000)`; one retry only on 5xx/429 with short backoff if time remains; log status/reason | `voiceIntentInterpreterV2.ts:258`; `athleteVoiceV2.ts:107` | Bounded worst case (~6-8 s) | Rare long-but-successful calls become errors |
| P0-4 | Work lost on errors (B3) | On interpreter error: keep pending state, return a distinct `action:"retry"` + "I had trouble, say that again"; on `unknown_intent` with pending: keep collecting | `athleteVoiceV2.ts:107-110, 135-137`; `voiceIntentPolicy.ts:464-483, 557` | Half-finished commands survive blips | Policy tests to update |
| P0-5 | "RPE 8" fails (B4) | Policy: `log_rpe` requires `trainingCategory` + `plannedIntensityPercent` (ask for them), or endpoint defaults them from today's planned session | `voiceIntentPolicy.ts:350-351`; `athleteVoiceV2.ts:518-527` | Command works | One more question for the user |
| P0-6 | Coach stale confirmation (B5) | Clear pending on sheet close and on any non-yes/no command; expire after 60 s; require exact "yes/confirm" (not "send…") | `RoleAskAgentOverlays.tsx:643-663, 739` | No accidental broadcasts | none |
| P0-7 | Coach memory leaks across accounts (B6) | Key by user id; clear in `clearDataCache`/logout | `RoleAskAgentOverlays.tsx:92, 305-338`; `fitoraData.ts:577-586` | Privacy fixed | none |
| P0-8 | Duplicate execute (B8) | Route card confirm/cancel/edit through the same lock as voice/typed; keep `clientActionId` until success; server uses atomic `findOneAndDelete` on confirm | `useVoiceAssistant.ts:52-53, 154-171`; `athleteVoiceV2.ts:92, 135` | No duplicate messages | none |
| P0-9 | Batch path unusable (B9, B10) | Don't attempt WS when API base is the Vercel host (or host `/voice/stream` on Cloud Run); batch: keep transcript on manual stop, add metering-based silence stop (~1.2 s) | `voiceSession.ts:377-382, 435, 592-647` | Voice works on devices without on-device STT | Metering threshold tuning per device |
| P0-10 | Orphaned mic/stream/recorder; no unmount cleanup | Lock execute restart; check `stopped` after every await in start paths; `useEffect` cleanup in AskAgentControl that stops conversation and TTS | `AskAgentControl.tsx:159-163, 1`; `voiceSession.ts:510-533, 578-622` | No ghost mic | none |

### P1: High (latency, reliability, UX)

| ID | Problem | Fix | Where | Expected gain | Trade-off |
|---|---|---|---|---|---|
| P1-1 | Gemini on every turn | **Tier-1 deterministic matcher before Gemini**: promote `MockVoiceIntentInterpreterV2` regexes (`voiceIntentInterpreterV2.ts:285-453`) into a fast path for yes/no/cancel/update, water amounts, readiness/hydration/checklist questions, open screen; call Gemini only if no confident match | `athleteVoiceV2.ts:104` | **-2 to -3.5 s** on common turns; lower cost | Regex coverage must be tested against a phrase corpus |
| P1-2 | Gemini config | Set `thinkingConfig` to minimal/0, `maxOutputTokens` (~256), dedicated `GEMINI_VOICE_MODEL` (Flash-Lite-class), trim schema descriptions, enable context caching for the static prefix | `voiceIntentInterpreterV2.ts:244-252`; `env.ts:140-143` | Likely -30-60% Gemini latency (measure) | Accuracy check on corpus |
| P1-3 | No live feedback | `interimResults: true`, add `onPartial` to `VoiceSessionHandlers`, show a transcript bubble; show "Thinking…" for processing/executing and the follow-up question as text | `voiceSession.ts:11-20, 276-277, 308-317`; `AthleteAskAgentOverlayV2.tsx:158-175` | Perceived latency drops sharply; muted users can follow | Slightly more renders |
| P1-4 | TTS latency and glitches | Stream Deepgram body to client (no buffering, `voice.ts:204-208`); speak short replies (<~80 chars) on-device immediately; deadline based on bytes received not text length; treat buffering ≠ finished | `routes/voice.ts`, `agentSpeech.ts:37, 58, 107` | -0.5-1.5 s to first audio; no voice switch | On-device voice differs from Deepgram voice (pick one per reply type) |
| P1-5 | Wrong day (B13) | Send `localDate` + IANA tz on every voice call and voice write; coach uses `dateKey()` local | `actionMapping.ts`, `answerFetchers.ts`, `useVoiceAssistant.ts:42-47`, `RoleAskAgentOverlays.tsx:91`, `athleteVoiceV2.ts:97, 223` | Correct day near midnight | none |
| P1-6 | Double auth + hidden 40/min limit (B15) | Mount `athleteVoiceV2Router` before `athleteRouter` in `app.ts`; add a `createApp`-level test | `app.ts:110-114`; tests | -2 DB RTTs/request; no surprise 429s | Verify V1 route still reachable or delete V1 |
| P1-7 | Errors flattened | Typed client errors: network / timeout / rate-limited / server / not understood, each with its own message; never show "couldn't reach the server" for a 429 or 400 | `useVoiceAssistant.ts:61, 93, 137`; `actionDispatch.ts:75` | Users know what to do; you can debug | none |
| P1-8 | Idempotency gaps (B11, B12) | `clientActionId` on all 13 write intents; keep it until success; receipts: on handler throw, delete the receipt (don't cache transient errors) | `actionMapping.ts`; `lib/voiceIdempotency.ts:53-54` | No duplicates, no 24 h stuck retries | none |
| P1-9 | Auth DB error → sign-out (B14) | Return 503 on DB errors, 401 only on token problems | `middleware/auth.ts:63-65` | No surprise sign-outs | none |
| P1-10 | Stale screens after voice writes | Water screen reads from the shared cache or subscribes to a "data changed" event; reminder setting read from server | `app/athlete/water.tsx:147-180`; `AthleteAskAgentOverlayV2.tsx:92-133` | What you said is what you see | none |
| P1-11 | Listener leak | Clear recognizer handlers and call `abort()` on every exit path | `voiceSession.ts:303-332, 124` | Stable memory | none |
| P1-12 | App blocked while listening | Replace the full-screen dismiss layer with a compact voice bar (stop button + transcript); let the user keep scrolling | `AskAgentControl.tsx:190` | App usable during voice | none |

### P2: Medium (architecture and robustness)

| ID | Change | Gain | Trade-off |
|---|---|---|---|
| P2-1 | **Single `/voice/turn` endpoint**: server executes writes and fetches answer data in the same request; returns reply text, data and a cache patch | -1 RTT per turn; idempotency server-owned; simpler client | Larger server change; keep `/interpret-v2` until clients migrate |
| P2-2 | **One `VoiceController` store** (phase, turnId, AbortController, transcript) replacing the three busy/listening copies | Correct UI; easy cancellation | Refactor of AskAgentControl + useVoiceAssistant |
| P2-3 | `apiFetch` accepts and merges caller `signal` (`api.ts:184`) | Real cancellation | none |
| P2-4 | **Coach on the server pipeline**: add coach intents to the policy; delete the 870-line regex router | Same quality both roles; one place to fix | Coach-scope invariant must be enforced in each coach intent (use `requireAthleteAccess` patterns) |
| P2-5 | Drop command translate (classifier already handles Tanglish); generate replies in target language from templates | -1-3 s ×2 for Tamil users | Template translations to maintain |
| P2-6 | Observability: per-stage timings (client: tap→listening, end-of-speech→final, →server, →first audio; server: auth, DB, Gemini, policy, execute), Gemini status codes, fast-path hit rate | You can prove each improvement | Log volume |
| P2-7 | Cold start: keep-warm cron/ping for the voice route, or route voice to Cloud Run with min instances | -2.5 s on first turn after idle | Cost |
| P2-8 | Move FCM dispatch in log-session after the response | Faster confirm | Notification may lag by ms |
| P2-9 | Atomic pending-state updates (version field / compare-and-set) | No resurrected workflows | none |
| P2-10 | Remove dead code: V1 route + interpreter, `askAgentReportIntents.ts`, `athleteAskNavigation.ts`, `LISTENING` event, stale comments | Less confusion | Old installs calling V1 (none found in client) |

### P3: Nice to have

| ID | Idea | Note |
|---|---|---|
| P3-1 | Voice barge-in (speak over the reply to interrupt) | Needs echo cancellation; on-device recognizer during playback; test heavily |
| P3-2 | Streaming STT on Cloud Run with Deepgram, smarter endpointing (wait for `utterance_end`, not first `is_final`) | Only worth it if on-device accuracy is a proven problem |
| P3-3 | Speculative prefetch: when the partial transcript already matches a read intent, start the data fetch before the final | Saves ~100-400 ms |
| P3-4 | Earcons + haptics on listen start/stop and success | Native feel at near-zero cost |
| P3-5 | Pre-generated audio for the top ~30 fixed replies | Instant replies in the brand voice |
| P3-6 | Per-user phrase learning (e.g. their usual meal names) | Accuracy |

---

## 11. Specific code/component changes

| File | Change (IDs) |
|---|---|
| `mobile/src/lib/voiceSession.ts` | End-of-conversation rule and empty-turn cap (P0-1); fix translate catch (P0-2); WS gating + batch silence stop + keep transcript on stop (P0-9); `stopped` checks after awaits, single `failToBatch` (P0-10); `interimResults` + `onPartial` (P1-3); clear recognizer handlers (P1-11); use `utterance_end` not first `is_final` (B19) |
| `mobile/src/components/AskAgentControl.tsx` | Unmount cleanup, execute-restart lock (P0-10); compact voice bar instead of full-screen layer (P1-12); real volume or no glow; route card-turn busy into the same state (P2-2) |
| `mobile/src/lib/voiceAssistant/useVoiceAssistant.ts` | Single lock for voice/typed/card turns, keep `clientActionId` until success (P0-8); typed errors (P1-7); send `localDate`/tz (P1-5); turn ids + abort (P2-2/2-3) |
| `mobile/src/lib/voiceAssistant/actionMapping.ts` | `clientActionId` + local `date` on every write (P1-5, P1-8) |
| `mobile/src/components/voiceAssistant/AthleteAskAgentOverlayV2.tsx` | Processing/collecting/executing UI, follow-up question text (P1-3); push `/athlete/water` instead of replace (B22) |
| `mobile/src/components/voiceAssistant/ConfirmationCard.tsx` | One submit path for edits (B21); timeout |
| `mobile/src/lib/agentSpeech.ts` | On-device for short replies, byte-based deadline, buffering ≠ finished, honour stop-before-start (P1-4) |
| `mobile/src/lib/api.ts` | Merge caller `signal` (P2-3) |
| `mobile/src/components/RoleAskAgentOverlays.tsx` | Expiring/cleared pending (P0-6); user-scoped memory cleared on logout (P0-7); local date; no duplicate dashboard fetch; later replaced by server pipeline (P2-4) |
| `mobile/src/app/athlete/water.tsx` | Read shared cache / refresh on voice writes (P1-10) |
| `server/src/services/voiceIntentInterpreterV2.ts` | Timeout + bounded retry + typed errors (P0-3); thinking/output caps, voice model, trimmed schema, caching (P1-2); key in header not URL |
| `server/src/routes/athleteVoiceV2.ts` | Preserve pending on error/unknown (P0-4); atomic confirm (P0-8); Tier-1 fast path (P1-1); local date/tz (P1-5); later `/voice/turn` (P2-1) |
| `server/src/services/voiceIntentPolicy.ts` | `log_rpe` required fields (P0-5); unknown-with-pending keeps collecting (P0-4) |
| `server/src/app.ts` | Mount voice router before `athleteRouter` (P1-6) |
| `server/src/middleware/auth.ts` | 503 on DB errors (P1-9) |
| `server/src/lib/voiceIdempotency.ts` | Delete receipt on throw; don't cache transient errors (P1-8) |
| `server/src/routes/voice.ts`, `voiceStream.ts` | try/catch around Deepgram; stream `/speak` body; readyState check (B18, B20, P1-4) |

---

## 12. Performance optimization strategy

1. **Measure first (day 1).** Add the timings in P2-6 before changing behavior. Log one structured line per turn on the server (`logVoiceEvent` already exists, `lib/voiceObservability.ts`) and one on the client. Without this you can't tell if a change helped.
2. **Remove work before speeding it up.** Fast path (P1-1) removes the Gemini call for common turns; mounting fix (P1-6) removes 2 DB round trips; single-endpoint turn (P2-1) removes 1-2 HTTP round trips.
3. **Make the remaining wait feel shorter.** Live transcript, "thinking" state, earcon on end-of-speech (P1-3, P3-4).
4. **Start output early.** On-device TTS for short replies, streamed Deepgram for longer ones (P1-4).
5. **Bound every wait.** Gemini 6 s, Deepgram 10 s, client turn budget ~10 s with a clear message, never a silent hang (P0-3, B18).
6. **Budget per stage (p50 target)**: listening visible ≤150 ms after tap; partial transcript ≤300 ms after speech starts; fast-path server ≤250 ms; Gemini path ≤1.5 s after P1-2 (verify); first audio ≤400 ms after reply text.

---

## 13. Testing strategy

**Unit (Jest, already set up for pure modules):**
- `voiceSession` with a fake recognizer/recorder/socket: start/stop at every await point, empty results, error codes, translate failure, conversation end rule, empty-turn cap, no orphan sessions after double start.
- `useVoiceAssistant` with mocked `apiJson`: voice "yes" + card Save in parallel → one execute; stale response after a newer turn → ignored; abort on new turn; `clientActionId` reused after a timeout.
- Fast-path matcher against a **phrase corpus** (≥200 real phrasings incl. Tanglish, numbers in words, "half a litre"); assert it agrees with the Gemini label or defers.
- Coach overlay: pending expiry, close clears pending, memory scoped per user.

**Server (`mongodb-memory-server`):**
- Gemini adapter: 429, 500, timeout (abort), empty body, bad JSON → pending preserved, typed error returned.
- `unknown_intent` with pending → still pending.
- `log_rpe` bare → collects fields.
- `createApp`-level test: voice routes authenticate once, not limited by the 40/min athlete limiter.
- Receipts: handler throws → retry succeeds; concurrent same id → one write.
- Local date/tz honoured near midnight (IST 00:30).

**Device matrix (manual, scripted):** iOS, Android with Google app, Android without Google speech (batch path), web Chrome, web Safari, web Firefox (text fallback), Tamil language, airplane mode mid-turn, permission denied, app backgrounded while listening, phone call during TTS, Bluetooth headset.

**Latency regression:** a script that replays recorded audio/text against staging and reports p50/p95 per stage; fail the build if p50 regresses >20%.

---

## 14. Voice interaction edge cases (all should have defined behavior)

- Silence after tap; only background noise; user coughs.
- User says "um… log… actually cancel".
- Speaks while the reply is playing (barge-in) / taps during "thinking".
- Two commands in one sentence ("log 500 ml and show my readiness").
- Numbers in words, units ("half a litre", "two glasses"), Tanglish ("water 500 ml podu").
- Says "yes" with nothing pending; says "no" during collection; edits a field by voice and by tap at once.
- Network drops mid-turn; server timeout after the write committed (idempotent retry must not duplicate).
- Token expires mid-turn (401 refresh) and during TTS GET.
- Command near midnight in a non-UTC zone.
- App sent to background while listening or speaking; incoming call; headphones unplugged.
- User navigates while a turn is in flight; logs out mid-turn; switches account.
- Mic permission revoked in settings between turns.
- On-device recognizer unavailable (non-Google Android) → batch path.
- Coach with zero clients; athlete with zero coaches ("send my coach a note").
- Very long utterance (>2000 chars → 400 `invalid_transcript`).
- Repeated identical command twice quickly (duplicate guard vs legitimate second glass of water).

---

## 15. Final recommended roadmap

| Phase | Duration (est.) | Contents | Exit criteria |
|---|---|---|---|
| 0. Instrument | 1 day | P2-6 timings client + server | Baseline p50/p95 per stage recorded |
| 1. Stop the bleeding | 3-4 days | P0-1 … P0-10 | Mic always ends; no stuck states; no lost/duplicated writes; "RPE 8" works; coach privacy fixed; tests above pass |
| 2. Cut latency | 3-4 days | P1-1 fast path, P1-2 Gemini config, P1-4 TTS, P1-6 mounting | Fast-path turn p50 ≤1.8 s, Gemini turn ≤3 s (measured) |
| 3. Feel native | 3 days | P1-3 live transcript + states, P1-12 voice bar, P1-7 errors, P1-10 screen refresh, P1-5 dates, P1-8/9/11 | Usability test: 5 users complete 10 commands each without confusion |
| 4. Consolidate | 1-2 weeks | P2-1 single turn endpoint, P2-2/2-3 controller + abort, P2-4 coach on server, P2-5, P2-7..10 | One pipeline for both roles; dead code gone |
| 5. Polish | as needed | P3 items, driven by the metrics | |

**Do phases 0-1 before anything else.** Faster replies don't help if the mic never turns off or a command quietly fails.
