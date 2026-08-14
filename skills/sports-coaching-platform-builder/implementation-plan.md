# Step-by-Step Implementation Checklist

Follow in order. Do not skip steps — each one is a prerequisite for the next. Check items off as you complete them.

## Phase 0 — Project setup

- [ ] `npx create-next-app@latest sports-coaching-platform --typescript --tailwind --app --eslint`
- [ ] Install deps: `mongoose`, `bcryptjs`, `jsonwebtoken`, `zod`, `recharts`, `date-fns`, `clsx`.
- [ ] Install dev deps: `@types/bcryptjs`, `@types/jsonwebtoken`.
- [ ] Create `.env.local` with `MONGODB_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL=15m`, `JWT_REFRESH_TTL=30d`.
- [ ] Configure Tailwind theme tokens (one accent color, neutral palette).
- [ ] Scaffold folder structure from `architecture.md`.

## Phase 1 — Database layer

- [ ] `lib/db/mongoose.ts`: singleton connection (cached on `global` for dev hot-reload).
- [ ] Define Mongoose models in `lib/models/` per `database-schema.md`:
  - [ ] `User`, `Coach`, `Athlete`
  - [ ] `CoachAssignment` (with partial unique index on active rows)
  - [ ] `Attendance`, `TrainingSession`
  - [ ] `Wellness`, `Recovery`, `Performance`
  - [ ] `DailyStat`, `AuditLog`
- [ ] Add indexes on each model per the schema doc.
- [ ] Write a seed script `scripts/seed.ts`: 2 coaches, 6 athletes, 1 guardian, assignments split 3/3.

## Phase 2 — Auth

- [ ] `lib/auth/password.ts`: bcrypt hash + verify.
- [ ] `lib/auth/jwt.ts`: sign/verify access + refresh tokens.
- [ ] `lib/auth/session.ts`: cookie helpers (httpOnly, sameSite=lax, secure in prod).
- [ ] `POST /api/auth/login` — verify password, issue tokens, set cookies.
- [ ] `POST /api/auth/logout`
- [ ] `POST /api/auth/refresh` — rotate refresh token (store hash on user).
- [ ] `GET /api/auth/me`
- [ ] Build `/login` page with a single email/password form; redirect by role after success.

## Phase 3 — Middleware + RBAC

- [ ] `middleware.ts` (edge): role gate per path prefix (`/coach/*`, `/athlete/*`, `/guardian/*`).
- [ ] `lib/middleware/withAuth.ts`: parse cookie, verify JWT, load user.
- [ ] `lib/middleware/withRole.ts`: allowed-roles guard.
- [ ] `lib/middleware/withScope.ts`: for coach, load `CoachAssignment` → `assignedAthleteIds`; for athlete, load `athleteId`.
- [ ] `lib/rbac/policy.ts`: `assertCanAccessAthlete(actor, athleteId)` + `auditDeny()`.
- [ ] Compose helper `composeHandlers(...)` so each route reads cleanly.

## Phase 4 — Provisioning

There is **no admin UI** (the admin role was removed by client request). Coaches, athletes, guardians, and coach↔athlete / guardian↔athlete assignments are created via the seed script or out-of-band scripts.

- [ ] Ensure `scripts/seed.ts` creates the full role/assignment graph (coaches, athletes, guardian links).
- [ ] Any future user/assignment management must ship as a deliberately-scoped, audited feature — not a reintroduced admin surface.

## Phase 5 — Coach features (the critical phase)

Implement in this order so the scope rule is exercised early:

- [ ] `GET /api/coach/athletes` — proves `$in: assignedAthleteIds` works.
- [ ] `/coach/athletes` page rendering that list.
- [ ] `GET /api/coach/athletes/:id` — proves `assertCanAccessAthlete` works (test by manually changing the id in the URL).
- [ ] `GET /api/coach/stats/daily` + `/coach/dashboard` page.
- [ ] Attendance: GET + POST + page.
- [ ] Training: GET + POST + PATCH + page.
- [ ] Wellness: GET + page.
- [ ] Recovery: GET + page.
- [ ] Performance: GET + POST + page.

### Phase 5 verification gates

After each endpoint, run these manual tests before moving on:
1. Coach A requests Coach B's athlete → 403 + audit log row.
2. Coach A requests own athlete → 200.
3. List endpoint returns only assigned athletes even with no query params.

## Phase 6 — Athlete features

- [ ] Athlete layout + dashboard.
- [ ] Wellness daily check-in (GET + POST + form).
- [ ] Recovery (GET + POST + form).
- [ ] Training read + PATCH (status, RPE).
- [ ] Performance read-only.

## Phase 7 — Daily stats rollup

- [ ] `stats.service.ts`: `recomputeDailyStat(athleteId, date)` reads from source collections and upserts `daily_stats`.
- [ ] Trigger from attendance/training/wellness/recovery POST handlers.
- [ ] (Optional) cron route `/api/internal/rebuild-stats` for backfill.

## Phase 8 — Polish

- [ ] Loading skeletons on each page.
- [ ] Error boundaries.
- [ ] Empty states (esp. "no athletes assigned").
- [ ] Form validation via zod with inline error messages.
- [ ] Responsive layout (tables → cards on mobile).

## Phase 9 — Hardening

- [ ] Rate-limit `/api/auth/login` (5/min/IP).
- [ ] CSRF: rely on sameSite=lax + double-submit token for POSTs from forms.
- [ ] Add integration tests for the three Phase-5 verification gates.
- [ ] Lighthouse pass.

## Phase 10 — Deployment

- [ ] Mongo Atlas cluster + IP allowlist.
- [ ] Deploy to Vercel; set env vars.
- [ ] Run seed only on staging.
- [ ] Smoke test all role flows on production URL.

---

## Acceptance criteria (don't ship without these)

1. A coach logged in as Coach A, with browser devtools, cannot fetch data for any athlete belonging to Coach B — every such request returns 403 and writes to `audit_logs`.
2. The coach dashboard, attendance, training, wellness, recovery, and performance pages all render only the coach's assigned athletes when called with no filter.
3. Coach↔athlete assignments (created via seed/out-of-band) take effect immediately; ending an assignment immediately removes that athlete from the coach's views.
4. Athletes can read and write only their own wellness/recovery and read their own training/performance.
5. Guardians can read only their linked athletes' summaries and have no write endpoints.
6. All denies are auditable via the `audit_logs` collection.
