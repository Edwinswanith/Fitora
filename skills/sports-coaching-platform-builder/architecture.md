# Product Architecture

## 1. System overview

A multi-tenant-style web app with three roles (coach, athlete, guardian) backed by a single MongoDB instance. Next.js serves both the UI (App Router, server components where possible) and the API (Route Handlers under `app/api/*`). Auth is JWT-based using an httpOnly access-token cookie and a rotating refresh token.

```
┌────────────────────────────────────────────────────────────┐
│                       Browser (Next.js)                    │
│   React Server Components + Client Components + Tailwind   │
└───────────────────────────┬────────────────────────────────┘
                            │ fetch (cookie: accessToken)
┌───────────────────────────▼────────────────────────────────┐
│           Next.js API Route Handlers (Node runtime)        │
│  ┌──────────────┐  ┌────────────────┐  ┌───────────────┐   │
│  │ authMiddleware│ │ rbac/scope guard│ │ controllers   │   │
│  └──────────────┘  └────────────────┘  └───────┬───────┘   │
└──────────────────────────────────────────────┬─┴───────────┘
                                               │
                                       ┌───────▼────────┐
                                       │   Mongoose     │
                                       │   MongoDB      │
                                       └────────────────┘
```

## 2. Layers

1. **Presentation** — Next.js App Router pages, grouped by role: `(coach)`, `(athlete)`, `(guardian)`. Shared UI primitives in `components/`.
2. **API** — `app/api/*` route handlers. Each handler is thin: parse → authenticate → authorize/scope → call service → respond.
3. **Services** — Business logic in `lib/services/*`. Services accept an `actor` (role + userId + assignedAthleteIds for coaches) so they can scope queries without re-reading auth.
4. **Data** — Mongoose models in `lib/models/*`. Indexes defined on the model for query performance.
5. **Auth** — `lib/auth/*` for JWT sign/verify, password hashing, refresh-token rotation.

## 3. Folder structure

```
sports-coaching-platform/
├── app/
│   ├── (public)/
│   │   ├── login/page.tsx
│   │   └── register/page.tsx
│   ├── (coach)/
│   │   ├── layout.tsx
│   │   ├── dashboard/page.tsx          // only assigned athletes
│   │   ├── athletes/page.tsx           // only assigned athletes
│   │   ├── athletes/[id]/page.tsx
│   │   ├── attendance/page.tsx
│   │   ├── training/page.tsx
│   │   ├── wellness/page.tsx
│   │   ├── recovery/page.tsx
│   │   └── performance/page.tsx
│   ├── (athlete)/
│   │   ├── layout.tsx
│   │   ├── dashboard/page.tsx
│   │   ├── wellness/page.tsx
│   │   ├── recovery/page.tsx
│   │   └── performance/page.tsx
│   ├── (guardian)/
│   │   ├── layout.tsx
│   │   └── dashboard/page.tsx           // read-only, linked athletes
│   ├── api/
│   │   ├── auth/[login|logout|refresh|me]/route.ts
│   │   ├── coach/
│   │   │   ├── athletes/route.ts
│   │   │   ├── athletes/[id]/route.ts
│   │   │   ├── stats/daily/route.ts
│   │   │   ├── attendance/route.ts
│   │   │   ├── training/route.ts
│   │   │   ├── wellness/route.ts
│   │   │   ├── recovery/route.ts
│   │   │   └── performance/route.ts
│   │   ├── athlete/[wellness|recovery|performance]/route.ts
│   │   └── guardian/athletes/[id]/[daily-card|trends|activity]/route.ts
│   ├── layout.tsx
│   └── globals.css
├── components/
│   ├── ui/                  // Button, Card, Table, StatCard, Modal
│   ├── charts/              // Recharts wrappers
│   ├── forms/
│   └── layout/              // Sidebar, Topbar, RoleGuard
├── lib/
│   ├── auth/
│   │   ├── jwt.ts
│   │   ├── password.ts
│   │   └── session.ts       // cookie helpers
│   ├── db/
│   │   └── mongoose.ts      // singleton connection
│   ├── middleware/
│   │   ├── withAuth.ts
│   │   └── withScope.ts     // resolves assigned athletes for coaches
│   ├── models/
│   │   ├── User.ts
│   │   ├── Athlete.ts
│   │   ├── Coach.ts
│   │   ├── CoachAssignment.ts
│   │   ├── Attendance.ts
│   │   ├── TrainingSession.ts
│   │   ├── Wellness.ts
│   │   ├── Recovery.ts
│   │   ├── Performance.ts
│   │   └── DailyStat.ts
│   ├── services/
│   │   ├── auth.service.ts
│   │   ├── assignment.service.ts
│   │   ├── athlete.service.ts
│   │   ├── attendance.service.ts
│   │   ├── training.service.ts
│   │   ├── wellness.service.ts
│   │   ├── recovery.service.ts
│   │   ├── performance.service.ts
│   │   └── stats.service.ts
│   ├── rbac/
│   │   └── policy.ts        // central allow/deny matrix
│   └── validators/          // zod schemas per endpoint
├── middleware.ts            // Next.js edge: route-level auth + role gate
├── types/
│   └── index.d.ts
├── public/
├── .env.local
├── next.config.js
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

## 4. Request lifecycle (coach reading athlete wellness)

1. Browser GET `/api/coach/wellness?athleteId=A1&date=2026-05-26` (cookie attached).
2. `withAuth` verifies JWT → attaches `{ userId, role: "coach" }`.
3. `withScope` loads `CoachAssignment` for `userId` → `assignedIds = [A1, A2, ...]`.
4. Guard: `if (!assignedIds.includes(A1)) return 403`.
5. Service: `Wellness.find({ athleteId: A1, date })`.
6. Response: 200 JSON.

The guard step is the critical one; it is what makes the data layer enforce the coach-scope rule.

## 5. Cross-cutting concerns

- **Logging**: every 403 (unauthorized cross-scope read) logged to an `AuditLog` collection.
- **Validation**: zod schemas at the API boundary.
- **Errors**: standardized `{ error: { code, message } }` shape.
- **Time**: store timestamps in UTC; render in athlete's timezone on the client.
