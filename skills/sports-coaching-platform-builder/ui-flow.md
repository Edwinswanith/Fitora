# UI Page Flow

Three role-scoped UI shells under route groups: `(coach)`, `(athlete)`, `(guardian)`. After login, the user is redirected based on their `role`.

## Shared shell

- **Topbar**: app logo, user menu (profile, logout).
- **Sidebar**: role-aware nav links.
- **Theme**: Tailwind, neutral light theme with one accent (lime or indigo). Cards, soft shadows, rounded-2xl.

## Public flow

```
/login ──► (POST /api/auth/login) ──► role switch
   │
   ├── coach    → /coach/dashboard
   ├── athlete  → /athlete/dashboard
   └── guardian → /guardian/dashboard
```

`/register` exists only for athletes (self sign-up); coaches and guardians are provisioned out-of-band. There is **no admin UI** — the admin role was removed by client request.

---

## Coach flow  (most important — scope rule applies to every page)

Every page below loads data ONLY for athletes assigned to the logged-in coach. The pages never expose an "all athletes" view.

| Page                              | Purpose                                              | Data source (API)                                |
|-----------------------------------|------------------------------------------------------|--------------------------------------------------|
| `/coach/dashboard`                | Today's snapshot across assigned athletes            | `GET /api/coach/stats/daily?date=today`          |
| `/coach/athletes`                 | List of assigned athletes                            | `GET /api/coach/athletes`                        |
| `/coach/athletes/new`             | Onboard a new athlete (+ optional guardian); shows a one-time temp password | `POST /api/coach/athletes`, `POST /api/coach/athletes/:id/guardians` |
| `/coach/athletes/[id]`            | Single athlete profile + recent metrics              | `GET /api/coach/athletes/:id` + cross-resource   |
| `/coach/attendance`               | Roster grid: athletes × dates                        | `GET /api/coach/attendance?from&to`              |
| `/coach/training`                 | Plan/manage sessions; calendar view                  | `GET /api/coach/training?from&to`                |
| `/coach/wellness`                 | Trend charts for assigned athletes                   | `GET /api/coach/wellness?from&to`                |
| `/coach/recovery`                 | Recovery score table + trend                         | `GET /api/coach/recovery?from&to`                |
| `/coach/performance`              | Test results, PRs, comparisons                       | `GET /api/coach/performance?metric&from&to`      |

### Dashboard layout

- 4 KPI cards: # athletes, present today, sessions completed today, avg wellness today.
- Table: athlete | attendance | training status | wellness | recovery | last performance — one row per assigned athlete. Click row → `/coach/athletes/[id]`.

### Athlete detail page

Tabs: **Overview**, **Training**, **Wellness**, **Recovery**, **Performance**, **Attendance**.
Each tab is a chart-and-table combo. All read-only data is filtered server-side.

### Empty states

If a coach has zero assignments, every page shows "No athletes assigned yet." rather than empty tables. This avoids the impression of broken data.

---

## Athlete flow

| Page                        | Purpose                                             |
|-----------------------------|-----------------------------------------------------|
| `/athlete/dashboard`        | Today's session + 7d wellness/recovery trend        |
| `/athlete/wellness`         | Submit daily check-in; see history                  |
| `/athlete/recovery`         | Submit recovery metrics; see history                |
| `/athlete/training`         | View prescribed sessions; mark complete + RPE       |
| `/athlete/performance`      | Read-only performance history                       |

### Wellness check-in form

Single-page form with sliders 1–5 for mood/stress/soreness/fatigue/sleep-quality, numeric input for sleep hours, optional note. Submit → POST → redirect to history view with new entry highlighted.

---

## Guardian flow

Read-only, scoped to linked athletes (`GuardianAthleteLink`). Guardians have no write actions.

| Page                        | Purpose                                             |
|-----------------------------|-----------------------------------------------------|
| `/guardian/dashboard`       | Linked-athlete picker + read-only daily card (attendance / readiness / sessions / recovery / injury / RPE risk) + coach feedback |

Access to a non-linked athlete returns `403 not_linked_guardian`.

---

## Route protection

- `middleware.ts` enforces role at the edge.
- Layouts (`(coach)/layout.tsx` etc.) re-check role server-side and render `RoleGuard` fallback if mismatch (defense in depth).
- Client components only call endpoints for their own role shell.

## Component reuse

- `<StatCard>` for KPI tiles.
- `<DataTable>` with column defs for athlete lists.
- `<TrendChart>` (Recharts) for wellness/recovery/performance series.
- `<AthletePicker>` for coaches: queries `/api/coach/athletes` and shows only assigned athletes — used in attendance and training forms so the coach physically cannot pick an unassigned athlete.
