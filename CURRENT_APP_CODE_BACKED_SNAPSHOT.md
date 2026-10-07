# CURRENT APP CODE-BACKED SNAPSHOT: FITORA

**Audit Date:** 2026-09-23  
**Repository Workspace:** `d:\Fitora` (package: `sports-coaching-platform`)  
**Version:** App 1.0.25 (Android `versionCode` 28) | Root Workspace 0.1.0  
**Evidence Standard:** Strict source code inspection of active routes, models, services, components, and automated test suites.

---

# 1. Executive Summary

Fitora is an active, production-grade fitness, nutrition, and coaching platform built as an npm workspace monorepo. It connects two primary user roles—**Athletes** (self-directed or coached users) and **Coaches** (fitness professionals managing client rosters). The platform combines standalone daily habit tracking (workouts, meals, macros, hydration, wellness check-in, resting heart rate) with an optional coach marketplace, 1-on-1 scheduled sessions, video content libraries, and multi-channel communication.

The codebase is technically sound and fully verified:
- **TypeScript strict typecheck:** 100% clean across `server/` and `mobile/` (0 errors).
- **Backend test suite (`server/tests/`):** 61 passed suites, 615 passed tests, 0 failures.
- **Mobile test suite (`mobile/src/lib/__tests__/`):** 12 passed suites, 153 passed tests, 0 failures.
- **ESLint:** Clean on `mobile/` (0 errors, 1 pre-existing import warning).
- **Native Android APKs:** Generated and verified under `mobile/android/app/build/outputs/apk/` (`app-debug.apk` and `app-release.apk`).

---

# 2. What This App Currently Is

Based strictly on active source code (`mobile/src/`, `server/src/`, `backend/`):

- **Primary Product Domain:** A unified fitness, nutrition, and sports performance platform where end-users ("Athletes") can operate standalone or link with a paid/assigned coach.
- **Who Uses It:**
  1. **Athletes / End-Users:** Log workouts set-by-set, track meals via manual entry or Gemini AI photo scanning, record daily hydration, submit 5-scale wellness check-ins, record session RPE/training loads, browse the marketplace to hire coaches, join live video sessions, and view long-term progress analytics.
  2. **Coaches:** Maintain client squads, build workout templates, author multi-day meal plans, upload video exercise libraries, conduct scheduled video check-ins, review squad readiness and risk flags, and provide direct feedback.
- **Roles Present:** Strictly **`athlete`** and **`coach`**. The legacy `guardian` role and generic `admin` roles have been removed completely from active schemas and route trees.
- **Primary Problem Solved:** Answers daily whether an athlete is ready to train, tracks nutrition adherence against calculated Mifflin-St Jeor targets, and gives coaches squad-level decision support without administrative overhead.
- **Core User Journey:** Daily check-in $\rightarrow$ Readiness calculation $\rightarrow$ Training execution (set tracking + RPE) $\rightarrow$ Nutrition tracking (macros + water) $\rightarrow$ Coach oversight $\rightarrow$ Trend analysis.
- **Central Functionality:** Daily habit logging, Readiness scoring (0–100), Workout template assignment and execution, Nutrition engine & meal tracking, Coach-client scoping, and Coach marketplace with subscriptions.
- **Secondary Functionality:** Voice assistant (Deepgram STT/TTS + Gemini intent parsing), In-app video content library, LiveKit video call rooms, and Automated notification sweeps with FCM push.

---

# 3. Active Architecture

```text
               +-------------------------------------------------------+
               |                    Client Layers                      |
               |  - React Native / Expo Router (iOS & Android Native)  |
               |  - Static Web Export (Next.js / PWA on port 8082)     |
               +-------------------------------------------------------+
                                           |
                                           v
               +-------------------------------------------------------+
               |                API Client & Auth Layer                |
               |  - mobile/src/lib/api.ts (Bearer token injection)     |
               |  - mobile/src/lib/auth.tsx (expo-secure-store / JWT)  |
               |  - HTTP Cookies (Web) / Authorization Header (Mobile) |
               +-------------------------------------------------------+
                                           |
                    +----------------------+----------------------+
                    |                                             |
                    v (Standalone / Cloud Run)                    v (Vercel Serverless)
     +------------------------------+             +-------------------------------+
     |   Express API Entrypoint     |             |  Next.js Serverless Proxy     |
     |   server/src/index.ts        |             |  backend/pages/api/[...path]  |
     |   server/src/app.ts          |             +-------------------------------+
     +------------------------------+                             |
                    |                                             |
                    +----------------------+----------------------+
                                           v
               +-------------------------------------------------------+
               |               Express Application Engine              |
               |  - 29 Routers (routes/*.ts)                           |
               |  - Middleware: requireAuth, loadScope, errorHandler   |
               |  - Compression, CORS whitelist, Proxy trust           |
               +-------------------------------------------------------+
                                           |
                                           v
               +-------------------------------------------------------+
               |                 Database & Services                   |
               |  - MongoDB Atlas (Prod) / Mongo Memory Server (Test)  |
               |  - 50 Mongoose Models (models/*.ts)                   |
               |  - 43 Business Logic Services (services/*.ts)         |
               +-------------------------------------------------------+
                                           |
     +------------------+------------------+------------------+------------------+
     v                  v                  v                  v                  v
+----------+      +-----------+      +-----------+      +-----------+      +-----------+
| Razorpay |      |  LiveKit  |      | Google    |      | Deepgram  |      |  Google   |
| Payments |      |   Video   |      | Gemini AI |      | Voice/STT |      |    FCM    |
| (Mock/   |      |  Rooms    |      | Vision    |      | (Mock/    |      | Push      |
|  Live)   |      |  (Mock/   |      | (Mock/    |      |  Live)    |      | Delivery  |
+----------+      |   Live)   |      |  Live)    |      +-----------+      +-----------+
                  +-----------+      +-----------+
```

### Verified System Details:
- **Package Manager:** `npm` workspaces (`"workspaces": ["mobile", "server"]`).
- **Active Backend:** `server/src/app.ts` (Express 4.21 + TypeScript strict).
- **Active Mobile Client:** `mobile/src/app/` (Expo SDK 54, React Native 0.81.5, Expo Router 6.0).
- **Active Web Deployment:** `backend/pages/api/[...path].ts` handles API proxying on Vercel while Expo exports static web assets to `dist/`.
- **Database Engine:** MongoDB via Mongoose 8.9.

---

# 4. Roles

| Role | Purpose | Can View | Can Create/Edit | Entry Route |
| :--- | :--- | :--- | :--- | :--- |
| **`athlete`** | End-user tracking fitness, diet, recovery, and coach routines. | Own profile, own readiness, assigned & self-logged workouts, meal plans, water intake, assigned coach details, marketplace coaches, own trends. | Own profile, check-ins, RPE logs, heart rate, meals, water entries, chat messages, coach reviews. | `/athlete/dashboard` |
| **`coach`** | Sports coach / trainer managing athletes, plans, and marketplace profile. | Assigned squad athletes only, squad daily readiness cards, squad trends, coach content library, assigned routines, coach inbox. | Workout templates, meal plans, routine assignments, feedback notes, video uploads, pricing plans, availability rules, roster invitations. | `/coach/dashboard` |
| **`isAcademyOwner`** *(Flag on Coach)* | Academy owner bootstrapping other coaches (not a separate role). | Coach roster in the academy. | Create other coaches via `POST /api/coach/coaches`. | `/coach/coaches` (Accessible via profile) |

*Note: Guardian and Admin roles are completely absent from active codebase.*

---

# 5. Navigation Structure

### Athlete Navigation
Managed via `mobile/src/app/athlete/dashboard.tsx` with top app bar, persistent bottom navigation tabs, and child screen routes:

```text
Landing (/)
 ├── Register (/register) -> POST /api/auth/register-athlete
 └── Login (/login/athlete) -> POST /api/auth/login
       ↓
 Athlete Dashboard (/athlete/dashboard)
  │
  ├── [Tab: Today] (/athlete/dashboard?section=today)
  │     ├── Header & Date Banner
  │     ├── Today Alert Banner (Payments, Renewal, Check-in prompts)
  │     ├── Readiness Card (Ring score, 5-scale breakdown, Check In CTA)
  │     │     └── Navigates to -> /athlete/check-in
  │     ├── Today's Plan Card (Workout status, Meals logged/target, Coach tasks)
  │     ├── Active Workout Card (Progress bar, "Continue Workout" CTA)
  │     │     └── Navigates to -> /athlete/active-workout?assignmentId=:id
  │     ├── Nutrition Summary Card (Macro bars, calorie ring)
  │     ├── Split Card: Water (+250ml CTA) & Recovery (View CTA)
  │     │     ├── Quick add water (+250ml inline POST)
  │     │     └── Recovery view -> /athlete/trends
  │     ├── Coach Message Card (Reply CTA)
  │     ├── Tomorrow Preview Card
  │     └── Live Session Card (Join video room CTA)
  │
  ├── [Tab: Workouts] (/athlete/dashboard?section=workouts)
  │     ├── Segment: Today (Workout Hero, Exercise Preview, Upcoming, Recent)
  │     ├── Segment: Upcoming (List of future scheduled assignments)
  │     └── Segment: History (List of completed/past workouts)
  │
  ├── [Tab: Nutrition] (/athlete/dashboard?section=nutrition)
  │     ├── Calorie Ring & Goal Intensity Banner
  │     ├── Macro Summary (Protein, Carbs, Fat vs Target)
  │     ├── Action Buttons: "+ Log Meal" -> /athlete/log-meal | "Scan Food" -> /athlete/meal-scan
  │     ├── Planned Meals List (Confirm & Log CTA inline)
  │     ├── Logged Meals List (With food breakdowns)
  │     └── Water Intake Card -> /athlete/water
  │
  ├── [Tab: Coach] (/athlete/dashboard?section=coach)
  │     ├── State A: No Coach -> "Find a Coach" -> /athlete/coach-discovery
  │     └── State B: Active Coach Assigned:
  │           ├── Coach Hero (Bio, rating, specializations)
  │           ├── Upcoming 1-on-1 Session Card (Join Room CTA)
  │           ├── Assigned Workouts & Meal Plans status
  │           ├── Panels: Direct Message | Profile | Membership | Sessions | Videos | Reviews
  │           └── "Leave Coach" button (Destructive confirmation)
  │
  ├── [Tab: Progress] (/athlete/dashboard?section=progress)
  │     ├── Range Selector (7D / 4W / 3M)
  │     ├── Progress Goal Card (Weight progress)
  │     ├── Progress Week Card (Workout, nutrition, check-in adherence counts)
  │     ├── Weight Trend Sparkline
  │     ├── Readiness / Load / Recovery Chart Tabs (SVG sparklines)
  │     ├── Nutrition Adherence Card (Calorie & Protein adherence %)
  │     ├── Check-in Streak Card
  │     └── Coach Feedback History Card
  │
  └── [Bottom Nav: Profile]
        └── Pushes -> /account (Athlete profile edit, notification toggles, change password)
```

---

### Coach Navigation
Managed via Expo Router `Tabs` in `mobile/src/app/coach/_layout.tsx`:

```text
Landing (/)
 └── Login (/login/coach) -> POST /api/auth/login
       ↓
 Coach App Shell (Tabs in mobile/src/app/coach/_layout.tsx)
  │
  ├── [Tab 1: Home] (/coach/dashboard)
  │     ├── App Bar (Active clients count, Date)
  │     ├── Next Video Session Card (Countdown, Start Session / Room CTA)
  │     ├── Quick Metrics (Active Clients, Training Today, Risk Alerts)
  │     ├── Needs Attention / Risk Triage List (Filtered by high risk / soreness)
  │     │     └── Tap client -> /coach/athletes/:athleteId
  │     ├── Squad Daily Activity Feed
  │     └── Notes & Feedback Inbox
  │
  ├── [Tab 2: Clients] (/coach/athletes)
  │     ├── Filter Bar: All | Attention | Active | Membership
  │     ├── Search Clients Input
  │     ├── Athlete Roster Cards (Avatar, Name, Sport, Risk Badge, Sessions)
  │     │     └── Tap client -> /coach/athletes/:athleteId
  │     └── Action: "+ Add Client" -> /coach/athletes/new
  │
  ├── [Tab 3: Plan] (/coach/plan)
  │     ├── Top Action: "+ New Plan" / Plan Composer
  │     ├── Segmented: Assignments | Templates | Routines
  │     ├── Quick Create: Workout | Tasks | Meal Plan | Routine
  │     ├── Template Manager (WorkoutTemplate & MealPlan list)
  │     └── Active Routine Roster (Shows workout & meal plan assigned per athlete)
  │
  ├── [Tab 4: Content] (/coach/content)
  │     ├── Video Uploader (Upload MP4/MOV, category, visibility)
  │     ├── Category Filter Chips (Tutorial, Full Workout, Mobility, Nutrition, Recovery, etc.)
  │     ├── Video Library List (Featured Video + Video Rows with thumbnail)
  │     ├── Action Menus: Play Preview, Edit, Archive, Delete, Assign to Client
  │     ├── Tabs: Library | Assigned | Analytics
  │     └── Full-screen Video Player Modal (VideoPlayerModal)
  │
  ├── [Tab 5: Profile] (/coach/profile)
  │     ├── Coach Public Profile Card & Bio
  │     ├── Marketplace Visibility Switch (Active / Hidden)
  │     ├── Public Profile Preview Button
  │     ├── Pricing Plans Manager (Add / Edit subscription tiers)
  │     ├── Availability Windows (Working hours per day of week)
  │     ├── Availability Exceptions (Specific blackout dates or slots)
  │     ├── Client Reviews List
  │     └── Account Settings Link -> /account
  │
  └── [Hidden Stack Routes]:
        ├── /coach/athletes/:athleteId (Client detail: readiness, workouts, nutrition, trends, notes)
        ├── /coach/athletes/new (Create athlete with temporary password)
        ├── /coach/messages (Full chat center with image upload & OCR parsing)
        ├── /coach/announcements (Broadcast announcement composer)
        └── /coach/coaches (Academy owner bootstrap portal)
```

---

# 6. Complete Active Screen Inventory

| Role | Screen | Route | Purpose | Main UI Components | Main Actions | APIs Invoked | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **All** | Landing | `/` (`index.tsx`) | Role picker & welcome entry. | Brand header, role selector cards (`User` vs `Coach`), feature value points. | Select role, Continue to Login. | None (static). | FULLY IMPLEMENTED |
| **Athlete** | Register | `/register` | Athlete self-signup. | Name, email, password, sport, position fields. | Submit registration, auto sign-in. | `POST /api/auth/register-athlete` | FULLY IMPLEMENTED |
| **All** | Login | `/login/[role]` | Authenticate credentials. | Email/password form, Apple/Google sign-in buttons, error banners. | Sign in, navigate to dashboard. | `POST /api/auth/login` | FULLY IMPLEMENTED |
| **Athlete** | Athlete Dashboard | `/athlete/dashboard` | Main operational hub for athlete. | 5 internal views (`Today`, `Workouts`, `Nutrition`, `Coach`, `Progress`), custom bottom nav. | Tab navigation, water logging, meal confirmation, video playback. | Aggregated via `loadAthleteDashboardData` (14 endpoints) | FULLY IMPLEMENTED |
| **Athlete** | Daily Check-in | `/athlete/check-in` | Record daily wellness & resting HR. | Stepper for sleep, 5-point scales for sleep quality, mood, stress, soreness, fatigue. | Save check-in, update readiness. | `POST /api/athlete/wellness`, `POST /api/athlete/heart-rate` | FULLY IMPLEMENTED |
| **Athlete** | Active Workout | `/athlete/active-workout` | Step-by-step workout execution. | Exercise header, set completion checklist, coach notes, RPE rating bar. | Complete set, mark workout done, launch RPE logger. | `POST /api/athlete/workout-assignments/:id/exercises/:idx/progress` | FULLY IMPLEMENTED |
| **Athlete** | Session RPE | `/athlete/rpe` | Log training effort & load. | Slot picker (AM/AFT/PM), category picker, intensity %, 1-10 RPE scale, wellness scales. | Submit RPE, compute training load. | `POST /api/athlete/rpe-monitoring` | FULLY IMPLEMENTED |
| **Athlete** | Water Tracker | `/athlete/water` | Hydration logging & reminders. | Quick-add buttons (+250, +500ml), daily water glass visual, target setter. | Log water, update hydration goal. | `POST /api/athlete/water`, `PUT /api/athlete/profile` | FULLY IMPLEMENTED |
| **Athlete** | Manual Meal Log | `/athlete/log-meal` | Manual nutrition tracking. | Food search/entry form, macro inputs (calories, protein, carbs, fat), meal type. | Add food row, save meal. | `POST /api/athlete/nutrition/meals` | FULLY IMPLEMENTED |
| **Athlete** | AI Meal Scan | `/athlete/meal-scan` | Photo meal scanner using Gemini. | DocumentPicker image select, AI itemized food list with macro estimates, confirm button. | Upload image, edit items, confirm and persist meal. | `POST /api/athlete/nutrition/meal-scan`, `POST /api/athlete/nutrition/meal-scan/:id/confirm` | FULLY IMPLEMENTED |
| **Athlete** | Coach Discovery | `/athlete/coach-discovery` | Marketplace to hire coaches. | Search bar, filters (Nutrition, Strength, Experienced), coach profile cards, pricing plans. | Subscribe, initiate coach switch. | `GET /api/marketplace/coaches`, `POST /api/athlete/subscriptions` | FULLY IMPLEMENTED |
| **Athlete** | Trends Detail | `/athlete/trends` | Historical charts. | Date range picker, readiness line chart, recovery chart, training load bars. | Toggle metrics, inspect dates. | `GET /api/athlete/trends`, `GET /api/athlete/analytics/series` | FULLY IMPLEMENTED |
| **Coach** | Coach Home | `/coach/dashboard` | Squad triage & daily schedule. | Attention triage list, upcoming video session card, quick metrics, activity rows. | Join video session, triage athlete risk flags. | `loadCoachHomeData` (`/api/coach/dashboard`, `/api/coach/sessions`, etc.) | FULLY IMPLEMENTED |
| **Coach** | Client Roster | `/coach/athletes` | Squad management. | Search input, filter chips (All, Attention, Active, Membership), athlete cards. | View client, navigate to detail, add client. | `loadCoachHomeData` (`/api/coach/dashboard`) | FULLY IMPLEMENTED |
| **Coach** | Client Detail | `/coach/athletes/[athleteId]` | Deep dive on single athlete. | Athlete daily card, workout list, trend charts, nutrition totals, comment composer. | Add coach comment, open direct chat. | `loadCoachClientDetailData`, `POST /api/coach/athletes/:id/comments` | FULLY IMPLEMENTED |
| **Coach** | New Athlete | `/coach/athletes/new` | Direct athlete onboarding. | Form for name, email, sport, position. | Create athlete, copy one-time temp password. | `POST /api/coach/athletes` | FULLY IMPLEMENTED |
| **Coach** | Plan Manager | `/coach/plan` | Assignment & routine orchestrator. | Segmented view (Assignments, Templates, Routines), quick composers. | Assign workout, assign meal plan, create routine. | `GET/POST /api/coach/workout-assignments`, `GET/POST /api/coach/meal-plan-assignments` | FULLY IMPLEMENTED |
| **Coach** | Content Library | `/coach/content` | Video exercise & lesson repository. | DocumentPicker video upload, category chips, video cards, preview modal. | Upload video, edit metadata, archive, assign to client. | `GET/POST/PUT/DELETE /api/coach/videos`, `POST .../assign` | FULLY IMPLEMENTED |
| **Coach** | Coach Profile | `/coach/profile` | Business & marketplace setup. | Marketplace toggle, pricing plans list, availability window editor, reviews list. | Activate marketplace, edit pricing, set working hours. | `GET/PUT /api/coach/profile`, `GET/POST /api/coach/pricing-plans`, `/api/coach/availability` | FULLY IMPLEMENTED |
| **Coach** | Messaging Center | `/coach/messages` | Direct chat with athletes. | Thread list, message history bubbles, image attachment, AI workout OCR preview. | Send text, upload image, convert image to workout table. | `GET/POST /api/coach/athletes/:id/messages`, `POST /api/coach/athletes/:id/media` | FULLY IMPLEMENTED |
| **Coach** | Announcements | `/coach/announcements` | Broadcast notice to squad. | Announcement composer, priority selector, sent history list. | Broadcast announcement to assigned squad. | `POST /api/coach/announcements` | FULLY IMPLEMENTED |
| **Coach** | Academy Coaches | `/coach/coaches` | Academy owner coach provisioning. | List of coaches in academy, create coach modal. | Bootstrap new coaches in academy. | `GET/POST /api/coach/coaches` | FULLY IMPLEMENTED *(Academy Owner only)* |
| **All** | Account / Settings | `/account` | User profile & app preferences. | Avatar photo/badge editor, bio details, notification category switches, change password. | Update profile, toggle notifications, change password, sign out. | `PUT /api/athlete/profile`, `PUT /api/coach/profile`, `PUT /api/notification-preferences` | FULLY IMPLEMENTED |
| **All** | Notifications | `/notifications` | Notification history center. | List of in-app notification cards, unread badges, time ago, mark all read button. | Mark read, tap to deep-link to screen. | `GET /api/notifications`, `POST /api/notifications/:id/read` | FULLY IMPLEMENTED |

---

# 7. Primary User Flow (Athlete)

```text
1. Sign Up / Login (/register or /login/athlete)
   │  Enters email, password, sport, position.
   │  API: POST /api/auth/register-athlete -> JWT tokens saved to SecureStore.
   ▼
2. Athlete Today Dashboard (/athlete/dashboard?section=today)
   │  Displays greeting, date, today's alert banner, and readiness ring.
   ▼
3. Morning Wellness Check-in (/athlete/check-in)
   │  User logs: sleep hours (7.5), sleep quality (1-5), mood, stress, soreness, fatigue.
   │  Optional: waking resting heart rate.
   │  API: POST /api/athlete/wellness -> triggers server calculateReadiness().
   │  Result: Dashboard readiness ring immediately updates with score (0-100) and color band.
   ▼
4. Execute Assigned Workout (/athlete/active-workout?assignmentId=:id)
   │  User opens today's assigned workout ("Upper Body Strength").
   │  Views exercise 1: "Bench Press", 4 sets, 8 reps, 90s rest, coach video & notes.
   │  Taps "Complete Set" for each set -> API: POST .../exercises/0/progress.
   │  Completes all exercises -> Prompts: "How hard was the workout?" (RPE 1-10).
   ▼
5. Submit Session RPE (/athlete/rpe)
   │  User logs: Slot (AM), Category (MAX SPEED), Intensity (70%), RPE (8).
   │  API: POST /api/athlete/rpe-monitoring -> derives calculatedTrainingLoad & riskFlag.
   ▼
6. Track Nutrition & Water (/athlete/dashboard?section=nutrition)
   │  User confirms planned lunch ("Grilled Chicken Bowl") -> API: POST /api/athlete/nutrition/meals.
   │  User photographs dinner -> opens /athlete/meal-scan -> Gemini parses macros -> User confirms.
   │  User taps "+250 ml" on Water card -> API: POST /api/athlete/water.
   ▼
7. Review Long-term Progress (/athlete/dashboard?section=progress)
   │  Views 4-week trend lines: Readiness, Acute Training Load, Recovery, Calorie Adherence.
   ▼
8. Interact with Coach (/athlete/dashboard?section=coach)
   │  Views coach notes, watches assigned coaching videos, joins scheduled video session room.
```

---

# 8. Coach / Secondary User Flow

```text
1. Login (/login/coach)
   │  API: POST /api/auth/login -> role: "coach".
   ▼
2. Coach Dashboard (/coach/dashboard)
   │  Reviews "Needs Attention" triage box: flags athletes with red risk flags or high soreness.
   │  Views countdown for next upcoming 1-on-1 video session.
   ▼
3. Onboard New Client (/coach/athletes/new)
   │  Enters athlete name, email, sport.
   │  API: POST /api/coach/athletes -> creates account + returns one-time temporary password.
   ▼
4. Plan Workouts & Nutrition (/coach/plan)
   │  Selects "Workout" composer: picks template ("Lower Body Power") and assigns to athlete.
   │  API: POST /api/coach/workout-assignments -> snapshots exercise list & version.
   │  Selects "Meal Plan" composer: assigns 7-day high-protein plan to athlete.
   │  API: POST /api/coach/meal-plan-assignments -> instantiates PlannedMeal rows.
   ▼
5. Upload Coaching Content (/coach/content)
   │  Picks video file from device, sets title ("Deadlift Form Guide"), category ("exercise_tutorial").
   │  API: POST /api/coach/videos -> video stored, streamable to subscribers.
   ▼
6. Conduct 1-on-1 Video Session (/coach/dashboard)
   │  At session time, taps "Start Session" -> API: POST /api/coach/sessions/:id/join-token.
   │  Connects to LiveKit video room.
   │  Marks session completed with summary notes -> API: POST /api/coach/sessions/:id/complete.
   ▼
7. Squad Feedback & Messaging (/coach/messages or /coach/athletes/:id)
   │  Reviews athlete's completed sets and RPE rating.
   │  Sends feedback note: "Great bar speed on set 3, increase load next week."
   │  API: POST /api/coach/athletes/:id/comments.
```

---

# 9. Current Home / Today Screen Details

### File: `mobile/src/app/athlete/dashboard.tsx` (`TodayView` lines 281–430)

| Order | UI Section | Component / File | Data Displayed | Actions | Visibility / Collapse State |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | Primary App Bar | `PrimaryAppBar` | Greeting (`Good morning, {name}`), current full date (`longDate(data.date)`). | Tap avatar -> `/account`; Tap bell -> `/notifications`. | Always visible at top. |
| **2** | Alert Banner | `AlertBanner` (`buildTodayAlert`) | Payment failure alert, subscription expiring soon alert, or "Check-in needed" prompt. | Action button navigating to `/athlete/check-in` or Coach tab. | Conditionally visible if unhandled alerts exist. |
| **3** | Readiness Card | `ReadinessCard` | Circular progress ring (0–100), color tone (`Good`, `Moderate`, `Low`), Sleep hours/quality, Soreness, Fatigue. | "Check In" button -> pushes `/athlete/check-in`. | Always visible. Shows empty state if check-in not logged. |
| **4** | Today's Plan | `AppCard` + `RowLink` | Summary rows: Scheduled workout name & progress %, Meals logged/planned & calories, Coach tasks count. | Tap workout -> opens active workout; Tap meals -> navigates to Nutrition tab; Tap tasks -> navigates to Coach tab. | Always visible. |
| **5** | Active Workout Card | `AppCard` | Exercise count, coach name, completed count/total, horizontal progress bar. | "Continue Workout" or "View Workout" -> opens `/athlete/active-workout`. | Rendered only if a workout is scheduled for today. |
| **6** | Nutrition Summary | `NutritionSummaryCard` | Calorie progress ring (consumed / target kcal), macro bars (Protein, Carbs, Fat vs targets). | Tap card -> switches to Nutrition tab. | Always visible. |
| **7** | Split Card: Water & Recovery | `AppCard` | **Left:** Water intake (L consumed / goal L, progress bar).<br>**Right:** Recovery status / resting HR indicator. | **Left:** `+250 ml` quick add button.<br>**Right:** "View" button -> opens `/athlete/trends`. | Always visible. |
| **8** | Coach Feedback | `AppCard` | Coach avatar, coach name, recent feedback comment snippet. | "Reply" link -> switches to Coach tab. | Rendered only if coach comments exist. |
| **9** | Tomorrow Preview | `AppCard` | Tomorrow's workout name, count of planned meals. | "View routine" link -> opens workout. | Rendered only if upcoming workout exists. |
| **10** | Live Video Session | `SessionCard` | Coach name, scheduled session start time, countdown pill. | "Join" button -> calls `/api/athlete/sessions/:id/join-token`. | Rendered only if a future session is booked today. |

**Density Assessment:** Moderately dense, vertical scroll-based design with card grouping and 16px padding.

---

# 10. Current Training Model

### 1. Planning
- **Authoring:** Created by Coach via `/coach/plan` (or self-authored by Athlete via `/api/workout-templates`).
- **Data Model:** `WorkoutTemplate` contains name, description, category, and an array of exercises (title, type, sets, reps, durationSec, restSec, instructions, mediaId, order).
- **Assignment:** Coach assigns template to athlete for a specific date and slot (`AM`, `AFT`, `PM`) via `POST /api/coach/workout-assignments` (or bulk assign).
- **Snapshot Immutability:** Assignment creates a `WorkoutAssignment` document which creates a snapshot of the template exercises (`exercisesSnapshot`) and template version. Future edits to the master template never corrupt already-assigned workouts.

### 2. Athlete Execution
- **Visibility:** Appears under Today tab and Workouts tab.
- **Starting:** Athlete opens `/athlete/active-workout?assignmentId=:id`.
- **Set Logging:** Athlete checks off individual sets. Each set completion sends `POST /api/athlete/workout-assignments/:id/exercises/:index/progress`.
- **Completion:** When the final set of the final exercise is logged, the assignment status transitions to `completed`, recording `completedAt`.

### 3. Review & Feedback
- **Effort Rating:** The app prompts the athlete to rate workout exertion (RPE 1–10), auto-forwarding to `/athlete/rpe`.
- **Coach Visibility:** Coach sees workout completion status immediately on their dashboard, client detail page (`/coach/athletes/:id`), and Plan routine roster.
- **Coach Review:** Coach types feedback into the comment box on the client detail page (`POST /api/coach/athletes/:id/comments`), which instantly displays on the Athlete's Today and Coach tabs.

---

# 11. Wellness / Readiness / Recovery / RPE Metrics

| Metric | Inputs | Mathematical Formula / Derivation | Source Code Location | Where Displayed in UI |
| :--- | :--- | :--- | :--- | :--- |
| **Readiness Score** | `sleepQuality`, `mood`, `stress`, `soreness`, `fatigue` (each 1–5). | Sleep & Mood (pos): `((x - 1) / 4) * 100`<br>Stress, Soreness, Fatigue (neg): `((5 - x) / 4) * 100`<br>Score = rounded average of components (0–100). | `server/src/services/dashboard.ts` (`computeReadiness`, line 33) | Athlete Today ring, Athlete Progress chart, Coach Squad Triage card. |
| **Recovery Score** | `sleepQuality`, `sleepHours`, `soreness`, `fatigue`, `wakeHrBpm`. | Normalised average $\times$ 100:<br>`(sq-1)/4` + `clamp(sh/8)` + `(5-sor)/4` + `(5-fat)/4` + `clamp((80-wakeHr)/40)`. | `server/src/services/dashboard.ts` (`computeRecovery`, line 63) | Athlete Split Card, Athlete Progress chart, Coach Client Detail. |
| **Training Load** | `plannedIntensityPercent` (0–100), `rpe` (0–10). | $\text{Calculated Load} = \text{plannedIntensityPercent} \times \text{rpe}$ | `server/src/lib/trainingCategories.ts` (`deriveLoadAndRisk`, line 108) | Athlete Progress load chart, Coach Client detail, RPE history. |
| **RPE Readiness** | RPE-specific `sleepQuality`, `moodMotivation`, `fatigue`, `muscleSoreness`. | Sum of 4 quarters (each max 25):<br>$(sq/5)*25 + (mm/5)*25 + ((5-fat)/5)*25 + ((5-ms)/5)*25$. | `server/src/lib/trainingCategories.ts` (`computeRpeReadiness`, line 80) | RPE submission confirmation, Coach RPE log audit. |
| **Risk Flag** | `rpe`, `fatigue`, `muscleSoreness`, `sleepQuality`, `moodMotivation`, `restingHeartRate`. | **RED:** $(rpe \ge 8 \land fat \ge 4) \lor (sore \ge 4 \land fat \ge 4)$<br>**AMBER:** $sleep \le 2 \lor mood \le 2 \lor RHR \ge 100$<br>**GREEN:** Otherwise. | `server/src/lib/trainingCategories.ts` (`deriveLoadAndRisk`, line 118) | Coach Home Needs Attention triage list, Squad Risk Alert chips. |
| **BMR** | Weight (kg), Height (cm), Age (yrs), Biological Sex. | **Male:** $10W + 6.25H - 5A + 5$<br>**Female:** $10W + 6.25H - 5A - 161$ | `server/src/services/nutritionEngine.ts` (`computeBMR`, line 67) | Derived in backend target calculations. |
| **Daily TDEE** | BMR, Activity Level. | $BMR \times \text{ActivityFactor}$ (Sedentary: 1.2, Light: 1.375, Moderate: 1.55, Active: 1.725, Very Active: 1.9). | `server/src/services/nutritionEngine.ts` (`computeTDEE`, line 72) | Backend target calculations. |
| **Calorie Target** | TDEE, Fitness Goal, Goal Intensity. | $TDEE \pm \Delta_{goal}$ (Mild: 250, Moderate: 500, Aggressive: 750). Floor at $\max(1200, 1.0 \times BMR)$. | `server/src/services/nutritionEngine.ts` (`calculateNutritionTarget`, line 90) | Athlete Nutrition ring, Calorie progress bars. |

---

# 12. Progress & Analytics Experience

| Capability | Status | Implementation Details & Evidence |
| :--- | :--- | :--- |
| **Readiness Trends** | **REAL** | `GET /api/athlete/trends?days=28` renders SVG line charts across 7D, 4W, 3M intervals (`ProgressView`, line 1856). |
| **Training Load Trends** | **REAL** | Derived from RPE records via `series.map(p => p.load)` in `ProgressView` (line 1857). |
| **Recovery Trends** | **REAL** | Computed from daily recovery scores and plotted on the Progress chart tab. |
| **Workout Adherence** | **REAL** | Counts completed vs scheduled workouts over trailing 7 days (`workoutDone / workoutTotal`). |
| **Nutrition Adherence** | **REAL** | Calculates % of target calories and protein consumed over trailing days (`calorieAdherence`, `proteinAdherence`). |
| **Check-in Streak** | **REAL** | `buildCheckInStreak` analyzes consecutive days of wellness entries and displays streak count. |
| **Bodyweight Tracking** | **PARTIAL** | Displays current weight and single sparkline from `profile.weightKg`. **Gap:** `goalWeight` and `startedWeight` are currently hardcoded as `null` in `ProgressView` (lines 1839–1840) because `AthleteProfile` lacks explicit start/goal weight fields. |
| **Goals & Achievements** | **PARTIAL** | Backend has `achievements.ts` service and milestone evaluation, but there is no dedicated Achievements tab in the mobile client. |

---

# 13. Communication Mechanisms

| Channel | Sender | Receiver | Real-time / Mechanism | Push Support? | Read State Tracking? | File & Endpoint Evidence |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Direct Chat** | Coach or Athlete | Athlete or Coach | HTTP polling & optimistic local state. | Yes (Category `messages`) | Yes (`read: true`, `readAt`) | `server/src/routes/coach.ts` (`/api/coach/athletes/:id/messages`), `mobile/src/app/coach/messages.tsx` |
| **Coach Comments** | Coach | Athlete | Stored in Mongo, displayed on Athlete Today & Coach tabs. | Yes | Yes | `server/src/models/CoachComment.ts`, `server/src/routes/coach.ts` (`POST .../comments`) |
| **Athlete Notes** | Athlete | Coach | Athlete submits questions/requests with `needsReply: true`. | Yes | Yes (`resolved: true`, `resolvedAt`) | `server/src/models/AthleteNote.ts`, `server/src/routes/athlete.ts` (`POST .../notes`) |
| **Announcements** | Coach | All assigned squad athletes | Broadcast message stored per academy/coach. | Yes (Category `messages`) | No (Broadcast) | `server/src/models/Announcement.ts`, `server/src/routes/coach.ts` (`POST .../announcements`) |
| **System Notifications** | System (Sweeps) | Athlete or Coach | Push via FCM + In-app notification center. | Yes (Multi-tier priority) | Yes (`POST /api/notifications/:id/read`) | `server/src/models/Notification.ts`, `server/src/routes/notifications.ts` |

---

# 14. Notifications Pipeline

Notification delivery uses an eligibility engine (`services/notificationEligibility.ts`) enforcing:
1. User-configured quiet hours (timezone-aware).
2. Per-category toggle gates (`NotificationPreference`).
3. Daily send budgets and minimum dispatch intervals.
4. Dedup key idempotency (`NotificationDecision`).

### Active Notification Events:

| Event Type | Recipient | Category | Priority Tier | Push? | In-App? | Default Deep Link |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `daily_checkin_reminder` | Athlete | `reminders` | Tier 2 | Yes | Yes | `/athlete/dashboard` |
| `training_session_reminder` | Athlete | `reminders` | Tier 2 | Yes | Yes | `/athlete/dashboard` |
| `rpe_monitoring_reminder` | Athlete | `reminders` | Tier 2 | Yes | Yes | `/athlete/dashboard` |
| `hydration_reminder` | Athlete | `reminders` | Tier 5 | Yes | Yes | `/athlete/dashboard` |
| `missed_activity_reminder` | Athlete | `reminders` | Tier 3 | Yes | Yes | `/athlete/dashboard` |
| `readiness_risk_flag` | Coach | `alerts` | Tier 1 | Yes | Yes | `/coach/dashboard` |
| `injury_alert` | Coach | `alerts` | Tier 1 *(Override)* | Yes | Yes | `/coach/dashboard` |
| `note_needs_reply` | Coach | `reminders` | Tier 2 | Yes | Yes | `/coach/dashboard` |
| `direct_message` | Both | `messages` | Tier 1 | Yes | Yes | `/coach/messages` or `/athlete/dashboard?section=coach` |
| `announcement` | Athlete | `messages` | Tier 2 | Yes | Yes | `/notifications` |
| `coach_feedback` | Athlete | `messages` | Tier 2 | Yes | Yes | `/athlete/dashboard?section=coach` |
| `subscription_expiring_soon` | Athlete | `alerts` | Tier 2 | Yes | Yes | `/athlete/dashboard?section=coach` |
| `subscription_payment_failed` | Athlete | `alerts` | Tier 1 | Yes | Yes | `/athlete/dashboard?section=coach` |
| `session_reminder` | Both | `reminders` | Tier 1 | Yes | Yes | `/coach/dashboard` or `/athlete/dashboard` |

---

# 15. AI Features

| Feature | Provider / Model | Input Data | Output Structure | UI Location | Mock Fallback Present? |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Meal Photo Scanner** | Google Gemini Vision (`gemini-1.5-flash`) | Photographed meal image (JPEG/PNG). | Detected foods, estimated weight/portion, calories, protein, carbs, fat, confidence scores. | `/athlete/meal-scan` | Yes (`GeminiNoopProvider` returns deterministic meal items when unset). |
| **Workout Image OCR** | Google Gemini Vision (`gemini-1.5-flash`) | Whiteboard or printed workout plan image. | Structured exercise table (sets, reps, rest, exercise title). | `/coach/messages` (`ChatMediaBubble`) | Yes (Structured fallback rows if AI fails or key is missing). |
| **Voice Intent Interpretation V2** | Local Rule Engine + Gemini NLP | Natural language voice transcript + current screen context. | 13 structured action intents (`add_water`, `log_meal`, `open_screen`, etc.) + confirmation parameters. | Global mic button (`AthleteAskAgentOverlayV2`) | Yes (Deterministic pattern matcher runs 100% offline). |
| **Voice Speech-to-Text (STT)** | Deepgram (`nova-3`) | Real-time microphone audio stream. | Formatted text transcript. | Overlay mic listening state | Yes (Falls back to browser/OS native Web Speech API). |
| **Voice Text-to-Speech (TTS)** | Deepgram (`aura-asteria-en`) | Text response payload. | Linear PCM / MP3 speech audio. | Overlay audio feedback | Yes (Falls back to client speech synthesis). |

---

# 16. Data Model

### Core Mongoose Collections (50 models under `server/src/models/`):

| Model Name | Primary Responsibility | Key Relationships & Indexes |
| :--- | :--- | :--- |
| **`User`** | Master account identity & credentials. | `role: "coach" \| "athlete"`, `email` (unique index), `appleSubject`. |
| **`AthleteProfile`** | Physical metrics, goals, dietary preferences. | `userId` $\rightarrow$ `User`, `hydrationGoalMl`, `fitnessGoal`, `allergies`. |
| **`CoachProfile`** | Bio, specialties, ratings, marketplace visibility. | `coachId` $\rightarrow$ `User` (unique), `active: boolean`, `avgRating`. |
| **`CoachAthleteAssignment`** | Single primary coach invariant relationship. | `athleteId` $\rightarrow$ `AthleteProfile`, `coachId` $\rightarrow$ `User`. **Unique Partial Index:** `{ athleteId: 1 }` where `status: "active"`. |
| **`WorkoutTemplate`** | Master reusable workout routines. | `coachId` $\rightarrow$ `User`, `exercises` array, `version` counter. |
| **`WorkoutAssignment`** | Instantiated workout assigned to athlete. | `athleteId`, `templateId`, `scheduledDate`, `exercisesSnapshot`. |
| **`ExerciseProgress`** | Set-by-set execution progress. | `assignmentId`, `exerciseIndex`, `setsCompleted` array. |
| **`Wellness`** | Daily morning check-in signals. | `athleteId`, `date` (unique compound index), 5-scale signals. |
| **`RpeMonitoring`** | Training session exertion & load. | `athleteId`, `date`, `sessionType` (`AM`/`AFT`/`PM`), `calculatedTrainingLoad`, `riskFlag`. |
| **`WaterIntake`** | Individual hydration drink events. | `athleteId`, `date`, `amountMl`. |
| **`Meal` / `MealFood`** | Logged food consumption. | `athleteId`, `date`, `mealType`, food items with calories and macros. |
| **`PlannedMeal`** | Coach-prescribed meal targets. | `athleteId`, `date`, `mealType`, `mealPlanAssignmentId`. |
| **`MealPlan` / `MealPlanAssignment`** | Multi-day meal plan templates and assignments. | `coachId`, `days` array; assignment snapshots days into real `PlannedMeal` rows. |
| **`MealScan` / `MealScanItem`** | Staged AI vision food scan results. | `athleteId`, `status: "pending" \| "confirmed"`, food detections. |
| **`CoachPricingPlan`** | Subscription tiers offered by coach. | `coachId`, `interval: "monthly" \| "quarterly"`, `priceAmount`, `currency`. |
| **`AthleteCoachSubscription`** | Active billing relationship. | `athleteId` (unique partial active index), `pricingPlanSnapshot`, `status`. |
| **`Payment` / `PaymentWebhookEvent`** | Financial transaction log & idempotency. | `providerPaymentId` (unique), Razorpay event verification. |
| **`CoachSession`** | 1-on-1 scheduled video appointments. | `coachId`, `athleteId`, `scheduledStart`, `videoRoomRef`, `status`. |
| **`CoachAvailability`** | Recurring coach working hours. | `coachId`, `dayOfWeek: 0-6`, `startTime`, `endTime`. |
| **`CoachVideo` / `CoachVideoProgress`** | In-app video library and watch milestones. | `coachId`, `videoUrl`, `category`, `visibility`; progress tracks watch %. |
| **`Message`** | Direct 1-on-1 communication. | `senderId`, `recipientId`, `threadKey`, `body`, `attachments`. |
| **`Notification` / `NotificationDecision`** | In-app notification feed & push dispatch audit. | `userId`, `dedupKey` (unique index), `suppressReason`. |

---

# 17. API Summary

The application mounts **29 Express routers** in `server/src/app.ts`.

### 1. Authentication (`/api/auth`)
- `POST /register-athlete`: Self-registration for athletes.
- `POST /login`: Issues access (15m) and refresh (7d) tokens.
- `POST /refresh`: Rotating refresh token exchange.
- `POST /logout`: Invalidate tokens.
- `POST /change-password`: Password update.
- `POST /google`, `POST /apple`: Social OAuth sign-in.

### 2. Athlete Workflows (`/api/athlete`)
- `GET /dashboard`: Aggregated dashboard summary (readiness, cards, workouts).
- `POST /wellness`: Record daily 5-scale wellness check-in.
- `POST /heart-rate`: Record waking and bed resting heart rate.
- `POST /rpe-monitoring`: Log session RPE and training load.
- `POST /water`: Log water intake (+250ml or custom amount).
- `GET /trends`: 7D/4W/3M trend series for readiness, load, recovery.
- `GET /workout-assignments`: List assigned workouts.
- `POST /workout-assignments/:id/exercises/:idx/progress`: Check off set completion.
- `GET /nutrition/meals`, `POST /nutrition/meals`: Meal logging.
- `POST /nutrition/meal-scan`: Gemini AI photo meal analysis.
- `POST /nutrition/meal-scan/:id/confirm`: Confirm scan into permanent meal.
- `POST /coach/leave`: Terminate active coach relationship.
- `POST /notes`: Send question/note to coach.

### 3. Coach Workflows (`/api/coach`)
- `GET /dashboard`: Squad daily cards, attention triage, upcoming sessions.
- `GET /athletes`, `POST /athletes`: Roster listing and client creation.
- `GET /athletes/:id`: Full client profile, wellness, nutrition, and workout history.
- `POST /athletes/:id/comments`: Post coach feedback note.
- `POST /workout-assignments`: Assign workout template to client.
- `POST /workout-assignments/bulk`: Assign workout template to entire squad.
- `POST /meal-plan-assignments`: Assign multi-day meal plan.
- `GET /videos`, `POST /videos`, `PUT/DELETE /videos/:id`: Content library CRUD.
- `POST /videos/:id/assign`: Assign video tutorial to client.
- `GET/PUT /profile`: Edit public coach bio and specialties.
- `GET/POST /pricing-plans`: Configure subscription tiers.
- `GET/PUT /availability`: Configure weekly working hours.
- `POST /sessions/:id/complete`: Complete 1-on-1 session with summary.
- `POST /announcements`: Squad broadcast.

### 4. Shared & Infrastructure
- `GET /api/marketplace/coaches`: Browse coach marketplace.
- `POST /api/athlete/subscriptions`: Subscribe to coach plan.
- `POST /api/internal/payments/webhook`: Raw-body Razorpay webhook receiver.
- `GET/POST /api/notifications`: In-app notification center.
- `POST /api/device-tokens`: Register FCM push token.
- `POST /api/presence/heartbeat`: 90-second client active heartbeat.
- `POST /api/athlete/voice/v2/interpret`: V2 voice assistant intent parser.
- `POST /api/athlete/voice/v2/confirm`: Execute confirmed voice intent.

---

# 18. Current UI & Visual Design

### Design Tokens (`mobile/src/lib/theme.ts`):
- **Backgrounds:** Canvas `#f5f7fb`, Surface `#ffffff`, Surface Inset `#f8fafc`, Surface Raised `#ffffff`.
- **Primary Brand:** Deep Blue `#1a56db` (Soft Tint: `#edf3ff`, Border: `#bfdbfe`).
- **Accent Tokens:**
  - Success / Recovery: Emerald `#16a34a` (Soft: `#e9f7ef`).
  - Warning / Exertion: Orange `#ea580c` (Soft: `#fff7ed`).
  - Danger / High Risk: Crimson `#dc2626` (Soft: `#fef2f2`).
- **Typography:** Google Fonts Inter (`Inter_400Regular` through `Inter_900Black`). Compact line heights and bold headline hierarchy.
- **Card Geometry:** Corner radius 14px–18px, subtle 1px border (`#e2e8f0`), soft diffused elevation shadow.
- **Iconography:** `@expo/vector-icons` Ionicons using 2-tone rounded outline styles.

---

# 19. Responsiveness

- **Mobile Viewports (Tested 430 $\times$ 932 px):** Fully responsive, compact mobile layouts. Grid rows gracefully collapse on narrow screens.
- **Tablets / Web Desktop:** Handled via centered canvas containers (`maxWidth: 600` on key screens) with horizontal padding so screens do not stretch uncomfortably on wide displays.
- **Safe Area Insets:** Strict wrapping with `react-native-safe-area-context` on all headers, bottom bars, and modal sheets.

---

# 20. Disconnected / Legacy / Dead Functionality

| Item | Location | Why It Is Disconnected / Dead | Evidence |
| :--- | :--- | :--- | :--- |
| **Guardian Role & Endpoints** | Legacy repo branches | Completely purged. `User.USER_ROLES` is `["coach", "athlete"]`. No guardian screens exist. | `server/src/models/User.ts`, line 3 |
| **Guided Tour Overlay** | `mobile/src/lib/tour/` | Wrapped in dummy `TourRootBoundary` in `_layout.tsx` to prevent breaking legacy imports; visuals are completely dormant in Fitora shell. | `mobile/src/app/_layout.tsx`, line 116 |
| **Weight Goal Tracking** | `mobile/src/app/athlete/dashboard.tsx` | `goalWeight` and `startedWeight` hardcoded to `null` in `ProgressView` (lines 1839–1840); goal progress bar shows empty. | `mobile/src/app/athlete/dashboard.tsx`, line 1839 |
| **Standalone Coaches Screen** | `mobile/src/app/coach/coaches.tsx` | Hidden from tab bar (`href: null`). Accessible only if `user.isAcademyOwner` is true. | `mobile/src/app/coach/_layout.tsx`, line 77 |
| **Standalone Announcements** | `mobile/src/app/coach/announcements.tsx` | Hidden from coach tab bar (`href: null`). | `mobile/src/app/coach/_layout.tsx`, line 76 |

---

# 21. Test & Reliability Status

All test and validation suites were executed against the active repository:

| Verification Suite | Command | Result | Details |
| :--- | :--- | :--- | :--- |
| **TypeScript (Server)** | `npm run typecheck:server` | **PASSED** | Clean compile (`tsc -p tsconfig.json --noEmit`), 0 errors. |
| **TypeScript (Mobile)** | `npm run typecheck:mobile` | **PASSED** | Clean compile (`tsc -p tsconfig.json --noEmit`), 0 errors. |
| **Server Unit & Integration** | `npm test --workspace server` | **PASSED** | **61 test suites passed, 615 tests passed**, 0 failures. Ran with in-memory Mongo. |
| **Mobile Unit Tests** | `npm test --workspace mobile` | **PASSED** | **12 test suites passed, 153 tests passed**, 0 failures. Covers wellness, voice, and icons. |
| **Mobile Lint** | `npm run lint --workspace mobile` | **PASSED** | 0 errors, 1 pre-existing import warning (`voiceLanguage.test.ts`). |
| **Android APK Build** | Inspected `mobile/android/` | **PASSED** | Release APK (`app-release.apk`, 121.6 MB) and Debug APK (`app-debug.apk`, 90.7 MB) generated. |

---

# 22. Current Feature Matrix

| Capability | Role | Frontend | Backend | Connected E2E? | Status | Evidence |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Athlete Self-Signup** | Athlete | Yes | Yes | Yes | FULLY IMPLEMENTED | `mobile/src/app/register.tsx` $\rightarrow$ `POST /api/auth/register-athlete` |
| **Morning Wellness Check-in** | Athlete | Yes | Yes | Yes | FULLY IMPLEMENTED | `mobile/src/app/athlete/check-in.tsx` $\rightarrow$ `POST /api/athlete/wellness` |
| **Resting Heart Rate Log** | Athlete | Yes | Yes | Yes | FULLY IMPLEMENTED | `mobile/src/app/athlete/check-in.tsx` $\rightarrow$ `POST /api/athlete/heart-rate` |
| **Readiness Scoring (0–100)**| Athlete/Coach| Yes | Yes | Yes | FULLY IMPLEMENTED | `server/src/services/dashboard.ts` (`computeReadiness`) |
| **Active Workout Set Logging**| Athlete | Yes | Yes | Yes | FULLY IMPLEMENTED | `mobile/src/app/athlete/active-workout.tsx` $\rightarrow$ `POST .../progress` |
| **Session RPE & Load Logging**| Athlete | Yes | Yes | Yes | FULLY IMPLEMENTED | `mobile/src/app/athlete/rpe.tsx` $\rightarrow$ `POST /api/athlete/rpe-monitoring` |
| **Water Intake Quick-Add** | Athlete | Yes | Yes | Yes | FULLY IMPLEMENTED | `mobile/src/app/athlete/dashboard.tsx` $\rightarrow$ `POST /api/athlete/water` |
| **AI Photo Meal Scanner** | Athlete | Yes | Yes | Yes | FULLY IMPLEMENTED | `mobile/src/app/athlete/meal-scan.tsx` $\rightarrow$ `POST .../meal-scan` |
| **Planned Meal Confirmation** | Athlete | Yes | Yes | Yes | FULLY IMPLEMENTED | `mobile/src/app/athlete/dashboard.tsx` $\rightarrow$ `POST .../meals` |
| **Coach Marketplace Browsing**| Athlete | Yes | Yes | Yes | FULLY IMPLEMENTED | `mobile/src/app/athlete/coach-discovery.tsx` $\rightarrow$ `GET /api/marketplace/coaches` |
| **Coach Subscription Billing** | Athlete | Yes | Yes | Yes | FULLY IMPLEMENTED | `mobile/src/app/athlete/coach-discovery.tsx` $\rightarrow$ `POST .../subscriptions` |
| **Coach Video Playback** | Athlete/Coach| Yes | Yes | Yes | FULLY IMPLEMENTED | `mobile/src/components/VideoPlayerModal.tsx` $\rightarrow$ `expo-video` streams |
| **LiveKit Video Sessions** | Athlete/Coach| Yes | Yes | Yes | FULLY IMPLEMENTED | `server/src/services/videoProvider.ts` $\rightarrow$ `POST .../join-token` |
| **Squad Risk Triage** | Coach | Yes | Yes | Yes | FULLY IMPLEMENTED | `mobile/src/app/coach/dashboard.tsx` $\rightarrow$ `GET /api/coach/dashboard` |
| **Client Provisioning (Temp PW)**| Coach | Yes | Yes | Yes | FULLY IMPLEMENTED | `mobile/src/app/coach/athletes/new.tsx` $\rightarrow$ `POST /api/coach/athletes` |
| **Workout Template Authoring** | Coach | Yes | Yes | Yes | FULLY IMPLEMENTED | `mobile/src/app/coach/plan.tsx` $\rightarrow$ `POST /api/workout-templates` |
| **Meal Plan Authoring & Assign**| Coach | Yes | Yes | Yes | FULLY IMPLEMENTED | `mobile/src/app/coach/plan.tsx` $\rightarrow$ `POST /api/coach/meal-plan-assignments` |
| **Video Library Management** | Coach | Yes | Yes | Yes | FULLY IMPLEMENTED | `mobile/src/app/coach/content.tsx` $\rightarrow$ `POST /api/coach/videos` |
| **Direct Messaging & OCR** | Coach | Yes | Yes | Yes | FULLY IMPLEMENTED | `mobile/src/app/coach/messages.tsx` $\rightarrow$ `POST .../messages` |
| **Voice Assistant V2** | Athlete | Yes | Yes | Yes | FULLY IMPLEMENTED | `AthleteAskAgentOverlayV2` $\rightarrow$ `POST /api/athlete/voice/v2/*` |
| **Notification Sweep & Push** | System | Yes | Yes | Yes | FULLY IMPLEMENTED | `server/src/services/notificationSweep.ts` $\rightarrow$ FCM Adapter |

---

# 23. Current Visual Snapshot

### 1. Athlete Today / Home Screen
- **Purpose:** Primary athlete hub summarizing readiness, today's workout, nutrition, water, and coach tasks.
- **Layout:** Vertical card scroll with sticky top `PrimaryAppBar` and persistent custom `BottomNavigation`.
- **Visible Sections:** Greeting & Date $\rightarrow$ Alert Banner $\rightarrow$ Readiness Ring Card $\rightarrow$ Today's Plan RowLinks $\rightarrow$ Active Workout Card with Progress Bar $\rightarrow$ Nutrition Macro Summary $\rightarrow$ Split Water/Recovery Card $\rightarrow$ Coach Message $\rightarrow$ Tomorrow Preview $\rightarrow$ Video Session Card.
- **Main CTAs:** "Check In", "Continue Workout", "+250 ml", "Reply".
- **Visual Style:** Clean white cards on `#f5f7fb` canvas, bold Inter headings, vibrant blue primary buttons.
- **Evidence Paths:**
  - Browser Capture: `qa-artifacts\fitora\athlete-today.png`
  - Native Android Capture: `qa-artifacts\fitora-native\athlete-today-compact.png`

### 2. Athlete Workouts Tab
- **Purpose:** View today's workout details, upcoming schedules, and completed history.
- **Layout:** Segmented control (`Today` \| `Upcoming` \| `History`) below compact app bar.
- **Visible Sections:**
  - `Today`: Workout Hero banner with exercise count and duration $\rightarrow$ Exercise Preview list with thumbnails $\rightarrow$ Quick Schedule card $\rightarrow$ Recent history cards.
  - `Upcoming`: Chronological list of future assigned templates.
  - `History`: Reverse chronological log of completed workouts.
- **Main CTAs:** "Start Workout", segment tabs.
- **Evidence Paths:**
  - Browser Capture: `qa-artifacts\fitora\athlete-workouts.png`
  - Native Android Capture: `qa-artifacts\fitora-native\athlete-workouts-patched-3.png`

### 3. Athlete Nutrition Tab
- **Purpose:** Track daily calorie/macro intake, confirm planned meals, and log water.
- **Layout:** Large calorie goal ring at top, horizontal macro breakdown bars, dual action buttons, meal lists.
- **Visible Sections:** Calorie Target Ring $\rightarrow$ Macro Progress Bars (Protein, Carbs, Fat) $\rightarrow$ Action Buttons (`+ Log Meal`, `Scan Food`) $\rightarrow$ Planned Meals from Coach (with inline "Log" button) $\rightarrow$ Logged Meals breakdown.
- **Main CTAs:** "+ Log Meal", "Scan Food", inline "Log" on planned meals.
- **Evidence Paths:**
  - Browser Capture: `qa-artifacts\fitora\athlete-nutrition.png`
  - Native Android Capture: `qa-artifacts\fitora-native\athlete-nutrition-patched-2.png`

### 4. Athlete Coach Tab
- **Purpose:** Manage coaching relationship, 1-on-1 sessions, and assigned content.
- **Layout:** Coach Hero card $\rightarrow$ Upcoming session countdown $\rightarrow$ Assigned programs status $\rightarrow$ Panel links $\rightarrow$ Destructive "Leave Coach" button.
- **Main CTAs:** "Join Session", "Find a Coach" (if unassigned), "Message", "Leave Coach".
- **Evidence Paths:**
  - Browser Capture: `qa-artifacts\fitora\athlete-coach.png`
  - Native Android Capture: `qa-artifacts\fitora-native\athlete-coach-final.png`

### 5. Athlete Progress Tab
- **Purpose:** Multi-week trend analysis and habit adherence.
- **Layout:** Range tabs (`7D` \| `4W` \| `3M`) $\rightarrow$ Weight Progress Card $\rightarrow$ Weekly Habit Consistency Grid $\rightarrow$ SVG Readiness/Load/Recovery Sparklines $\rightarrow$ Macro Adherence % $\rightarrow$ Check-in Streak $\rightarrow$ Coach Feedback History.
- **Evidence Paths:**
  - Browser Capture: `qa-artifacts\fitora\athlete-progress.png`
  - Native Android Capture: `qa-artifacts\fitora-native\athlete-progress-final.png`

### 6. Coach Home / Dashboard
- **Purpose:** High-level squad monitoring, risk triage, and scheduled session entry.
- **Layout:** Next Video Session Card $\rightarrow$ 3 Summary Metric Tiles (Active Clients, Training Today, Risk Alerts) $\rightarrow$ "Needs Attention" triage list with severity tags $\rightarrow$ Daily Squad Activity Feed.
- **Main CTAs:** "Start Session", client row tap to open details.
- **Evidence Paths:**
  - Browser Capture: `qa-artifacts\fitora\coach-home.png`
  - Native Android Capture: `qa-artifacts\fitora-native\coach-home-patched.png`

### 7. Coach Clients Tab
- **Purpose:** Roster management and quick search.
- **Layout:** Top search input $\rightarrow$ Filter chips (`All`, `Attention`, `Active`, `Membership`) $\rightarrow$ Roster card list $\rightarrow$ "+ Add Client" action button.
- **Evidence Paths:**
  - Browser Capture: `qa-artifacts\fitora\coach-clients.png`
  - Native Android Capture: `qa-artifacts\fitora-native\coach-clients-patched.png`

### 8. Coach Plan Tab
- **Purpose:** Program design and routine assignment.
- **Layout:** Segmented tabs (`Assignments` \| `Templates` \| `Routines`) $\rightarrow$ Quick action buttons (Workout, Tasks, Meal Plan, Routine) $\rightarrow$ Active client routine list.
- **Evidence Paths:**
  - Browser Capture: `qa-artifacts\fitora\coach-plan.png`
  - Native Android Capture: `qa-artifacts\fitora-native\coach-plan-final2.png`

### 9. Coach Content Tab
- **Purpose:** Video exercise repository and client lesson delivery.
- **Layout:** Video upload draft box $\rightarrow$ Category filter chips $\rightarrow$ Featured video card $\rightarrow$ Video rows with duration and category badges $\rightarrow$ Action menu (Play, Edit, Archive, Delete).
- **Evidence Paths:**
  - Browser Capture: `qa-artifacts\fitora\coach-content.png`
  - Native Android Capture: `qa-artifacts\fitora-native\coach-content-patched.png`

### 10. Coach Profile Tab
- **Purpose:** Business configuration and public listing.
- **Layout:** Coach summary banner $\rightarrow$ Marketplace toggle switch $\rightarrow$ Public profile preview button $\rightarrow$ Pricing plans list $\rightarrow$ Availability window list $\rightarrow$ Client reviews $\rightarrow$ Sign out.
- **Evidence Paths:**
  - Browser Capture: `qa-artifacts\fitora\coach-profile.png`
  - Native Android Capture: `qa-artifacts\fitora-native\coach-profile-final2.png`

---

# 24. Important Observations

1. **One-Primary-Coach Invariant is Strictly DB-Enforced:**
   The unique partial index on `CoachAthleteAssignment` (`{ athleteId: 1 }` where `status: "active"`) prevents race conditions during coach switching and subscription creation.
2. **Coach Scoping Enforces Creator Isolation on Historical Data:**
   Coaches only see assigned athletes, and reading historical templates/plans filters by `assignedBy` so prior coaches' programs do not leak when an athlete switches coaches.
3. **Mifflin-St Jeor Nutrition Engine is 100% Deterministic:**
   Targets are mathematically computed with a 1200 kcal floor and minimum 1.0 $\times$ BMR floor; AI vision is strictly bounded to photo parsing (`MealScan`) and never overrides target formulas.
4. **Resilient Provider Fallbacks:**
   Every third-party integration (LiveKit, Razorpay, FCM, Deepgram, Gemini) has a fully functional local/mock adapter. The server and all 61 test suites run without external vendor dependencies.
5. **Cold-Start Optimization for Vercel:**
   `backend/pages/api/[...path].ts` sets `waitForIndexes: false` on serverless cold starts to eliminate a 6.6s Atlas index-check penalty.
6. **Weight Goal Metrics Gap:**
   In `ProgressView`, `goalWeight` and `startedWeight` are currently `null`, meaning target weight progress remains uncalculated until start/target weight fields are exposed on `AthleteProfile`.
7. **Complete Mobile Test & Type Integrity:**
   Zero TypeScript errors across both workspaces; 615 server tests and 153 mobile tests pass cleanly.
