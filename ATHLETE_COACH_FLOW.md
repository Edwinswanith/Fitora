# Athlete ↔ Coach — Feature & Flow Deep Dive

Everything the **athlete** and **coach** roles can do, exactly how each endpoint behaves (validation, side effects, notifications), and the concrete scenarios that tie it together. Extracted directly from [server/src/routes/athlete.ts](server/src/routes/athlete.ts) and [server/src/routes/coach.ts](server/src/routes/coach.ts) — the two biggest routers in the app — plus their backing models. Guardian is out of scope here; see [APP_FLOW.md](APP_FLOW.md) for the full picture.

---

## 1. The relationship between the two roles

```
Coach  ──assigns──▶  CoachAthleteAssignment (endedAt: null = active)  ◀──belongs to──  Athlete
```

- One coach can have many athletes. Every coach route is pre-filtered to `req.actor.assignedAthleteIds` — a coach's queries are physically incapable of returning another coach's athlete.
- One athlete can (in principle) have more than one active coach — the athlete's `/announcements`, `/coaches`, and messaging endpoints all resolve **all** currently-active `CoachAthleteAssignment` rows, not just one.
- Every athlete write happens through `router.use(requireAuth, requireRole("athlete"), loadScope)` at the top of [athlete.ts](server/src/routes/athlete.ts) — `req.actor.athleteProfileId` is fixed for the whole request; nothing in the body can override it.
- Every coach write to a specific athlete goes through `requireAthleteAccess("athleteId")` — it loads the `AthleteProfile` for the `:athleteId` URL param and checks it's inside `assignedAthleteIds` **before the route handler runs**. If a coach's assignment to that athlete ever ends, every one of these routes starts 403-ing immediately, including on already-open media/messages.
- Coach writes are also rate-limited: a **global** `writeRateLimit` isn't applied blanket like on the athlete router — instead nearly every coach write route carries its own limiter (e.g. 20–60 requests/60s depending on the route), sized to the action.
- Athlete writes: a single blanket rate limit — **40 writes per 60s** — sits in front of every athlete POST after `/voice/interpret` (which gets its own more generous 120/60s limit because it never writes, just classifies speech).

---

## 2. Athlete — every feature, in depth

### 2.1 Profile — `GET/PATCH /api/athlete/me`

- `GET` returns the athlete's own profile merged with their `User` name/email.
- `PATCH` lets the athlete edit **only** personal fields — `name` (2–120 chars), `sport` (2–80), `position` (≤80, or clear it), `timezone` (1–64), `heightCm` (50–250 or clear), `weightKg` (20–250 or clear), `hydrationGoalMl` (500–8000, cannot be cleared), `dob` (must not be in the future, or clear it).
- Coach assignment, role, academy, and email are **never** editable here — those stay server-controlled. Every field is validated with an explicit range check before writing (Mongoose's `updateOne` skips schema validators, so this is the actual gate).
- **Scenario:** an athlete sets a wrong height by mistake → `PATCH /me {heightCm: 9999}` → `400 invalid_heightCm`, nothing is written. They fix it to `178` → `200`, profile updated.

### 2.2 Daily check-in — `POST /api/athlete/wellness`

The single most important write in the app — this is what readiness is computed from everywhere else.

- Body: `{ date?, sleepHours (0–14), sleepQuality (1–5), mood (1–5), stress (1–5), soreness (1–5), fatigue (1–5), note? }` — every field optional, only provided ones are set.
- Upserted into `Wellness` keyed on `(athleteId, date)` — submitting twice the same day **edits**, doesn't duplicate.
- **Side effect:** if `sleepQuality` was included, every guardian linked to this athlete gets a fire-and-forget notification ("`<name>` logged Sleep check-in") — never awaited, so a slow push send can't delay the athlete's own response.
- **Scenario:** athlete logs `{sleepQuality: 2, mood: 2, stress: 4, soreness: 4, fatigue: 4}` at 7am. Readiness ([dashboard.ts](server/src/services/dashboard.ts)) averages the positive/negative-normalized components → a low score, visible on their own dashboard and the coach's card within the same request cycle (no batch job, straight read-after-write).

### 2.3 Heart rate — `POST /api/athlete/heart-rate`

- Body: `{ date?, wakeHr?, bedHr? }`, both 25–220 bpm, at least one required.
- Upserts into the **same** `Wellness` row as the check-in, but each measurement keeps its own timestamp (`wakeHrAt`/`bedHrAt`) since they're taken at different times of day.
- Wake HR feeds directly into the **Recovery** score fallback (`computeRecovery` — lower wake HR = better recovery, clamped 40–80bpm range).

### 2.4 Hydration — `GET/POST/DELETE /api/athlete/water*`

- **Append-only**, unlike every other daily collection — `WaterIntake` is one document per log, not one upserted row per day, because hydration is logged many times a day.
- `POST /water` — `{ date?, amountMl (1–4000), clientActionId? }` → `201` with the day's updated total/goal/entries. Fires the same guardian notification pattern as wellness.
- **Idempotency:** if `clientActionId` is supplied (used by the voice assistant, which might retry a network call), the write is deduped via [`withIdempotency`](server/src/lib/voiceIdempotency.ts) — a retried request with the same id returns the same result instead of double-logging a bottle of water. Manual UI taps don't send an id and just write directly.
- `DELETE /water/:id` — undo a single entry (only the caller's own).
- `GET /water?date=` — day total vs `hydrationGoalMl` (defaults 3000ml), entries oldest-first.
- **Scenario:** athlete logs 500ml three times through the day → three `WaterIntake` docs → `GET /water` shows `totalMl: 1500` against a 3000ml goal. They tap "undo" on the last one → back to 1000ml.

### 2.5 Attendance — `POST /api/athlete/attendance`

- Body: `{ date?, status (present|absent|late|excused|rest), note? }` — upserted per `(athleteId, date)`.
- Also settable indirectly: completing a training session (§2.6) auto-marks attendance `present`, and `POST /rest-day` (below) sets/clears status `rest` specifically.

### 2.6 Rest day — `POST /api/athlete/rest-day`

- Body: `{ date?, enabled? (default true), note? }`. `enabled: true` upserts `Attendance.status = "rest"`; `enabled: false` **deletes** that row if it was `rest` (doesn't touch any other status).
- Deliberately reuses the `Attendance` collection rather than a separate flag, so history/rollups stay single-source-of-truth.

### 2.7 Training sessions — `GET/POST /api/athlete/training/:slot` (+ photos)

Three slots per day: `AM`, `AFT` (afternoon), `PM` — ordered by `SESSION_SLOT_ORDER`, not alphabetically (so "AFT" doesn't sort before "AM").

**Ownership split is the key nuance:** a `TrainingSession` document has coach-owned fields (`type`, `plan`, `durationMin`, `intensityRpe` — set only via the coach route, §3.7) and athlete-owned completion fields (`status`, `attended`, `workoutType`, `sets`, `reps`, `actualDurationMin`, `effortRating`, `notes`) — set only via this athlete route. Neither side can overwrite the other's fields through their own endpoint; both routes only ever `$set` their own subset.

- `POST /training/:slot` body: `{ date?, status?, attended?, workoutType?, sets? (0–200), reps?, actualDurationMin? (0–600), effortRating? (1–10), notes? }`.
- Setting `attended: true` **forces** `status` to `"completed"` regardless of what `status` was passed.
- **Cross-collection side effect:** if the resulting `attended === true` OR `status === "completed"`, the day's `Attendance` is auto-upserted to `present`. This is the app's way of saying "showing up to train IS attendance evidence" — the athlete never has to separately tap "Present" after finishing a session.
- `POST /training/:slot/photos` — multipart upload (field `file`), attaches a photo to that session; visible to the coach immediately, no "send" gate (contrast with coach-uploaded `WorkoutMedia`, §3.9, which IS gated behind an explicit send). Files are never served statically — every read goes through an authenticated, ownership-checked `GET .../photos/:photoId/file` route.
- **Scenario:** coach set an AM session's plan to "Tempo 6x400m" the night before. Athlete opens `/athlete/dashboard`, sees the plan, trains, then `POST /training/AM {attended: true, actualDurationMin: 42, effortRating: 7}` → session flips to `completed`, Attendance flips to `present`, both visible on the coach's dashboard on next refresh — no separate attendance tap needed.

### 2.8 Recovery — `POST /api/athlete/recovery`

- Body: `{ date?, modalities: string[] (from stretching/ice_bath/mobility/physio/hydration), note? }` — unrecognized modality strings are silently filtered out, not rejected.

### 2.9 Notes to coach — `POST/GET /api/athlete/notes`

- Append-only, idempotency-guarded the same way as water/messages (`clientActionId` optional).
- These are what populate the coach's **notes-inbox** (§3.5) across their whole roster — a note isn't buried in just that one athlete's activity feed.

### 2.10 Reading coach output — `GET /coach-comments`, `GET /announcements`

- `coach-comments?date=` — feedback the coach left that day (§3.3).
- `announcements` — resolves the athlete's **active** coach assignments first, then returns only those coaches' broadcasts (max 30, newest first). An athlete with zero active coaches gets `{announcements: [], coachCount: 0}` — no error, just empty.

### 2.11 RPE Monitoring — `POST/GET /api/athlete/rpe-monitoring`

The most heavily-derived write in the app — worth walking through the math fully ([lib/trainingCategories.ts](server/src/lib/trainingCategories.ts)).

**Input** (per `sessionType` AM/AFT/PM, upserted on `(athleteId, date, sessionType)`):
`trainingCategory` (one of 27 fixed categories — Endurance, Max Speed, Plyos, Olympic Lifts, Rehab, Ice Bath, etc.), `plannedIntensityPercent` (0–100), `rpe` (0–10, session RPE), `sleepQuality`/`muscleSoreness`/`fatigue`/`moodMotivation` (all 0–5), optional `restingHeartRate` (20–220), optional `bodyConditionFeedback` text.

**Derived on every save** (`deriveLoadAndRisk`):
- `calculatedTrainingLoad = plannedIntensityPercent × rpe`
- `readinessScore` = weighted 0–100: `(sleepQuality/5)*25 + (moodMotivation/5)*25 + ((5-fatigue)/5)*25 + ((5-muscleSoreness)/5)*25` → band **green ≥80, amber 60–79, red <60**
- `riskFlag`:
  - **RED** if `(rpe ≥ 8 AND fatigue ≥ 4)` OR `(muscleSoreness ≥ 4 AND fatigue ≥ 4)`
  - **AMBER** if `sleepQuality ≤ 2` OR `moodMotivation ≤ 2` OR `restingHeartRate ≥ 100` (only checked if a HR value was actually supplied)
  - **GREEN** otherwise
  - `riskReasons` is a human-readable list of exactly which rule(s) fired (e.g. `"RPE 9 with high fatigue 4"`)

**Notification side effect — this is the app's real-time coach alert:** if the saved entry's `riskFlag !== "green"`, **every currently-assigned coach** (not just one) gets a `readiness_risk_flag` push through the eligibility engine, `priorityTier: 2`, category `alerts`, deduped on the RPE row's own `_id` — so re-editing the same slot the same day never double-fires. The coach dashboard also denormalizes the athlete's single active coach onto the row (`coachId`) when there's exactly one.

- **Scenario:** athlete logs their PM session — `rpe: 9, fatigue: 4, muscleSoreness: 3, sleepQuality: 4, moodMotivation: 4`. `rpeFatigue = true` → `riskFlag: "red"`, reason `"RPE 9 with high fatigue 4"`. Every assigned coach instantly gets a push: *"Readiness risk flagged — [Athlete] — RPE 9 with high fatigue 4"*, linking straight to `/coach/athletes/:id`. If the athlete later edits the same PM entry to `rpe: 5`, the flag flips to green and no further push fires (dedup key hasn't changed, but the eligibility check re-evaluates the *current* flag, not a stale one — a re-save that's now green just doesn't meet the `!== "green"` condition).

### 2.12 Messaging — athlete side

- `GET /coaches` — every currently-active coach (id + name) so the athlete can start a conversation even before one exists (the threads list only shows coaches already messaged).
- `GET /messages/threads`, `GET /messages/unread-count`, `GET /messages/:coachId?before=&limit=`, `POST /messages/:coachId {body, clientActionId?}`, `POST /messages/:coachId/read`.
- **Every** per-coach route calls `assertAssignedCoach` first — resolves `:coachId` against the athlete's **active** assignments; a message to (or history request for) a coach who isn't currently assigned returns `403 coach_not_assigned`, even if a thread with old messages from before the assignment ended still technically exists in the DB.
- Sending is idempotency-guarded the same way as notes/water; `body` capped at 4000 chars.

### 2.13 Receiving coach media — `GET /media`, `GET /media/:id`, `GET /media/:id/file`

- Only `WorkoutMedia` rows where `sentAt` is set are ever visible to the athlete — an image the coach uploaded but hasn't explicitly sent yet **cannot leak**, and only the caller's own `athleteId` rows are returned (never client-suppliable).
- `GET /media/:id` includes the extracted workout table if the coach ran the image through the Gemini conversion (§3.9).

### 2.14 Self-analytics — trends / activity / achievements / analytics

- `GET /trends?days=7` (clamped) — readiness/load/sleep/recovery sparkline series.
- `GET /activity?limit=40` — merged, time-sorted feed of sessions/RPE/check-ins/recovery/comments/notes/performance/injuries.
- `GET /achievements?days=60` — four streak goals (`check_in`, `training`, `hydration`, `all_rounder`) each with current streak, longest streak, completion count, and an unlock state.
- `GET /analytics/{wellness,attendance,sessions,performance,water}?days=` — chart-ready series for the athlete's own dashboard graphs (`performance` clamps to a fixed 90-day window; the rest default 30, max 90).

### 2.15 Voice assistant NLU — `POST /voice/interpret`

- Classifies a spoken transcript into a structured intent + fields; **never writes to the database itself** — the mobile client performs the actual write via the normal endpoints above, after the athlete confirms out loud. This is why it sits outside the blanket write-rate-limit and gets its own generous 120/60s allowance (a multi-turn voice conversation needs many round-trips that aren't really "writes"). See [APP_FLOW.md §13](APP_FLOW.md#13-voice--ask-agent) for the full V1/V2 pipeline.

---

## 3. Coach — every feature, in depth

### 3.1 Roster — `GET /api/coach/athletes`

Returns every athlete currently assigned (name, email, sport, position, avatar) — empty array (not an error) if the coach has none yet.

### 3.2 Onboarding & provisioning

| Route | What it does | Notable behavior |
|---|---|---|
| `POST /athletes` | Create a brand-new athlete: `User(role:athlete)` + `AthleteProfile` + active `CoachAthleteAssignment`, all in one call | Returns a one-time `tempPassword`; on any failure mid-creation, partial `User`/`AthleteProfile` rows are rolled back manually (no DB transactions in this stack) |
| `POST /athletes/link` `{email}` | Attach an **existing**, self-registered, currently-unassigned athlete to this coach | No password returned (they already have one). If the athlete had no academy yet, they're silently adopted into the coach's academy. Already-active link → `409 already_linked` |
| `POST /athletes/:id/guardians` | Add a guardian for an assigned athlete | Reuses an existing `User(role:guardian)` account if that email is already a guardian (e.g. one parent, two kids) — only issues a new `tempPassword` for a brand-new guardian account |
| `GET/POST /coaches` (owner only) | List / create coaches in the owner's academy | Gated by `requireOwner` — `403 forbidden_not_owner` for a non-owner coach. New coaches are always `isAcademyOwner: false` |

Every provisioning action writes an `AuditLog` row (`athlete_created`, `athlete_linked`, `guardian_linked`, `coach_created`) — allow-decisions only; it never blocks the response even if the audit write itself fails.

- **Scenario A — fresh athlete:** Coach fills the "Create new" form on `/coach/athletes/new` → `POST /athletes {name, email, sport}` → `201` with `tempPassword`. Coach hands it over; athlete logs in, is nudged to `/account` to set a real password.
- **Scenario B — self-registered athlete:** Athlete used `/register/athlete` weeks ago and has been sitting unassigned/invisible. Coach flips to "Link existing" → `POST /athletes/link {email}` → `201`, athlete now shows up on the coach's roster with **no password reset needed** — they keep using the password they set at signup.

### 3.3 Dashboard & daily cards

- `GET /dashboard?date=` — one `buildDailyCardsForAthletes` call across the entire assigned roster; this is the data behind the coach's home screen (KPI strip + risk-sorted per-athlete cards).
- `GET /athletes/:id/daily-card?date=` — the same card for a single athlete (drill-in view).
- `POST /athletes/:id/comment {date?, body}` — coach feedback, immediately visible to the athlete via `GET /athlete/coach-comments`. Fires a `coach_feedback` notification (category `messages`, so it skips the daily cap/min-interval/presence gates but still respects quiet hours).

### 3.4 Injury logging — `POST /athletes/:id/injuries`

- Body: `{ bodyPart (required), description?, severity (mild|moderate|severe, required), restriction? }`.
- **Fans out to everyone who needs to know in parallel:** every currently-assigned coach for that athlete (not just the one who logged it — a squad can share athletes across multiple coaches) AND every linked guardian, each getting their own `injury_alert` notification.
- **Severe severity bypasses every throttle** (`override: true` on the eligibility candidate) — quiet hours, daily cap, minimum interval, and presence-suppression are all skipped. Mild/moderate injuries go through the normal `alerts`-category gates.
- **Scenario:** coach logs a `severe` hamstring injury during a 11pm evening session (inside quiet hours for most users). Every assigned coach and every linked guardian gets pushed **immediately** regardless of quiet hours — a safety-critical alert doesn't wait until morning. A `moderate` ankle tweak logged at the same time, by contrast, would queue behind quiet hours like a normal notification.

### 3.5 Squad-level views

| Route | Purpose |
|---|---|
| `GET /analytics/squad?days=30` | Per-day rollup across the **whole assigned roster**: avg readiness, attendance rate, avg load, red-flag count — the coach's team-health trendline |
| `GET /notes-inbox?days=14` | Every athlete note across the roster in one feed, with a needs-reply flag + open-count badge — so a note isn't buried inside one athlete's individual activity feed |
| `GET /athletes/:id/{trends,activity,analytics/*}` | Same per-athlete analytics the athlete sees about themselves, but from the coach's side, scoped by `requireAthleteAccess` |
| `GET /athletes/:id/notification-debug?limit=` | Sanitized push-delivery diagnostics for one athlete — masked device tokens, FCM config status, and recent `NotificationDecision` rows (sent/suppressed + reason). A support/debugging tool, not a user-facing feature |

### 3.6 Attendance & training plan (coach-owned side)

- `POST /athletes/:id/attendance` — same shape as the athlete's own endpoint, but coach-initiated (e.g. marking someone absent who never showed).
- `POST /athletes/:id/training/:slot {type?, plan?, status?, durationMin? (≥0), intensityRpe? (1–100), notes?}` — this is **the plan-setting route**; it only ever writes coach-owned fields (`type`, `plan`, `durationMin`, `intensityRpe`, plus shared `status`/`notes`), stamping `coachId` on the session. It never touches the athlete-owned completion fields from §2.7.
- `POST /athletes/:id/training/:slot/photos` — coach attaches a photo (e.g. a whiteboard shot) directly to a session's notes; visible immediately, same no-gate pattern as the athlete's own session photos (contrast with the gated `WorkoutMedia` flow below).

### 3.7 Performance logging — `POST/GET /athletes/:id/performance`

- Append-only: `{ date?, metric, value (number), unit, context? }` — no upsert, every entry is a new row (e.g. a 100m sprint time logged after every trial, not just once a day).
- `GET ?metric=&limit=` — history, optionally filtered to one metric, capped 1–200 rows.

### 3.8 Messaging — coach side

- `GET /messages/threads`, `GET /messages/unread-count` — across all assigned athletes.
- `GET/POST /athletes/:id/messages`, `POST /athletes/:id/messages/read` — all `requireAthleteAccess`-gated, so a coach can only ever reach threads for athletes currently assigned to them.

### 3.9 Workout media & the Gemini vision pipeline

This is the richest single feature on the coach side — six routes working together:

```
1. POST /athletes/:id/media  (multipart, context: athlete|workout|training_plan)
     → uploads a photo, NOT yet visible to the athlete
2. POST /media/:id/convert
     → runs services/workoutImageConverter.ts (Gemini vision if GEMINI_API_KEY set,
       else a mock) → extracts a structured table of exercise rows
3. PATCH /media/:id/table  { table: [...] }
     → coach corrects/fills in rows the OCR got wrong or left blank
     → REJECTED with 409 already_sent once step 4 has happened — frozen after the
       athlete has seen it
4. POST /media/:id/send  { caption? }
     → marks sentAt, and ALSO posts it as a chat message (with optional caption)
       in the same coach⇄athlete thread — one action, two visible effects
5. GET /media/:id/file        → coach's own view of the raw image
   GET /athlete/media/:id/file → athlete's view, only once sentAt is set
```

Every media-scoped route (`get/file/send/convert/table`) is double-gated in `loadOwnedMedia`: the requesting coach must literally be `media.coachId`, **and** `media.athleteId` must still be inside the coach's current `assignedAthleteIds` — if the assignment to that athlete ends, the coach instantly loses access to media they uploaded for them, consistent with the rest of the coach-scope invariant.

- **Scenario:** coach photographs a whiteboard with tomorrow's session written on it. Uploads with `context: "workout"`. Runs `/convert` → Gemini returns rows like `{exercise: "Back Squat", sets: 4, reps: "6", intensity: "80%"}`. The vision model missed the last row's reps — coach `PATCH /table` to fill it in. Satisfied, `POST /send {caption: "Tomorrow's lift — read the notes column"}` → the athlete immediately sees both the raw photo AND the structured table in their `/media` feed and as a chat message with the caption. If the coach tries to edit the table again after sending, they get `409 already_sent`.

### 3.10 Announcements — `POST/GET /api/coach/announcements`

- Broadcasts one message (≤1000 chars) to **every currently assigned athlete** in one call — creates one `Announcement` row plus a fanned-out `announcement` notification per recipient (category `messages`, so throttled only by quiet hours, not the daily cap).
- `GET /announcements` — the coach's own sent history (last 50), for reference, not delivery status.

---

## 4. End-to-end scenarios (cross-cutting)

### Scenario 1 — A normal training day
```
06:45  Athlete: POST /wellness  {sleepQuality:4, mood:4, stress:2, soreness:2, fatigue:2}
       → readiness computed high; guardian gets a "logged Sleep check-in" push
07:00  Athlete opens dashboard, sees coach's AM plan (set the night before via coach's
       POST /athletes/:id/training/AM {type:"Speed", plan:{...}, intensityRpe:75})
08:30  Athlete trains, then: POST /training/AM {attended:true, actualDurationMin:55, effortRating:6}
       → session → "completed", Attendance auto-set → "present"
08:35  Athlete: POST /rpe-monitoring {sessionType:"AM", rpe:6, fatigue:2, muscleSoreness:2,
                                       sleepQuality:4, moodMotivation:4, ...}
       → riskFlag: green (nothing crosses a red/amber threshold) → no coach push fires
09:00  Coach opens /coach/dashboard → sees this athlete's card: present, AM completed,
       readiness high, no risk flag — nothing needs attention
```

### Scenario 2 — Something's wrong, and the system catches it before the coach has to ask
```
21:40  Athlete, after a hard PM session: POST /rpe-monitoring
       {sessionType:"PM", rpe:9, fatigue:4, muscleSoreness:4, sleepQuality:3, moodMotivation:3}
       → rpe≥8 AND fatigue≥4 → riskFlag: "red", reason: "RPE 9 with high fatigue 4"
       → EVERY assigned coach gets a push instantly: "Readiness risk flagged — [Athlete] —
         RPE 9 with high fatigue 4" → deep-links to /coach/athletes/:id
21:41  `readiness_risk_flag` is category "alerts", which uses the default gate set (no
       skips) — so if the coach already has the app open, presence-suppression holds the
       push back (no point buzzing a phone that's already on-screen). The coach still
       notices the red flag live on /coach/dashboard, opens the athlete's card, and sends:
       POST /athletes/:id/comment {body: "Take it easy tomorrow, hydrate well tonight"}
       → athlete gets a coach_feedback push (messages category — skips cap/interval/presence,
         but still respects quiet hours) and sees it on their dashboard next refresh
```

### Scenario 3 — Injury during a session
```
Coach, mid-session: POST /athletes/:id/injuries
  {bodyPart:"Hamstring", severity:"severe", restriction:"No running for 2 weeks"}
  → Injury row created
  → EVERY assigned coach + EVERY linked guardian gets an injury_alert push,
    override:true → bypasses quiet hours/cap/min-interval/presence entirely —
    even a guardian who's set Do Not Disturb for the night still gets this one
  → Athlete's next GET /daily?date= includes the injury + restriction in their card
```

### Scenario 4 — A coach photographs a plan instead of typing it
```
Coach: POST /athletes/:id/media  (photo of a printed periodization sheet, context: "training_plan")
Coach: POST /media/:mediaId/convert  → Gemini extracts 6 rows of exercise/sets/reps
Coach: PATCH /media/:mediaId/table   (fixes 1 row the model misread)
Coach: POST /media/:mediaId/send {caption: "This week's block"}
  → athlete sees the image + editable-by-coach-only table + caption, all as one chat message
  → coach can no longer PATCH the table (409 already_sent) — it's now the athlete's record of truth
```

---

## 5. Validation cheat-sheet

| Field | Range | Where |
|---|---|---|
| `sleepHours` | 0–14 | Wellness |
| `sleepQuality`, `mood`, `stress`, `soreness`, `fatigue` | 1–5 | Wellness |
| `wakeHrBpm`, `bedHrBpm` | 25–220 | Wellness (heart-rate) |
| `amountMl` | 1–4000 | WaterIntake |
| `hydrationGoalMl` | 500–8000 | AthleteProfile |
| `heightCm` | 50–250 | AthleteProfile |
| `weightKg` | 20–250 | AthleteProfile |
| `sets` | 0–200 | TrainingSession (athlete) |
| `actualDurationMin` | 0–600 | TrainingSession (athlete) |
| `effortRating` | 1–10 | TrainingSession (athlete) |
| `durationMin` | ≥0 | TrainingSession (coach) |
| `intensityRpe` | 1–100 | TrainingSession (coach) |
| `plannedIntensityPercent` | 0–100 | RpeMonitoring |
| `rpe` | 0–10 | RpeMonitoring |
| `sleepQuality`/`muscleSoreness`/`fatigue`/`moodMotivation` (RPE) | 0–5 | RpeMonitoring |
| `restingHeartRate` | 20–220 (optional) | RpeMonitoring |
| message `body` | ≤4000 chars | Message |
| announcement `body` | ≤1000 chars | Announcement |

Every one of these is enforced in the **route handler itself**, not just the Mongoose schema — because every write here is an `updateOne({upsert:true})`, and Mongoose does not run schema validators on `updateOne` by default. Skipping the manual check would let an out-of-range value persist silently and quietly corrupt the readiness/risk math downstream.

---

## 6. See also

[APP_FLOW.md](APP_FLOW.md) — the full-app version of this document, covering guardian, notifications infrastructure, voice/Ask Agent, deployment, and testing.
