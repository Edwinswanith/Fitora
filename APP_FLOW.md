# APEX — App Flow & Functionality Guide

A complete map of what this app is, how its pieces fit together, and what happens end-to-end for each role. Written from the actual code (routes, models, services, mobile screens) as of 2026-08-14 — treat it as a living document and re-check against the code if it's been a while.

---

## 1. What this app is

**APEX** is a multi-role sports academy coaching platform. A coach manages a roster of athletes; athletes log daily training data; guardians get read-only visibility into their linked athlete(s). The whole product exists to answer one question every day, for every athlete: **is this athlete ready to train, and does the coach need to intervene?**

- **Frontend:** Expo (React Native + expo-router) — one codebase that ships as a native iOS/Android app *and* exports to a static PWA/web build.
- **Backend:** Node.js + Express + TypeScript, MongoDB via Mongoose.
- **Auth:** JWT access + rotating refresh tokens, bcrypt password hashing, Google/Apple sign-in.
- **Three roles, one contract:** `coach`, `athlete`, `guardian` all talk to the same `/api/*` surface; role and scope are derived server-side from the JWT, never trusted from the client.

---

## 2. The non-negotiable rule: coach scope

> A coach only ever sees data for athletes explicitly assigned to them.

Every other design decision in this app is downstream of that rule. It's enforced in three layers on every request, all three of which must hold together:

1. **`requireAuth`** ([middleware/auth.ts](server/src/middleware/auth.ts)) — reads the access token from the `Authorization: Bearer` header (mobile) or an `accessToken` cookie (web fallback), verifies it, re-reads the user from Mongo (so a disabled/deleted user is rejected mid-session, not just at login), and sets `req.actor = { userId, role, academyId, isAcademyOwner }`.
2. **`loadScope`** ([middleware/coachAthleteAccess.ts](server/src/middleware/coachAthleteAccess.ts)) — resolves what the actor is allowed to touch: `assignedAthleteIds` for a coach (from active `CoachAthleteAssignment` rows), `linkedAthleteIds` for a guardian (from `GuardianAthleteLink`), `athleteProfileId` for an athlete (their own profile only).
3. **`requireRole(...)` + `requireAthleteAccess(param)`** — route-level gates. `requireRole` rejects the wrong role outright (`403 forbidden_role`); `requireAthleteAccess` loads the target `AthleteProfile` by URL param and checks it's inside the actor's scope before the handler ever runs.

The athlete router additionally **never trusts a client-supplied athlete id** — every write resolves to `req.actor.athleteProfileId` server-side, so an athlete literally cannot address another athlete's record even by tampering with the request body.

There is **no admin role**. It was removed by design. The only privileged capability is `User.isAcademyOwner` — a coach flag (not a role) that unlocks `GET/POST /api/coach/coaches` so an academy owner can provision other coaches. Everything else an "admin" might do is just normal coach-scoped CRUD.

---

## 3. Roles & what each one can do

| Role | Sees | Can write | Entry screen |
|---|---|---|---|
| **coach** | Only assigned athletes | Attendance, training plans, performance, comments, announcements, messages | `/coach/dashboard` |
| **athlete** | Only their own data | Wellness check-in, attendance, training completion, recovery, notes, RPE, water, heart rate, messages | `/athlete/dashboard` |
| **guardian** | Only linked athlete(s) | Nothing — fully read-only | `/guardian/dashboard` |

An **academy owner** is just a coach with `isAcademyOwner: true`; it adds one capability (`/coach/coaches`) and nothing else.

---

## 4. Account creation & onboarding flow

There is no self-service signup path except for athletes. Everyone else is provisioned top-down:

```
Bootstrap (CLI, one-time)
  └─ npm run create-owner --workspace server → first academy owner (coach, isAcademyOwner: true)

Academy owner (in-app, /coach/coaches)
  └─ creates other coaches in their academy

Coach (in-app, /coach/athletes/new)
  ├─ "Create new" → creates a User(athlete) + AthleteProfile + CoachAthleteAssignment, returns a one-time temp password
  ├─ "Link existing" → POST /api/coach/athletes/link {email} → attaches an already-self-registered, unassigned athlete
  └─ adds a guardian for an assigned athlete → User(guardian) + GuardianAthleteLink (reuses the account if that email already has one)
```

**The one self-signup exception:** athletes may register themselves.

- `POST /api/auth/register-athlete` (public, UI at `/register/athlete`) — email/password signup. Creates `User(role: athlete)` + `AthleteProfile` with **no coach and no academy**. The athlete is simply invisible to every coach until one of them links or creates them — the coach-scope invariant holds even for self-signup.
- `POST /api/auth/google` — first-time Google sign-in provisions an account per the role picked on the login screen (`athlete` by default, or `coach`; guardian self-signup is rejected). Existing users never change role; disabled accounts are never silently reactivated.
- Password self-signup stays **athlete-only** — coaches and guardians are always provisioned, never self-registered with a password.

Every provisioned account (coach, athlete, guardian) gets a one-time temp password to hand over and is nudged to set their own on first sign-in (`/account`).

---

## 5. Auth flow, in detail

```
Login screen (/login/[role]) — role picked from the landing page (index.tsx)
  ├─ Email + password → POST /api/auth/login
  ├─ "Sign in with Google" → POST /api/auth/google (ID token verified server-side against Google's tokeninfo endpoint: issuer, audience, email_verified)
  └─ Apple → POST /api/auth/apple (equivalent flow)
        ↓
Server: bcrypt-verifies password (or trusts the verified Google/Apple identity), issues:
  - accessToken (short-lived JWT)  → returned in the response body AND set as an HttpOnly cookie
  - refreshToken (longer-lived)    → HttpOnly cookie, scoped to /api/auth, SameSite=Lax, Secure in prod
        ↓
Mobile client (mobile/src/lib/api.ts): stores the access token in expo-secure-store,
  sends it as `Authorization: Bearer <token>` on every request — the cookie path is a web fallback.
        ↓
On 401: POST /api/auth/refresh rotates the refresh token and mints a new access token, transparently.
        ↓
GET /api/auth/me — used to hydrate the session on app start / role routing.
POST /api/auth/logout — clears cookies, unsets User.refreshTokenHash.
```

Rate limiting: **5 login attempts per IP per 60s** → `429 too_many_login_attempts`. Every response carries security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`). Mongo connection strings are redacted in logs. In production (non-local `MONGODB_URI`), the server refuses to boot unless JWT/sweep secrets are non-placeholder.

Account deletion: `DELETE /api/auth/account` ([accountDeletion.ts](server/src/services/accountDeletion.ts)) — self-service account removal, requires re-auth via `requireAuth`.

---

## 6. Domain model

15+ Mongoose collections, all under [server/src/models/](server/src/models/):

**Identity & relationships**
- `User` — role (`coach|athlete|guardian`), auth fields, `academyId`, `isAcademyOwner`
- `Academy` — the tenant boundary; tags data, doesn't gate access on its own
- `AthleteProfile` — keyed by `userId`; **`athleteId` everywhere else refers to this `_id`, not `User._id`**
- `CoachAthleteAssignment` — coach↔athlete link; `endedAt: null` = active
- `GuardianAthleteLink` — guardian↔athlete link

**Daily training data** (all keyed by `(athleteId, date[, slot])` with a unique compound index — so "create today's entry" and "edit today's entry" are the same upsert code path)
- `Attendance`, `TrainingSession` (AM/PM `slot`), `Wellness` (the daily check-in), `Recovery`

**Point-in-time / event data**
- `Performance`, `Injury`, `RpeMonitoring`, `WaterIntake`, `AthleteNote`, `CoachComment`, `Announcement`

**Communication & media**
- `Message` (coach⇄athlete threads), `Notification`, `NotificationPreference`, `NotificationDecision`, `DeviceToken`, `WorkoutMedia`

**Voice assistant state**
- `VoicePendingState`, `VoiceActionReceipt`

**Audit**
- `AuditLog`

---

## 7. Daily readiness & recovery scoring

The heart of the product ([services/dashboard.ts](server/src/services/dashboard.ts)):

- **Readiness (0–100):** derived purely from the day's `Wellness` check-in — sleep quality and mood contribute positively, stress/soreness/fatigue negatively. Averaged across whichever fields the athlete actually filled in; `null` if none were.
- **Recovery (0–100, green/amber/red):** a *separate* score, deliberately excluding mood/stress (those drive readiness, not recovery) so it isn't a clone. Built from sleep quality + sleep hours, low soreness, low fatigue, and wake heart rate when available. Used as a fallback when there's no measured `Recovery` record from a wearable or coach entry.
- **Daily cards** (`buildDailyCardsForAthletes`) merge `Attendance + TrainingSession + Wellness + Recovery + Performance + Injury` into one per-athlete summary per day — this is what renders on the coach dashboard, the athlete's own dashboard, and the guardian view. Same aggregator, three different scopes of who's allowed to call it.

---

## 8. Coach workflow (day in the life)

```
Sign in → /coach/dashboard
  ├─ KPI strip: assigned / present / sessions completed / avg readiness
  ├─ Per-athlete cards, risk-sorted: attendance, AM/PM session, readiness, soreness,
  │   recovery, injury flag, RPE risk
  ├─ Inline feedback composer → POST /coach/athletes/:id/comment (visible to that athlete)
  └─ Tap an athlete → /coach/athletes/[athleteId] (full detail: trends, activity, RPE, performance, messages)

Other coach surfaces:
  /coach/athletes           — roster (assigned only)
  /coach/athletes/new       — create-new vs link-existing athlete; add guardians
  /coach/coaches            — owner-only: list/create coaches in the academy
  /coach/announcements      — broadcast to the roster
  /coach/messages           — 1:1 threads with athletes
```

Coach write endpoints (all `requireAthleteAccess`-gated to assigned athletes): attendance, training-slot status, performance entries, RPE-adjacent comments, plus squad-level `analytics/squad` and a `notes-inbox` that surfaces athlete notes across the roster.

---

## 9. Athlete workflow (day in the life)

```
Sign in → /athlete/dashboard — single-column, mobile-first daily flow:
  1. Today's Schedule (AM/PM session, injury restriction if any)
  2. Daily Check-in (/athlete/check-in) — sleep, sleep quality, mood, stress, soreness, fatigue
       → drives the readiness score everywhere else in the app
  3. Attendance — Present / Late / Absent
  4. Training completion per slot — Completed / Partial / Missed
       (a coach can also photograph a workout plan; Gemini vision converts it to structured
       rows the athlete sees against — see §12)
  5. Recovery tracking — stretching, ice bath, mobility, physio, hydration
  6. RPE Monitoring (/athlete/rpe) — AM/PM RPE → computed training load + risk flag
  7. Water intake (/athlete/water) — logged glasses/ml, own analytics view
  8. Notes to coach — free text, shows up in the coach's notes-inbox
  9. Coach feedback — read-only, from the comment(s) the coach left
  10. Trends (/athlete/trends) — trailing readiness/load/sleep/recovery as sparklines
  11. Achievements — streaks on check-in / training / hydration / "all-rounder" goals
```

Every athlete write is scoped server-side to `req.actor.athleteProfileId` — the client cannot address another athlete even by editing the request. A `rest-day` endpoint exists for explicitly marking a planned day off (distinct from a missed session). Heart-rate logging (`POST /athlete/heart-rate`) feeds into the recovery score's wake-HR component when present.

---

## 10. Guardian workflow

Fully read-only, scoped to `GuardianAthleteLink`:

```
Sign in → /guardian/dashboard — picker across linked athletes
  → /guardian/athletes/[athleteId] — read-only daily card, trends, activity feed, coach comments
```

Any attempt to view a non-linked athlete returns `403 not_linked_guardian`. There are no guardian write endpoints at all.

---

## 11. Messaging

Coach⇄athlete 1:1 threads ([Message.ts](server/src/models/Message.ts)). A thread *is* the pair `(coachId, athleteId)` — there's no separate Conversation model. `senderRole` marks the author; unread while `readAt` is null.

- Coach side: `/api/coach/athletes/:athleteId/messages` + `/api/coach/messages/{threads,unread-count}` — assigned-only via `requireAthleteAccess`.
- Athlete side: `/api/athlete/messages/:coachId` + `/api/athlete/messages/{threads,unread-count}` — validates the coach is an **active** assignment (`403 coach_not_assigned` otherwise).
- Delivery is **client-poll**, not WebSocket/SSE. Reads are unthrottled; sends are rate-limited.
- Sending a message fires a best-effort `type: "message"` notification (see §12).

Mobile: [coach/messages.tsx](mobile/src/app/coach/messages.tsx), [components/MessageCenter.tsx](mobile/src/components/MessageCenter.tsx).

---

## 12. Notifications — a rules engine, not raw push

This is the most intricate subsystem, so it's worth walking through the pipeline:

```
Something happens (message sent, injury logged, reminder due, digest time, …)
        ↓
A NotificationCandidate is built: {type, category, priorityTier, dedupKey, title, body, ...}
        ↓
notificationEligibility.ts decides SEND or SUPPRESS, checking (per category):
  - user has notifications enabled + this category enabled
  - has an active device token
  - NOT in quiet hours (per-user timezone, via timezone.ts)
  - under the daily send cap
  - past the minimum interval since the last send
  - not suppressed by presence (user is actively in-app right now)
        ↓
Category-based gate skips (resolveGateSkips):
  - "messages" category (message/announcement/coach_feedback) → skips cap/min-interval/
     presence (user-initiated communication shouldn't get throttled like a reminder), but
     STILL respects quiet hours
  - override (severe injury_alert only) → skips ALL four gates — a safety alert doesn't wait
        ↓
notificationTemplates.ts / notificationCopy.ts generate the title/body
        ↓
fcmDelivery.ts sends via Firebase Cloud Messaging (no-op automatically if FCM_* env is unset —
  local dev works without any push credentials)
        ↓
Every decision — sent OR suppressed, with a reason — is written to NotificationDecision for audit
```

Categories: `reminders`, `alerts`, `deadlines`, `digests`, `milestones`, `messages` — each independently toggleable per user via `NotificationPreference` (`GET/PATCH /api/notification-preferences`).

The **sweep** ([notificationSweep.ts](server/src/services/notificationSweep.ts)) is the batch job that walks all eligible users and fires due reminders/digests. It's invoked via the `INTERNAL_SWEEP_SECRET`/`CRON_SECRET`-guarded `POST /api/internal/notifications/sweep`, which Vercel's `crons` config hits on a schedule through `backend/pages/api/cron/`. `presence.ts` (`POST /api/presence/heartbeat`) is what tells the eligibility engine a user is "actively in-app" for the presence-suppression gate.

Device tokens: `POST/DELETE /api/device-tokens` register/unregister a device for push.

---

## 13. Voice / Ask Agent

Two parallel pipelines, intentionally kept separate:

- **V1** — `POST /api/athlete/voice/interpret` (inside the main athlete router). Still live for backward compatibility.
- **V2** — mounted separately at `/api/athlete/voice/*` ([athleteVoiceV2.ts](server/src/routes/athleteVoiceV2.ts)), additive so it doesn't disturb V1. A mobile feature flag decides which pipeline the client calls.

Flow: [voice.ts](server/src/routes/voice.ts) wraps Deepgram for STT (`POST /transcribe`) and TTS (`GET/POST /speak`), plus a `/translate` step. The transcript goes to [voiceIntentInterpreterV2.ts](server/src/services/voiceIntentInterpreterV2.ts), which classifies intent (e.g. `open_screen`, `explain_app_field`, `show_*` read-only intents, or a write intent like logging a check-in) and extracts entities. [voiceIntentPolicy.ts](server/src/services/voiceIntentPolicy.ts) then turns that into an action:

- **Read-only intents** never require confirmation and never write anything.
- **Write intents** go through a `collect_fields → ready_to_confirm → execute` state machine (`VoicePendingState` persists the in-progress turn across the multi-turn conversation; `confirm_action`/`cancel_action`/`update_field` are meta-intents that operate on that pending workflow rather than starting a fresh one).
- A `today-checklist` endpoint (`GET /athlete/voice/today-checklist`) gives the assistant a structured view of what's outstanding for the day.
- Executed voice actions are recorded to `VoiceActionReceipt` for audit/undo context.

This is unrelated to the **AI Tour** ([routes/tour.ts](server/src/routes/tour.ts) + [tourNarrator.ts](server/src/services/tourNarrator.ts)) — a separate, scripted onboarding narration feature. Don't conflate the two.

---

## 14. Media & uploads

- **Avatars** — `/api/me/avatar*` ([routes/avatar.ts](server/src/routes/avatar.ts)): upload, set-default, delete, and an authenticated file-read (`GET /avatar/file`) — never a static URL.
- **Workout media** — coaches photograph a workout plan; when `GEMINI_API_KEY` is set, [workoutImageConverter.ts](server/src/services/workoutImageConverter.ts) uses Gemini vision to turn the photo into structured training rows (type/plan/intensity per slot). Without the key, this degrades to a mock so local dev still works.
- All uploaded files live outside any statically-served directory — every read is an authenticated, ownership-checked route (`/coach/media/:id/file`, `/athlete/media/:id/file`, `/athlete/training/:slot/photos/:id/file`), never a bare file URL.

---

## 15. Analytics, trends & activity feed

- **Trends** ([trends.ts](server/src/services/trends.ts)) — trailing per-day readiness/load/sleep/recovery series, exposed to all three roles (`GET /*/trends?days=7`) and rendered as dependency-free SVG sparklines in the mobile UI.
- **Activity feed** ([activity.ts](server/src/services/activity.ts)) — a merged, time-sorted timeline of sessions, RPE entries, check-ins, recovery logs, comments, notes, performance entries, and injuries. Same scope rules as everything else.
- **Analytics** ([analytics.ts](server/src/services/analytics.ts)) — deeper breakdowns: `athlete/analytics/{wellness,attendance,sessions,performance,water}` for self-analysis, `coach/analytics/squad` for roster-level rollups.
- **Achievements** ([achievements.ts](server/src/services/achievements.ts)) — streak tracking across four goal keys (`check_in`, `training`, `hydration`, `all_rounder`), each with a current streak, longest streak, and unlockable reward.

---

## 16. Mobile app structure

Expo Router, file-based routing under [mobile/src/app/](mobile/src/app/):

```
index.tsx                    # Landing — role picker (coach/athlete/guardian) → /login/[role]
login/[role].tsx              # Email+password or Google/Apple sign-in for the chosen role
register.tsx                  # Athlete self-signup
account.tsx                   # Profile, password change, account deletion
notifications.tsx             # In-app notification list

athlete/_layout.tsx
  dashboard.tsx  check-in.tsx  rpe.tsx  water.tsx  trends.tsx

coach/_layout.tsx
  dashboard.tsx  messages.tsx  announcements.tsx  coaches.tsx
  athletes/_layout.tsx  athletes/index.tsx  athletes/new.tsx  athletes/[athleteId].tsx

guardian/_layout.tsx
  dashboard.tsx  athletes/[athleteId].tsx
```

Shared client code lives in [mobile/src/lib/](mobile/src/lib/) (`api.ts` is the HTTP client — bearer-token attach, refresh-on-401, the `scp.user` profile cache used for role-based routing). **Before touching anything under `mobile/`, read [mobile/AGENTS.md](mobile/AGENTS.md) — the installed Expo SDK (v56) has changed and the versioned docs should be checked before writing Expo code.**

---

## 17. Deployment — two independent paths for the same server code

```
                         server/  (Express + Mongoose, the ONE source of truth for API logic)
                        /                                                              \
   API-only, Cloud Run                                              Combined web+API, one Vercel domain
   deploy.bat → server/Dockerfile                                    npm run vercel-build
   service: scp-server, project: coaching-467814                       1. exports mobile/ to static web → root public/
   secrets from env.server.yaml                                        2. symlinks root pages/ → backend/pages/
   → what EXPO_PUBLIC_API_BASE_URL points               3. backend/next.config.vercel.js becomes root next.config.js
     native mobile builds at by default                                4. next build from repo root
                                                          backend/pages/api/[...path].ts proxies everything into
                                                          the same Express app; the notification-sweep cron target
                                                          lives at backend/pages/api/cron/, wired via vercel.json
```

`apps/web/` and `apps/mobile/` are an older/alternate snapshot **not** wired into either build path above — don't assume changes there ship anywhere. Local API-only dev can also come up via `docker-compose.yml` (Mongo + API). Cloud Run/Vercel egress IPs must be allow-listed in MongoDB Atlas for the DB connection to succeed.

---

## 18. Testing

- **Server:** Jest + ts-jest + `mongodb-memory-server` (no external Mongo needed) — `npm test --workspace server`. Suites in [server/tests/](server/tests/) cover access control, coach dashboard/onboarding, the athlete/guardian workspaces, RPE/readiness, analytics/trends/activity, messaging, media, and the full notification pipeline (eligibility, FCM delivery, sweep, device tokens, preferences, injury alerts).
- **Mobile:** `npm test --workspace mobile` — focused Jest tests for Ask Agent report-intent parsing under `mobile/src/lib/__tests__/`.
- **Typecheck:** `npm run typecheck` (both workspaces).

---

## 19. Environment configuration

Copy `.env.example` → `.env`, `server/.env`, `mobile/.env`. Server config resolved in [server/src/config/env.ts](server/src/config/env.ts):

| Var | Purpose |
|---|---|
| `MONGODB_URI`, `PORT`, `CORS_ORIGIN` | Core server config |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL` | Auth tokens |
| `GOOGLE_CLIENT_ID` / `APPLE_CLIENT_ID` | Comma-separated allowed client IDs; empty disables that sign-in path |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | Workout-photo → structured table conversion (mocked if unset) |
| `FCM_PROJECT_ID` / `FCM_SERVICE_ACCOUNT_JSON` | Push delivery (no-op if unset) |
| `DEEP_GRAM` / `DEEPGRAM_*` | Voice STT/TTS (Ask Agent) |
| `INTERNAL_SWEEP_SECRET` / `CRON_SECRET` | Auth for the notification-sweep cron endpoint |

Every optional subsystem above degrades to a no-op or mock when its env var is unset, so local dev works with zero third-party credentials. If `MONGODB_URI` points somewhere non-local (Atlas or any remote host), the server refuses to start unless JWT/sweep secrets are real — remote DB implies real data, regardless of `NODE_ENV`.

Mobile reads `EXPO_PUBLIC_API_BASE_URL` (defaults to the deployed Cloud Run API).

---

## 20. Where the design authority lives

The full architecture, schema, RBAC matrix, API contract, and UI-flow spec that this codebase was built against lives in [skills/sports-coaching-platform-builder/](skills/sports-coaching-platform-builder/). New features should be checked against it before adding collections, endpoints, or screens.
