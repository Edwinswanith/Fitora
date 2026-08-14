# Apex - Sports Coaching Platform

## Project Description

**Apex** is a multi-role sports performance platform built for athletics academies. It connects coaches, athletes, and guardians around a daily training loop: check-ins, attendance, session planning, RPE (Rate of Perceived Exertion) monitoring, recovery tracking, performance logging, and coach feedback.

The platform turns raw self-reported wellness and training data into **readiness indicators** and **risk flags**, giving coaches a squad-level view to triage who needs attention while athletes log their day from a phone-first interface. Guardians get a read-only window into linked athletes.

There is **no admin role**. The system is intentionally scoped to three roles: coach, athlete, and guardian. Academy provisioning is coach-led: an academy owner (a coach with elevated provisioning rights) creates other coaches; each coach onboards their own athletes and guardians.

> **Product language:** Use "readiness indicator" and "risk flag" (decision support). Avoid clinical terms like "diagnosis" or "prediction."
---

## Table of Contents

1. [Problem and Goals](#problem-and-goals)
2. [Users and Roles](#users-and-roles)
3. [Core Product Loop](#core-product-loop)
4. [Architecture](#architecture)
5. [Technology Stack](#technology-stack)
6. [Security and Access Control](#security-and-access-control)
7. [Authentication](#authentication)
8. [Data Model](#data-model)
9. [Analytical Engine](#analytical-engine)
10. [Features by Role](#features-by-role)
11. [API Surface](#api-surface)
12. [Frontend Applications](#frontend-applications)
13. [Design System](#design-system)
14. [Development and Operations](#development-and-operations)
15. [Testing](#testing)
16. [Deployment](#deployment)
17. [Project Status](#project-status)
18. [Related Documentation](#related-documentation)

---

## Problem and Goals

### What problem it solves

Sports academies track athlete wellness, training load, attendance, and performance across many people and touchpoints. Spreadsheets and messaging apps do not enforce who can see what, do not compute readiness from daily inputs, and do not give coaches a single cockpit to triage a squad.

Apex centralizes that workflow with:

- **Role-scoped data access** so coaches only see assigned athletes
- **Daily athlete logging** (wellness, RPE, attendance, recovery, notes)
- **Coach oversight** (squad dashboard, risk triage, training plans, feedback)
- **Guardian visibility** without write access
- **Server-computed signals** (readiness scores, training load, risk flags) derived from athlete inputs

### Design principles

| Principle | Implementation |
|-----------|----------------|
| Coach scope is sacred | Three-layer enforcement on every protected route |
| Server decides identity | JWT verified + user re-read from Mongo on each request |
| Mobile-first UX | Single-column max-w-md shell; no desktop layout |
| Backend before UI | Schema, API, RBAC, tests, then UI |
| Safe wording | Readiness/risk language, not medical claims |
| Audit denials | 403 access failures logged to AuditLog |

---

## Users and Roles

| Role | Primary device | Capabilities |
|------|----------------|--------------|
| **Athlete** | Phone | Log daily check-in, RPE, attendance, recovery, water intake, notes; view own readiness, trends, coach feedback, announcements, and messages |
| **Coach** | Phone | View squad of assigned athletes only; triage risk flags; set training plans; record attendance/performance; send feedback; direct-message athletes; post announcements |
| **Guardian** | Phone | Read-only view of linked athletes: daily summary, trends, coach feedback, activity |

### Academy owner (not a separate role)

`User.isAcademyOwner` is a scoped coach capability, not a role. An owner may list and create coaches in their academy via `GET/POST /api/coach/coaches`.

Owners have no academy-wide data access beyond their own assigned athletes. Bootstrap the first owner via CLI: `npm run create-owner --workspace server`.

### Onboarding paths

| Path | Who | Result |
|------|-----|--------|
| Coach creates athlete | Coach at `/coach/athletes/new` | New User + AthleteProfile + assignment; temp password returned |
| Coach links existing athlete | `POST /api/coach/athletes/link` | Assignment only; adopts academy-less self-registered athletes |
| Athlete self-signup | `POST /api/auth/register-athlete` | Athlete account with no coach assignment until linked |
| Google sign-in (first time) | Login screen | Provisions athlete (default) or coach |
| Coach adds guardian | `POST /api/coach/athletes/:id/guardians` | Guardian account + link to athlete |

---

## Core Product Loop

Every feature should strengthen this cycle:

```
Athlete
  -> Daily training (AM/PM sessions)
  -> Attendance
  -> Wellness check-in
  -> RPE / training load
  -> Recovery
  -> Notes to coach
  -> Coach feedback
  -> Performance tracking
  -> Adapted next plan
```

Coaches own the **plan** (type, intensity, duration). Athletes log the **outcome** and subjective load signals.
---

## Architecture

### Monorepo layout

```
sports-coaching-platform/
  mobile/                # Expo (React Native) native app + web/PWA
  server/                # Express + Mongoose API under /api/*
  docs/                  # Engineering notes and QA reports
  skills/
    sports-coaching-platform-builder/   # Full blueprint
  scripts/               # Dev helpers
  docker-compose.yml     # Local Mongo + API
  deploy.bat             # Google Cloud Run deployment
  package.json           # npm workspaces root
```

### Request flow

Every protected API call passes through:

1. `requireAuth` - verify JWT, re-read user from MongoDB
2. `requireRole` - coach / athlete / guardian gate
3. `loadScope` - resolve assignedAthleteIds, linkedAthleteIds, or athleteProfileId
4. `requireAthleteAccess` - per-athlete scope check on single-athlete routes
5. Handler - service layer - Mongoose models - MongoDB

### Two auth transports, one API

| Client | Token transport | Storage |
|--------|-----------------|---------|
| Mobile (`mobile`) | Authorization Bearer header | expo-secure-store |

### Service layer

| Service | Responsibility |
|---------|----------------|
| `dashboard.ts` | Daily card aggregation, computeReadiness |
| `analytics.ts` | Chart time series and squad rollup |
| `trends.ts` | Trailing readiness/load sparklines |
| `activity.ts` | Merged activity timeline |
| `messaging.ts` | Coach-athlete 1:1 threads |
| `notifications.ts` | In-app notifications |
| `achievements.ts` | Athlete badges |
| `media.ts` / `avatar.ts` | Session photos and profile images |

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Mobile frontend | Expo, expo-router, React Native, TypeScript |
| Backend | Node.js, Express, TypeScript |
| Database | MongoDB via Mongoose |
| Auth | JWT, bcrypt, optional Google ID token sign-in |
| Testing | Jest, mongodb-memory-server |
| Deployment | Docker, Google Cloud Run |
| Packages | npm workspaces |

---

## Security and Access Control

### The non-negotiable invariant

> A coach must only ever see data for athletes explicitly assigned to that coach.

Enforced across profiles, attendance, training, wellness, RPE, recovery, performance, injuries, comments, messages, analytics, and media.

### Three-layer enforcement

1. `requireAuth` - JWT verification + live user lookup
2. `loadScope` - populate role-specific athlete ID sets
3. `requireRole` + `requireAthleteAccess` - gate routes; audit denials

Athlete writes always use `req.actor.athleteProfileId`; client-supplied athleteId is ignored.

---

## Authentication

| Endpoint | Purpose |
|----------|---------|
| `POST /api/auth/login` | Email/password login |
| `POST /api/auth/refresh` | Rotate refresh token |
| `GET /api/auth/me` | Current user |
| `POST /api/auth/logout` | Clear session |
| `POST /api/auth/google` | Google ID token sign-in |
| `POST /api/auth/register-athlete` | Athlete self-registration |

Web: httpOnly cookies with single-flight refresh on 401. Mobile: Bearer tokens in secure storage.

---

## Data Model

20 Mongoose models in `server/src/models/`:

`User`, `Academy`, `AthleteProfile`, `CoachAthleteAssignment`, `GuardianAthleteLink`, `Attendance`, `TrainingSession`, `Wellness`, `Recovery`, `RpeMonitoring`, `Performance`, `Injury`, `AthleteNote`, `CoachComment`, `WaterIntake`, `Message`, `Announcement`, `Notification`, `WorkoutMedia`, `AuditLog`.

`athleteId` in athlete-scoped collections refers to `AthleteProfile._id`, not User id.

Active relationships use `endedAt: null` on assignment/link documents.

Daily records use compound unique indexes for upsert semantics.

---

## Analytical Engine

### Wellness readiness

Daily Wellness fields (1-5) normalize to 0-100; positive fields (sleep quality, mood) and negative fields (stress, soreness, fatigue) combine into a readiness score.

### RPE load and risk

- `calculatedTrainingLoad = plannedIntensityPercent * rpe`
- Risk flags: RED when high RPE combines with high fatigue/soreness; AMBER on poor sleep/mood or elevated resting HR
- Bands: green >= 80, amber 60-79, red < 60

Values are computed server-side and stored on RpeMonitoring rows for fast coach dashboard reads.

### Read models

- **Daily card** - all signals for one athlete on one date
- **Trends** - trailing sparkline series
- **Activity feed** - merged recent events
- **Squad analytics** - coach rollup across assigned athletes
---

## Features by Role

### Athlete

Dashboard, wellness check-in, RPE (27 training categories), attendance, training completion, recovery, water intake, notes, coach feedback, trends/charts, activity feed, messaging, announcements, achievements, profile/avatar.

### Coach

Squad dashboard with KPI strip and risk triage, roster, athlete detail tabs, training/attendance/performance writes, comments, analytics, onboarding (athletes/guardians/coaches for owners), messaging, announcements, notes inbox.

### Guardian

Read-only dashboard, trends, coach feedback, activity, analytics for linked athletes only.

---

## API Surface

Routers: `/api/auth`, `/api/coach`, `/api/athlete`, `/api/guardian`, `/api/notifications`, `/api/avatar`.

Messaging is poll-based (no WebSocket). Threads are the pair `(coachId, athleteId)`.

Full contract: `skills/sports-coaching-platform-builder/api-contract.md`

---

## Frontend Applications

### Mobile (`mobile`)

Expo app by role. Bearer auth. Includes dashboards, roster, athlete detail, onboarding, coaches (owner), messages, announcements, account, notifications, Ask Agent, and AI Tour.

---

## Design System

Brand: **Apex** - Evergreen Performance. Light off-white canvas, role accents (emerald coach, amber athlete, teal guardian), semantic status colors for readiness/risk only. Signature Ring component for readiness display.

Design tokens live in `mobile/src/lib/theme.ts`.

---

## Development and Operations

```bash
npm install
cp .env.example .env
cp .env.example server/.env
npm run seed --workspace server
npm run dev
```

| Service | URL |
|---------|-----|
| Web | http://localhost:3000 |
| API | http://localhost:4000 |
| Health | http://localhost:4000/api/health |

### Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Web + server |
| `npm run dev:mobile` | Expo dev server |
| `npm run build` | Build web + server |
| `npm run typecheck` | TypeScript all workspaces |
| `npm test --workspace server` | Jest suite |

### Demo accounts (after seed)

| Role | Email | Password |
|------|-------|----------|
| Coach (owner) | coach.kumar@acme.test | Coach@123 |
| Coach | coach.singh@acme.test | Coach@123 |
| Athlete | athlete.arjun@acme.test | Athlete@123 |
| Guardian | parent.rao@acme.test | Guardian@123 |

Also seeded: athlete.bala, athlete.chetan, athlete.diya @ acme.test / Athlete@123

---

## Testing

```bash
npm test --workspace server
```

203 tests across 17 suites. Covers auth, RBAC, dashboard, athlete workspace, RPE, onboarding, messaging, media, analytics.

Mobile has focused Ask Agent intent tests; use `npm run typecheck` for mobile and server.

---

## Deployment

- **Local full stack:** `docker compose up --build`
- **Production:** `deploy.bat` deploys scp-server to Google Cloud Run
- Mobile builds are produced from `mobile/` with Expo/EAS
- MongoDB Atlas requires Cloud Run egress IPs on allowlist

---

## Project Status

### Shipped

Three-role mobile workspaces, JWT and Google auth, coach-led onboarding, daily cards with readiness/risk, RPE monitoring, trends and activity feeds, squad analytics, messaging, notifications, announcements, water tracking, session photos, avatars, achievements, Ask Agent, AI Tour, and server tests.

### In progress

Athlete mobile messaging, sport-specific performance catalog UI, real-time messaging (currently poll-based).

---

## Related Documentation

| Document | Contents |
|----------|----------|
| [README.md](README.md) | Quick start, scripts, feature checklist |
| [APP_WORKFLOW.md](APP_WORKFLOW.md) | End-to-end flows and API reference |
| [CLAUDE.md](CLAUDE.md) | Agent guardrails and commands |
| [skills/sports-coaching-platform-builder/](skills/sports-coaching-platform-builder/) | Full blueprint (schema, RBAC, API, UI) |

---

*Last updated: July 2026*
