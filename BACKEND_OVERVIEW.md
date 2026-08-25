# Fitora Backend — Complete Build Overview

One-stop reference for everything built in the backend across all phases: what exists, the complete MongoDB schema, how it's structured, how it actually works, what's currently mocked vs. live, and what's genuinely complete vs. still open. Written after Phase 11 (final audit + hardening). For day-to-day coding guidance, see [CLAUDE.md](CLAUDE.md) — this file is the fuller narrative + full database reference, organized phase-by-phase.

**Status at time of writing:** 49 Mongoose models across 15 domains, 29 Express routers, 560/560 server tests passing (56 suites), typecheck clean on both workspaces, every model's indexes verified live against the production Atlas cluster (database `Fitora`). Atlas is the only external provider currently configured with live credentials in this environment — Razorpay, LiveKit, Gemini, FCM, and Deepgram all currently run in their mock/no-op modes here (see §8).

**Table of contents:** 1) [What Fitora is](#1-what-fitora-is) · 2) [Stack & repo shape](#2-stack--repo-shape) · 3) [Non-negotiable invariants](#3-the-two-non-negotiable-invariants) · 4) [Design patterns](#4-recurring-design-patterns-used-throughout-not-just-once) · 5) [Phase-by-phase history](#5-phase-by-phase-build-history) · 6) [**Complete MongoDB schema**](#6-mongodb-database--complete-schema-reference) · 7) [API surface](#7-api-surface-29-routers) · 8) [Current state — providers/env/deployment](#8-current-state-of-the-app--providers-environment-deployment) · 9) [What "complete" means](#9-what-complete-means-here) · 10) [Known gaps](#10-known-gaps-honestly-not-swept-under-the-rug)

---

## 1. What Fitora is

A general-purpose fitness/nutrition/coaching platform, evolved from an original sports-academy app ("APEX"). Any user can use the app fully standalone (log workouts, track nutrition, monitor wellness) with **no coach required**. A paid coach is an **optional add-on**: workout/nutrition planning, messaging, live video sessions, monitoring, and a content library. Roles are strictly `coach | athlete` — no admin role, no guardian role (both existed in the original baseline and were removed by explicit product decision in Phase 1).

## 2. Stack & repo shape

- **Backend**: Express + TypeScript (strict mode) + Mongoose, MongoDB Atlas in production / `mongodb-memory-server` in tests.
- **Mobile**: Expo (expo-router, React Native), also exports to web/PWA.
- **Monorepo**: npm workspaces (`mobile` + `server`), plus a thin Next.js shim (`backend/pages/api/`) that exists only to proxy the Express app onto a single Vercel domain alongside the exported web build.
- **Auth**: JWT access + refresh tokens. Mobile sends a `Bearer` header (stored in `expo-secure-store`); web uses httpOnly cookies. Google and Apple Sign-In supported; password self-signup is athlete-only.
- **Two deploy paths**: Google Cloud Run (API-only, the default `EXPO_PUBLIC_API_BASE_URL` target) and Vercel (combined web+API on one domain).

## 3. The two non-negotiable invariants

**Coach scope.** A coach must only ever see data for athletes explicitly assigned to them. Enforced three ways, all three required: (1) `requireAuth` — JWT verify + live re-read of the user from Mongo; (2) `loadScope` — populates `req.actor.assignedAthleteIds` (coach) / `athleteProfileId` (athlete) from currently-active `CoachAthleteAssignment` rows; (3) `requireRole` + `requireAthleteAccess` — the route-level gate. **Critical nuance found and fixed in Phase 11**: this only proves an athlete is *currently* assigned to a coach — it says nothing about who authored a specific historical record (a workout assignment, a meal plan). Any route reading per-coach historical content must *also* filter by the creator field (`assignedBy`), or a coach who inherited an athlete from a prior relationship can read the previous coach's private program design. Two such leaks were found and fixed (see Phase 11 below).

**One primary coach at a time.** An athlete may have at most one **active** `CoachAthleteAssignment` — enforced at the database layer via a unique-partial index (`{athleteId:1}` where `status:"active"`), not just application logic. This is what makes coach-switching, subscription activation, and marketplace subscribe-flows all safely race-proof against each other.

## 4. Recurring design patterns (used throughout, not just once)

- **Snapshot-versioning.** A reusable template (`WorkoutTemplate`, `MealPlan`, `CoachPricingPlan`) carries a `version` that bumps on edit. An *assignment* of that template (`WorkoutAssignment`, `MealPlanAssignment`, `AthleteCoachSubscription.pricingPlanSnapshot`) copies the content at creation time. Editing the template later never mutates something already assigned/subscribed.
- **Derive, don't persist.** Computed states are never stored as their own field — `isExpiringSoon` on a subscription, `isVideoVisible` on content-library access — always recalculated at read time from the fields that actually changed.
- **AI-boundary pattern.** Any AI/vision output (Gemini workout-image conversion, meal-scan) goes: schema-constrained generation → defensive parse → sanitize (applied regardless of source, defense-in-depth) → human review/confirm gate → persist. Never auto-trusted.
- **External-provider adapter pattern.** Every third-party integration (Razorpay payments, LiveKit video) is an interface + a real fetch/JWT-based adapter (no vendor SDK dependency) + a fully offline mock adapter, resolved by a `getXProvider()` singleton based on whether the relevant env vars are set. Local dev and the full test suite run with zero live credentials.
- **DB-level concurrency guards, not app-level checks alone.** The one-primary-coach rule, the one-non-terminal-subscription-per-athlete rule, and the double-booking guard are all enforced by a unique index that a concurrent request cannot slip past — verified with real parallel HTTP requests in tests, not just unit tests of the guard function.
- **Idempotency via unique indexes.** Webhook replay protection (`PaymentWebhookEvent`, `Payment.providerPaymentId`) and voice-action dedup (`VoiceActionReceipt`) both use insert-and-detect-duplicate against a unique index rather than an application-level lock.

---

## 5. Phase-by-phase build history

### Phase 1 — Guardian removal, coach-optional, one-primary-coach
Removed the Guardian role entirely: `GuardianAthleteLink` model, `routes/guardian.ts`, every guardian branch in scope/notification code, the mobile `guardian/` screen group. `User.USER_ROLES` is now `["coach","athlete"]`. Extended `CoachAthleteAssignment` with `status`/`subscriptionId`/`endedReason` and added the one-active-coach-per-athlete unique-partial index. Fixed a real login-rate-limiter bug (`app.set("trust proxy", 1)` was missing, collapsing all clients behind a proxy into one shared rate-limit bucket).

### Audit — Phase 1 + pre-existing systems verification
Found and fixed 3 real P0 bugs before building further: (1) refresh-token rotation was completely non-functional — bcrypt truncates at 72 bytes, so every refresh JWT for a user shared an identical prefix past that point and `bcrypt.compare` always matched regardless of which token was checked (fixed with SHA-256 + `crypto.timingSafeEqual`); (2) Mongoose indexes built asynchronously, so the server could accept traffic before the safety-critical one-primary-coach index existed (fixed with an explicit `ensureIndexesReady()` await on startup); (3) a data-repair script bug that desynced `status`/`endedAt`.

### Phase 2 — Unified workout architecture
`WorkoutTemplate` (coach- or athlete-authored, versioned) → `WorkoutAssignment` (snapshots `exercisesSnapshot`+`templateVersionSnapshot` at assign time) → `ExerciseProgress` (per-set completion). Optionally links to the pre-existing `TrainingSession`/`RpeMonitoring` system via `slot`, so "today's workout" has exactly one execution path. `ExerciseMedia` is the coach-owned, reusable exercise-demo image/video (distinct from `WorkoutMedia`'s per-athlete photographed-plan flow).

### Phase 3 — Nutrition foundation
`NutritionTarget` (versioned — `effectiveFrom`/`effectiveTo`, one current target per athlete via unique-partial index) computed deterministically by `services/nutritionEngine.ts` (Mifflin-St Jeor BMR/TDEE, with a hard safety floor of 1200 kcal and a minimum of 1.0× BMR — never trusts a formula result blindly). `PlannedMeal` (planned) and `Meal`/`MealFood` (actually logged) are deliberately separate collections — confirming a plan creates a *new* `Meal`, never mutates the plan. `MealScan`/`MealScanItem` is the AI-boundary-pattern vision flow for photographed meals.

### Phase 4 — Coach meal plans
`MealPlan` (coach-authored, versioned) → `MealPlanAssignment` (same snapshot discipline as workouts) → creates real `PlannedMeal` rows the athlete's existing Phase-3 endpoints already read. Allergy conflicts are a hard 422 block only for foods explicitly `allergenTags`-tagged; everything else is a non-blocking warning.

### Phase 5 — Coach marketplace
`CoachProfile` (bio, specializations, `avgRating`/`reviewCount` — dormant until Phase 10) lazily created on first profile access, `active:false` by default (never auto-listed without opt-in). `CoachPricingPlan` for pricing tiers. Marketplace browsing (`GET /api/marketplace/coaches`) is open to any authenticated user, backed by a single `$facet` aggregation (fixed a real pagination-corrupting bug where a price filter was applied after the DB-level skip/limit instead of before it).

### Phase 6 — Subscriptions and payments (Razorpay)
`AthleteCoachSubscription` (pricing snapshotted at subscribe time so a coach's later price change never affects an existing subscriber), `Payment` (`providerPaymentId` unique index is the actual webhook-replay guard), `PaymentWebhookEvent` (idempotency ledger, keyed by a hash of the raw body since Razorpay doesn't guarantee a stable per-delivery id). The coach-athlete relationship is only ever created from a **verified webhook** — never from checkout alone, never from any client-asserted "paid" flag. Feature entitlement (`checkFeatureEntitlement`) gates coach features by plan, but only when a relationship actually has a linked subscription — a free/legacy relationship stays fully unpaywalled, a convention reused by every later phase's entitlement checks.

### Phase 7 — Availability and booking
`CoachAvailability` (recurring weekly rules in the coach's own timezone) + `CoachAvailabilityException` (one-off overrides) resolve into bookable slots, with a hand-rolled UTC↔zoned-time conversion (`zonedMinuteToUtc`, no external tz library). `CoachSession` is the booking, with an embedded `events[]` audit trail. **The double-booking guard is the single most technically important piece of new code in the whole backend**: a naive "check for overlap, then insert inside a transaction" does *not* actually prevent a race (MongoDB's snapshot isolation only catches conflicts on the *same* document, and two concurrent bookings each insert a distinct new one). The real guard is `CoachSessionSlotLock` — booking a session also claims one lock row per 5-minute bucket it occupies against a unique index, so a second overlapping booking hits a hard DB conflict on its very first colliding bucket. Verified with real parallel HTTP requests against both an in-memory replica set and live Atlas.

### Phase 8 — Live video (LiveKit)
`CoachSession.videoRoomRef` is created lazily on the first join-token request, never at booking time. Hand-signed JWTs matching LiveKit's exact `AccessToken`/`VideoGrant` shape (no SDK dependency). A join token is only issuable for a confirmed session, within a window around the scheduled time, and (after Phase 11) only while the underlying relationship is still active.

### Phase 9 — Coach content library
`CoachVideo` — standalone educational content (not exercise-attached), with a 4-tier visibility model: `private` (coach-only), `selected_clients` (list membership *and* active relationship), `subscribers` (active relationship, reusing Phase 6's unpaywalled-if-no-subscription convention), `public_preview` (no relationship needed). Visibility is re-derived live on every request, never cached. `CoachVideoProgress` is a checkpointed (not per-tick) watch-progress upsert.

### Phase 10 — Coach switching and reviews
Built the relationship-ending primitive that hadn't existed until this phase — there was previously no API path to end a coaching relationship at all (only an indirect one via payment-webhook cancellation). `endRelationship` now immediately cancels any linked subscription (not the softer period-end cancel used for self-serve). `switchCoach` ends the current relationship and starts checkout with a new one in a single call. `CoachReview` — one review per relationship (DB-enforced unique index), **only reviewable once the relationship has ended** (confirmed product decision), edit-in-place only, no delete endpoint. `CoachProfile.avgRating`/`reviewCount` are now actually written, exclusively via server-side recompute — no route ever accepts a client-supplied aggregate.

### Phase 11 — Final full-system audit and hardening
Four parallel audits (security/scope across every route, notification integration state, cross-phase data-consistency, documentation staleness), then real fixes:
- **Two P0 cross-coach data leaks** (see the invariant note in §3) — a coach could read a previous coach's entire workout/meal-plan programming for a shared athlete. Fixed by scoping every historical read to `assignedBy`.
- **Account deletion cascade gap** — deleting a user cleaned up none of the 12 Phase 6–10 collections, leaving orphaned/dangling rows. Fixed with full cascade cleanup for both roles; this code path had zero test coverage before this pass and now has dedicated tests.
- **Session actions after relationship end** — a coach and athlete could still confirm/reschedule/complete a booking and even join a live video call together after their relationship had ended. Fixed with a live relationship-status check before every capability-granting action (cancel stays exempt, since cleanup must always be possible).
- **CLAUDE.md rewritten** — it was frozen at the pre-Phase-1 baseline and still described the removed Guardian role as current. The `skills/` blueprint docs (already stale before this project even started) each got a staleness banner.
- A notification type→category registry (`lib/notificationTypes.ts`) turned out to already exist since Phase 1 but was never consumed by any call site — extended with the Phase 6–10 candidate types, documented as not-yet-wired (a real gap, explicitly flagged rather than silently left undocumented).

---

## 6. MongoDB database — complete schema reference

All 49 collections, live on MongoDB Atlas (database name `Fitora`), Mongoose ODM. Every model uses `{ timestamps: true }` (a `createdAt`/`updatedAt` Date pair is omitted below per-model since it's universal). Field notation: `name: type — constraints/notes`. Indexes list every index actually declared in code (verified live against Atlas via `verify-indexes.ts` after every phase).

Quick-nav by domain:

| Domain | Models |
|---|---|
| Identity & academy | `User`, `Academy`, `AthleteProfile` |
| Coach↔athlete relationship | `CoachAthleteAssignment` |
| Training (baseline) | `Attendance`, `TrainingSession`, `Wellness`, `Recovery`, `Performance`, `Injury`, `RpeMonitoring` |
| Notes & comms | `AthleteNote`, `CoachComment`, `Announcement`, `Message` |
| Notifications | `Notification`, `NotificationPreference`, `NotificationDecision`, `DeviceToken` |
| Media (baseline) | `WorkoutMedia` |
| Voice / audit | `VoicePendingState`, `VoiceActionReceipt`, `AuditLog` |
| Workouts (Phase 2) | `WorkoutTemplate`, `WorkoutAssignment`, `ExerciseProgress`, `ExerciseMedia` |
| Nutrition (Phase 3) | `NutritionTarget`, `PlannedMeal`, `Meal`, `MealFood`, `MealScan`, `MealScanItem`, `Routine` |
| Coach meal plans (Phase 4) | `MealPlan`, `MealPlanAssignment` |
| Marketplace (Phase 5) | `CoachProfile`, `CoachPricingPlan` |
| Subscriptions & payments (Phase 6) | `AthleteCoachSubscription`, `Payment`, `PaymentWebhookEvent` |
| Availability & booking (Phase 7) | `CoachAvailability`, `CoachAvailabilityException`, `CoachSession`, `CoachSessionSlotLock` |
| Content library (Phase 9) | `CoachVideo`, `CoachVideoProgress` |
| Reviews (Phase 10) | `CoachReview` |

(Live video, Phase 8, added no model — it extended `CoachSession` with a `videoRoomRef` field.)

### Identity & academy

**Academy** (`academies`)
- name: String, required
- slug: String, required, unique, lowercase
- timezone: String, default `"UTC"`
- isActive: Boolean, default `true`

Indexes: `slug` unique.

**User** (`users`)
- email: String, required, unique, lowercase
- passwordHash: String, required (stripped from JSON output)
- role: String, required, enum `coach | athlete`
- name: String, required
- phone: String
- isActive: Boolean, default `true`
- isAcademyOwner: Boolean, default `false` — scoped coach capability, not an admin role
- mustChangePassword: Boolean, default `false` — set when a coach provisions a temp password
- refreshTokenHash: String (stripped from JSON output)
- appleSubject: String, unique, sparse — Sign in with Apple's stable identifier
- academyId: ObjectId → Academy
- avatarKind: String, enum `photo | default`
- avatarStoredFilename: String (stripped from JSON output)
- avatarMimeType: String
- avatarDefaultId: String, enum `male-1 | male-2 | female-1 | female-2`

Indexes: `email` unique, `role`, `appleSubject` unique+sparse, `academyId`.

**AthleteProfile** (`athleteprofiles`)
- userId: ObjectId → User, required, unique
- academyId: ObjectId → Academy
- dob: Date
- sport: String, required
- position: String
- heightCm, weightKg: Number
- timezone: String, default `"UTC"`
- hydrationGoalMl: Number, default `3000`, min 500, max 8000
- fitnessGoal: String, enum `lose_weight | maintain_weight | gain_weight`
- goalIntensity: String, enum `mild | moderate | aggressive`
- activityLevel: String, enum `sedentary | light | moderate | active | very_active`
- biologicalSex: String, enum `male | female`
- dietaryPreferences, allergies, cuisinePreferences: String[]

Indexes: `userId` unique, `academyId`, `sport`.

### Coach↔athlete relationship

**CoachAthleteAssignment** (`coachathleteassignments`)
- coachId: ObjectId → User, required
- athleteId: ObjectId → AthleteProfile, required
- assignedBy: ObjectId → User, required
- assignedAt: Date, default now
- endedAt: Date, default `null`
- status: String, enum `active | ended`, default `"active"`
- subscriptionId: ObjectId → AthleteCoachSubscription, default `null`
- endedReason: String, enum `user_switched | athlete_left | coach_ended | subscription_cancelled | subscription_expired`, default `null`

Indexes: `{coachId,endedAt}`; `{athleteId,endedAt}`; `{coachId,athleteId}` unique partial (`endedAt:null`); `{athleteId}` **unique partial (`status:"active"`) — the one-primary-coach enforcement mechanism.**

### Training (baseline)

**Attendance** (`attendances`) — athleteId, date, status(enum `present|absent|late|excused|rest`), note, recordedBy. Index: `{athleteId,date}` unique.

**TrainingSession** (`trainingsessions`) — athleteId, coachId, date, slot(enum `AM|AFT|PM`), type, status(enum `planned|in_progress|completed|skipped|rest`), plan(Mixed), durationMin, intensityRpe, attended, workoutType, sets, reps, actualDurationMin, effortRating, notes, photos[] (embedded: storedFilename, originalName, mimeType, sizeBytes, uploadedAt), workoutAssignmentId → WorkoutAssignment (links a session back to Phase 2's unified-workout system when started that way). Index: `{athleteId,date,slot}` unique.

**Wellness** (`wellnesses`) — athleteId, date, sleepHours, sleepQuality, mood, stress, soreness, fatigue (all 1-5 scales except sleepHours), bedHrBpm/bedHrAt, wakeHrBpm/wakeHrAt (twice-daily heart rate, independently timestamped), note. Index: `{athleteId,date}` unique.

**Recovery** (`recoveries`) — athleteId, date, restingHr, hrv, recoveryScore(0-100), status(enum `green|amber|red`), modalities[], note. Index: `{athleteId,date}` unique.

**Performance** (`performances`) — athleteId, date, metric, value, unit, context. Indexes: `{athleteId,metric,date}`, `{athleteId,date}`.

**Injury** (`injuries`) — athleteId, bodyPart, description, severity(enum `mild|moderate|severe`), status(enum `active|monitoring|cleared`, default `"active"`), restriction, startedAt(default now), clearedAt. Index: `{athleteId,status,startedAt}`.

**RpeMonitoring** (`rpemonitorings`) — academyId, athleteId, coachId, date, day, sessionType(enum `AM|AFT|PM`), trainingCategory(28-value enum), plannedIntensityPercent, rpe, bodyConditionFeedback, restingHeartRate, sleepQuality/muscleSoreness/fatigue/moodMotivation(0-5), calculatedTrainingLoad/riskFlag/riskReasons[]/readinessScore/readinessBand — the last five are **computed by a pre-validate hook** (`deriveLoadAndRisk`), never client-supplied. Index: `{athleteId,date,sessionType}` unique (prevents duplicate AM/PM per day) + 3 supplementary lookup indexes.

### Notes & comms

**AthleteNote** (`athletenotes`) — athleteId, date, body. Index: `{athleteId,date}`.

**CoachComment** (`coachcomments`) — athleteId, coachId, date, body. Index: `{athleteId,date}`.

**Announcement** (`announcements`) — coachId, academyId, body(max 1000), recipientCount (snapshotted send-time count, not live). Index: `{coachId,createdAt}`.

**Message** (`messages`) — coachId, athleteId (the pair *is* the thread, no Conversation model), senderRole(enum `coach|athlete`), body(max 4000, optional if mediaId set), mediaId → WorkoutMedia, readAt(null = unread). Indexes: `{coachId,athleteId,createdAt}`, `{coachId,athleteId,senderRole,readAt}` (fast unread scans).

### Notifications

**Notification** (`notifications`) — recipientUserId, type(free string, no enum), title, body, priority(enum `high|medium|low`), link, readAt, academyId. Indexes: `{recipientUserId,createdAt}`, `{recipientUserId,readAt}`.

**NotificationPreference** (`notificationpreferences`) — userId(unique), enabled, categories{reminders/alerts/deadlines/digests/milestones/messages, all Boolean default true}, quietHours{enabled, startMinute, endMinute — minute-of-day 0-1439 in the user's own local time, not UTC}, dailyCap, minIntervalMinutes (both null = fall back to env default), lastActiveAt(presence heartbeat target, defaults null not "now"), consecutiveIgnored. Lazy-created via upsert, no backfill.

**NotificationDecision** (`notificationdecisions`) — userId, category(6-value enum, same set as NotificationPreference), type, priorityTier, dedupKey **(the real send-mutex)**, status(enum `sent|suppressed`), suppressReason, deliveryResult{attempted,providerMessageIds[],errors[]}, sentTime, link, entityRef{collection,id}, academyId. Only permanent outcomes get a row — transient rejections (quiet hours, cap, etc.) write nothing so the dedupKey stays eligible next sweep. Indexes: `dedupKey` unique, `{userId,sentTime}`, `{userId,category,sentTime}`.

**DeviceToken** (`devicetokens`) — userId, platform(enum `android|ios|web`), token(unique, upsert target), appVersion, deviceName, osName, osVersion, lastSeenAt, disabledAt(soft-disable on FCM UNREGISTERED, never hard-deleted). Indexes: `token` unique, `{userId,disabledAt}`.

### Media (baseline)

**WorkoutMedia** (`workoutmedias`) — coachId, athleteId (always bound to one specific athlete, never a shared library), academyId, context(enum `athlete|workout|training_plan`), originalName, storedFilename(unique, server-generated, never the client's filename), mimeType(enum 4 image types), sizeBytes, sentAt(null = coach-only draft, set = visible to athlete), conversion{status(enum `none|pending|completed|failed`), table[] (name/sets/reps/distance/duration/intensity/notes rows), convertedAt, error}. Indexes: `storedFilename` unique, `{coachId,athleteId,createdAt}`, `{athleteId,sentAt,createdAt}`.

### Voice / audit

**VoicePendingState** (`voicependingstates`) — athleteProfileId(unique, at most one live doc per athlete), intent, entities(Mixed), missingFields[], lastTranscript(the ONLY raw transcript text persisted anywhere, overwritten every turn, never accumulated — no audio is ever stored). Indexes: `athleteProfileId` unique, TTL on `updatedAt` (default 900s/15min).

**VoiceActionReceipt** (`voiceactionreceipts`) — userId, clientActionId, route, resultSummary(Mixed) — the idempotency ledger for append-only voice writes (water, notes, messages); a duplicate-key hit on the unique index means "already ran," cached result returned instead of re-executing. Indexes: `{userId,clientActionId}` unique, TTL on `createdAt`.

**AuditLog** (`auditlogs`) — actorId, actorRole, academyId, action, targetType, targetId, outcome(enum `allow|deny`), reason, ip. Indexes: `actorRole`, `academyId`, `action`, `targetType`, `outcome` (all field-level), plus `{actorId,createdAt}`, `{outcome,createdAt}`, `{targetType,targetId,createdAt}`.

### Workouts (Phase 2)

**WorkoutTemplate** (`workouttemplates`) — ownerId → User, ownerRole(enum `coach|athlete`), name, description, exercises[] (embedded `workoutExerciseSchema`: title, type(enum `reps|sets_reps|duration|checklist`), sets, reps, durationSec, restSec, instructions, mediaId → ExerciseMedia, notes, order), version(bumps on edit), isArchived. Index: `{ownerId,isArchived,updatedAt}`.

**WorkoutAssignment** (`workoutassignments`) — templateId, templateVersionSnapshot, nameSnapshot, exercisesSnapshot[] (frozen copy at assign time — the snapshot-versioning mechanism), assignedTo → AthleteProfile, assignedBy → User, assignedByRole, scheduledDate, slot(enum `AM|AFT|PM`, optional), status(enum `scheduled|in_progress|completed|skipped`), trainingSessionId → TrainingSession, startedAt, completedAt. Indexes: `{assignedTo,scheduledDate}`, `{assignedBy,createdAt}`, `{assignedTo,scheduledDate,slot}` unique partial (slot must be a string).

**ExerciseProgress** (`exerciseprogresses`) — assignmentId → WorkoutAssignment, exerciseIndex, status(enum `not_started|in_progress|completed|skipped`), setsCompleted[] (embedded: setNumber, reps, weightKg, durationSec, completedAt), notes, completedAt. Index: `{assignmentId,exerciseIndex}` unique.

**ExerciseMedia** (`exercisemedias`) — coachId, originalName, storedFilename(unique), mimeType(enum, images + short video), kind(enum `image|video`), sizeBytes, durationSec. Index: `storedFilename` unique, `{coachId,createdAt}`.

### Nutrition (Phase 3)

**NutritionTarget** (`nutritiontargets`) — athleteId, goal/goalIntensity(enums shared with AthleteProfile), calories(800-6000), proteinG/carbsG/fatG, effectiveFrom, effectiveTo(null = current), calculationVersion, inputSnapshot{weightKg,heightCm,age,biologicalSex,activityLevel,goal,goalIntensity — full audit trail of what produced this target}. Index: `{athleteId}` unique partial (`effectiveTo:null` — exactly one current target), `{athleteId,effectiveFrom}`.

**PlannedMeal** (`plannedmeals`) — athleteId, date, mealType(enum `breakfast|lunch|dinner|snack`), source(enum `deterministic|ai_generated|coach_assigned`), name, foods[] (embedded `plannedFoodSchema` — name, quantity, unit, calories(≤5000), proteinG(≤500), carbsG(≤800), fatG(≤400), fiberG, allergenTags[] — this exact sub-schema is reused by Meal, MealScan-confirm, MealPlan, and MealPlanAssignment), routineId, mealPlanAssignmentId. Index: `{athleteId,date,mealType}` unique.

**Meal** (`meals`) — athleteId, date, mealType, source(enum `confirmed_from_plan|modified_from_plan|ad_hoc|meal_scan`), plannedMealId(null if ad-hoc — confirming a plan creates a NEW Meal, never mutates the plan), name, loggedAt. Index: `{athleteId,date,loggedAt}`.

**MealFood** (`mealfoods`) — mealId → Meal, name, quantity, unit, calories/proteinG/carbsG/fatG/fiberG, confidence(only set when traced from a MealScan). Index: `{mealId}`.

**MealScan** (`mealscans`) — athleteId, storedFilename(unique), originalName, mimeType, sizeBytes, status(enum `processing|needs_review|confirmed|rejected`), overallConfidence, suggestedMealName/Type, rawModelOutputRef(Mixed, audit-only, never trusted as-is), error, confirmedMealId. Index: `storedFilename` unique, `{athleteId,createdAt}`.

**MealScanItem** (`mealscanitems`) — scanId → MealScan, foodName, quantity, unit, calories/proteinG/carbsG/fatG/fiberG, foodConfidence, quantityConfidence. Index: `{scanId}`.

**Routine** (`routines`) — athleteId, startDate, durationDays(1-90), generatedBy(enum `deterministic|ai_generated`), plannedMealIds[], workoutAssignmentIds[] — deliberately a thin reference list, not a data-duplicating blob. Index: `{athleteId,startDate}`.

### Coach meal plans (Phase 4)

**MealPlan** (`mealplans`) — ownerId → User, name, description, durationDays(enum `1|7|14|30`), days[] (embedded: dayIndex, meals[] {mealType, name, foods[] — same `plannedFoodSchema`}), version, isArchived. Index: `{ownerId,isArchived,updatedAt}`.

**MealPlanAssignment** (`mealplanassignments`) — mealPlanId, mealPlanVersionSnapshot, nameSnapshot, daysSnapshot[] (frozen copy), durationDays, assignedTo, assignedBy, startDate, status(enum `active|cancelled`), plannedMealIds[] (the real PlannedMeal rows this assignment created), cancelledAt. Indexes: `{assignedTo,createdAt}`, `{assignedBy,createdAt}`.

### Marketplace (Phase 5)

**CoachProfile** (`coachprofiles`) — userId(unique), bio, philosophy, yearsExperience, certifications[], specializations[], languages[], coachingTypes[], nutritionSupport, verifiedStatus(enum `unverified|pending|verified`), avgRating(null until Phase 10 writes it), reviewCount, active(default `false` — never auto-listed). Indexes: `userId` unique, `{active,avgRating}`, `{active,specializations}`.

**CoachPricingPlan** (`coachpricingplans`) — coachId, name, monthlyPrice, currency, description, includedServices[], liveSessionsPerCycle, nutritionIncluded, workoutPlanningIncluded, messagingIncluded, priority, active, version, razorpayPlanId(cached provider-side plan id, created lazily on first subscription). Index: `{coachId,active,priority}`.

### Subscriptions & payments (Phase 6, Razorpay)

**AthleteCoachSubscription** (`athletecoachsubscriptions`) — relationshipId(null until webhook-verified activation), coachId, athleteId, pricingPlanId, pricingPlanSnapshot{name,monthlyPrice,currency,includedServices[],liveSessionsPerCycle,nutritionIncluded,workoutPlanningIncluded,messagingIncluded,version — copied at subscribe time}, provider(enum `razorpay`), providerSubscriptionId, status(enum `pending|active|payment_due|payment_failed|cancelled|expired`), currentPeriodStart/End, nextBillingAt, cancelAtPeriodEnd, cancelledAt. Indexes: `{athleteId}` unique partial (status in `pending|active|payment_due` — the simultaneous-subscribe race guard), `providerSubscriptionId` unique+sparse, `{coachId,status}`.

**Payment** (`payments`) — subscriptionId, provider, providerPaymentId **(unique — the actual webhook-replay guard)**, amount, currency, status(enum `pending|succeeded|failed|refunded`), periodStart/End, rawEventRef(Mixed, audit-only). Index: `providerPaymentId` unique, `{subscriptionId,createdAt}`.

**PaymentWebhookEvent** (`paymentwebhookevents`) — provider, providerEventId(a hash of the raw body when the provider gives no stable id), eventType, receivedAt. Index: `{provider,providerEventId}` unique.

### Availability & booking (Phase 7)

**CoachAvailability** (`coachavailabilities`) — coachId, dayOfWeek(0-6), startMinute, endMinute, timezone(coach's own IANA zone), sessionDurationMin, bufferMin. Index: `{coachId,dayOfWeek}`.

**CoachAvailabilityException** (`coachavailabilityexceptions`) — coachId, date, type(enum `unavailable|custom_hours`), startMinute, endMinute, reason. Index: `{coachId,date}` unique (one override per day).

**CoachSession** (`coachsessions`) — coachId, athleteId, relationshipId, type(enum `progress_review|workout_guidance|nutrition_review|form_check|consultation|general`), scheduledStart/End, bufferMin(snapshotted from the availability rule at booking time), status(enum `requested|confirmed|rescheduled|cancelled|completed|missed`), events[] (embedded audit trail: at, type, previousStart/End, actorId, note), coachNotes(private), summary(athlete-visible), videoRoomRef(Phase 8, created lazily). Indexes: `{coachId,scheduledStart}`, `{athleteId,scheduledStart}`.

**CoachSessionSlotLock** (`coachsessionslotlocks`) — coachId, bucketStart(5-minute grid), sessionId — **the actual double-booking guard**; a session claims one lock row per 5-minute bucket it (plus buffer) occupies. Index: `{coachId,bucketStart}` **unique — this is what makes concurrent overlapping bookings impossible at the DB layer**, `{sessionId}`.

### Content library (Phase 9)

**CoachVideo** (`coachvideos`) — coachId, title, description, category(enum `exercise_tutorial|full_workout|mobility|nutrition|recovery|coaching_tip|recorded_session|program`), visibility(enum `private|selected_clients|subscribers|public_preview`, default `"private"`), selectedClientIds[], originalName, storedFilename(unique), mimeType(enum 3 video types), sizeBytes, durationSec, isArchived. Indexes: `storedFilename` unique, `{coachId,isArchived,createdAt}`, `{coachId,visibility}`.

**CoachVideoProgress** (`coachvideoprogresses`) — videoId, athleteId, status(enum `not_started|viewed|completed`), progressPercent(0-100), lastPositionSec — checkpointed writes only, never per-tick. Index: `{videoId,athleteId}` unique (upsert target), `{athleteId,updatedAt}`.

### Reviews (Phase 10)

**CoachReview** (`coachreviews`) — relationshipId **(unique — the actual "one review per relationship" guard)**, coachId, athleteId, overallRating(1-5), subRatings{trainingQuality,communication,knowledge,responsiveness,valueForMoney — all optional 1-5}, body, editedAt(null until first edit — no delete endpoint exists). Index: `relationshipId` unique, `{coachId,createdAt}`.

## 7. API surface (29 routers)

| Prefix | Router(s) |
|---|---|
| `/api/auth` | `auth` |
| `/api/coach` | `coach`, `coachWorkout`, `coachMealPlans`, `coachProfile`, `coachAvailability`, `coachSessions`, `coachVideos`, `coachRelationship` |
| `/api/athlete` | `athlete`, `athleteWorkout`, `athlete/voice` (v2), `athleteSessions`, `athleteCoachVideos`, `athleteCoachRelationship`, `subscriptions`, `coachReviews` |
| `/api/athlete/nutrition` | `nutrition` |
| `/api/workout-templates` | `workoutTemplates` (shared coach/athlete) |
| `/api/marketplace` | `marketplace` |
| `/api/me` | `avatar` |
| `/api/notifications`, `/api/device-tokens`, `/api/notification-preferences`, `/api/presence`, `/api/tour`, `/api/voice` | baseline routers |
| `/api/internal/payments/webhook` | `paymentWebhook` (mounted **before** `express.json()` for raw-body HMAC signature verification) |
| `/api/internal/notifications` | `internalNotifications` (cron sweep) |

## 8. Current state of the app — providers, environment, deployment

### External providers: what's real vs. mocked right now

Every third-party integration degrades gracefully to a deterministic mock when its env vars are unset — nothing in local dev or CI ever requires live credentials.

| Provider | Purpose | Real when... | Mock behavior when unset |
|---|---|---|---|
| **MongoDB Atlas** | Primary database | `MONGODB_URI` set (always, even in dev — see below) | N/A — `mongodb-memory-server` is used instead for the entire test suite |
| **Razorpay** | Subscription payments (Phase 6) | `RAZORPAY_KEY_ID`+`RAZORPAY_KEY_SECRET`+`RAZORPAY_WEBHOOK_SECRET` all set | `MockPaymentProvider` — deterministic checkout refs, real HMAC-signed webhook payloads for test verification |
| **LiveKit** | Live video sessions (Phase 8) | `LIVEKIT_API_KEY`+`LIVEKIT_API_SECRET`+`LIVEKIT_URL` all set | `MockVideoProvider` — issues real, decodable JWTs against a fixed mock secret, tracks create/terminate calls for test assertions |
| **Google Gemini** | Workout-image → table conversion, meal-scan vision | `GEMINI_API_KEY` set | Deterministic placeholder conversion |
| **Firebase Cloud Messaging** | Push notification delivery | `FCM_PROJECT_ID`+`FCM_SERVICE_ACCOUNT_JSON` set | No-op adapter — in-app notification rows still write, push simply doesn't fire |
| **Deepgram** | Voice STT/TTS for the mobile Ask Agent | `DEEP_GRAM` (or `DEEPGRAM_API_KEY`) set | Voice routes are unreachable/inert without it — no mock exists for this one |
| **Google/Apple Sign-In** | OAuth identity | `GOOGLE_CLIENT_ID`/`APPLE_CLIENT_ID` set | That specific sign-in path is disabled; password auth (athlete-only) always works |

As of this writing, the actual `server/.env` on this machine has **Atlas configured and reachable** (verified live throughout every phase via `verify-indexes.ts` and per-phase `smoke-test-*.ts` scripts) — Razorpay, LiveKit, Gemini, FCM, and Deepgram are **not** configured, so those subsystems all currently run in mock/no-op mode in this environment. The code paths for the real adapters are fully written and unit-tested against their mock counterparts' identical interface, but have not been exercised against live Razorpay/LiveKit/Gemini/FCM/Deepgram sandboxes — that's the one category of verification genuinely outside what's been done so far (flagged, not hidden).

### Complete environment variable reference

Required (server refuses to start without them, or falls back to insecure dev-only defaults that are rejected outright once `MONGODB_URI` is a remote host):
`MONGODB_URI`, `MONGODB_DB`, `PORT`, `CORS_ORIGIN`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`, `INTERNAL_SWEEP_SECRET` (or `CRON_SECRET`).

Optional, each independently degrading to mock/no-op as described above:
`GOOGLE_CLIENT_ID`, `APPLE_CLIENT_ID`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `FCM_PROJECT_ID`, `FCM_SERVICE_ACCOUNT_JSON`, `DEEP_GRAM`/`DEEPGRAM_STT_MODEL`/`DEEPGRAM_TTS_MODEL`/`DEEPGRAM_STREAM_ENDPOINTING_MS`/`DEEPGRAM_STREAM_UTTERANCE_END_MS`, `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`/`RAZORPAY_WEBHOOK_SECRET`, `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`/`LIVEKIT_URL`.

Tuning knobs (all have sane defaults, rarely need overriding): `UPLOAD_DIR`, `MAX_UPLOAD_SIZE_MB` (default 8), `MAX_COACH_VIDEO_SIZE_MB` (default 250), `VOICE_PENDING_STATE_TTL_SECONDS`, `VOICE_ACTION_RECEIPT_TTL_SECONDS`, and roughly a dozen `NOTIFICATION_*` variables controlling sweep batch size, daily cap, quiet-hours defaults, and per-reminder-type local send times.

Mobile: `EXPO_PUBLIC_API_BASE_URL` (defaults to the deployed Cloud Run API).

### Deployment — two independent paths, same server code

1. **Google Cloud Run (API-only)** — `deploy.bat` builds `server/Dockerfile`, deploys standalone (service `scp-server`), secrets from `env.server.yaml` (never committed — copy from `env.server.yaml.example`). This is what mobile builds point at by default.
2. **Vercel (combined web+API, single domain)** — `npm run vercel-build` exports the Expo app to static web, symlinks in the Next.js proxy shim, and serves both the static site and `/api/*` (proxied into the same Express app, `bodyParser:false` so the Phase 6 payment-webhook raw-body signature check still works) from one domain.

Local-only: `docker-compose.yml` brings up Mongo + API for offline development. Cloud Run/Vercel egress IPs must be allow-listed in Atlas Network Access (this was, in fact, a real connectivity blocker hit and resolved during this build — the fix was adding the sandbox's egress IP to Atlas's IP Access List).

### Testing infrastructure

- **56 test suites, 560 tests**, all passing, run via `npm test --workspace server` (Jest + ts-jest, `--runInBand`).
- **`mongodb-memory-server`** (standalone, in-memory) backs almost every suite — no external Mongo needed to run the full suite locally or in CI.
- **`MongoMemoryReplSet`** (in-memory *replica set*, not standalone) is used specifically by the two suites that need to exercise a genuine multi-document Mongo transaction: `voice-log-session.test.ts` (baseline) and `coach-sessions-concurrency.test.ts` (Phase 7's double-booking guard) — a standalone `MongoMemoryServer` rejects transactions outright, so this is the only way to test that code path for real rather than only via its non-transactional fallback.
- **Live-Atlas verification, separate from the Jest suite entirely**: every phase's persistence logic was additionally proven against the actual production Atlas cluster via one-off, self-cleaning `server/src/scripts/smoke-test-*.ts` scripts (run with `npx ts-node src/scripts/smoke-test-<name>.ts`). Current smoke-test scripts: `smoke-test-workout.ts`, `smoke-test-nutrition.ts`, `smoke-test-coach-meal-plans.ts`, `smoke-test-subscriptions.ts`, `smoke-test-booking.ts`, `smoke-test-video.ts`, `smoke-test-coach-videos.ts`, `smoke-test-coach-switching-reviews.ts`. Each creates its own throwaway coach/athlete/data, exercises the real flow end-to-end, asserts against freshly-re-read (not cached) documents, then deletes everything it created.
- **`verify-indexes.ts`** — imports every model, calls `.init()` on each to force index creation, then dumps every index (name, key, unique/partial/sparse flags) for every collection. Run after every phase against live Atlas to catch index drift before it becomes a production surprise.

## 9. What "complete" means here

Every phase above shipped with: a build → test → live-Atlas-verify → commit cycle; a full server Jest suite pass; a clean `tsc --noEmit` on both workspaces; and, for anything persistence-relevant, a smoke test against the real database (see above). The booking-concurrency guard specifically has been proven against **real parallel HTTP requests**, not just unit-tested in isolation, on both an in-memory replica set and live Atlas.

## 10. Known gaps (honestly, not swept under the rug)

**Fixed in Phase 12** (product-completion/hardening pass — see the Phase 12 section below for full detail): notification wiring for subscriptions/booking/workouts/nutrition/content/reviews; booking cleanup on relationship end (open sessions now cancelled, slot locks released, coach-owned workout/meal-plan assignments withdrawn); `liveSessionsPerCycle` usage metering; the unsafe coach-switching ordering (old relationship no longer ends before new-coach payment is verified); the readiness-field naming collision on DailyCard; the stale-Razorpay-plan-after-price-edit bug; `maxSessionsPerDay`.

Remaining, still open:

- **No thumbnail upload** for content-library videos — the schema still has no dedicated field for it (the earlier claim of "the schema has room for it" was aspirational, not a reserved field — confirmed during the Phase 12 audit), and the upload endpoint doesn't exist yet.
- **Object storage is 100% local disk**, with no durable/cloud backend — confirmed a real, previously-undocumented production risk during the Phase 12 audit: on the Cloud Run deploy path, `UPLOAD_DIR` resolves inside the container's ephemeral writable layer, so every uploaded avatar/workout-photo/exercise-clip/content-library video is lost on redeploy, restart, or scale-to-zero. Phase 12 added `services/objectStorage.ts` (an `ObjectStorageProvider` interface + a `LocalDiskObjectStorageProvider` that formalizes current behavior, plus a startup warning when running production-bound with none configured) but did **not** migrate `media.ts`/`exerciseMedia.ts`/`coachVideo.ts` onto it or implement a real cloud-backed adapter — that migration, and a product decision on which cloud provider to target, is still open.
- **In-memory rate limiters** (`writeRateLimit`) won't survive horizontal scaling to multiple server instances — fine at current single-instance scale, flagged for whenever that changes.
- **Existing call sites don't import the notification-type registry for the pre-Phase-12 event types** — the 14 baseline (Phase 1) call sites still hand-inline their literal+category pairs, even though every Phase 2–10 type added since is consumed correctly. Low-risk, not retrofitted since nothing is broken.
- **Coach payout/settlement is not implemented** — by design, not oversight; see the Phase 12 report for what a real implementation would require (Razorpay Route, KYC, a product/legal decision).
- **Coach self-serve onboarding already works end-to-end** (signup → profile → pricing → availability → `POST /profile/activate`) using only existing routes — this was previously undocumented and read like a gap in the pre-Fitora-pivot framing of this file; confirmed working, not missing, during the Phase 12 audit.
