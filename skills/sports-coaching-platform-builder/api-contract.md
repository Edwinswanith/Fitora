# API Contract

All endpoints are Next.js route handlers under `app/api/*`. JSON in, JSON out. Auth via httpOnly `accessToken` cookie.

Error shape: `{ "error": { "code": "FORBIDDEN", "message": "..." } }`.
Success shape: `{ "data": ... }` or `{ "data": [...], "meta": { "page", "pageSize", "total" } }`.

Legend per endpoint:
- **Auth**: required role(s)
- **Scope**: how the coach-scope rule is enforced

---

## Auth

### POST `/api/auth/login`
- Auth: public
- Body: `{ email, password }`
- Returns: `{ data: { user: { id, role, name } } }`; sets `accessToken` + `refreshToken` cookies.

### POST `/api/auth/logout`
- Auth: any logged-in
- Clears cookies, invalidates refresh hash.

### POST `/api/auth/refresh`
- Auth: refresh cookie
- Rotates tokens.

### GET `/api/auth/me`
- Auth: any logged-in
- Returns: `{ data: { id, role, name, email } }`.

---

> **No admin endpoints.** The admin role was removed by client request; there is no `/api/admin/*` surface. Any request to `/api/admin/*` returns `404 { error: "not_found" }`. Coaches, athletes, and assignments are seeded/managed out-of-band — do not reintroduce admin routes without an explicit ask.

---

## Coach

All coach endpoints run `withAuth → withRole(["coach"]) → withScope({ resource: "coach" })`, so `actor.assignedAthleteIds` is always available.

### GET `/api/coach/athletes`
- Returns athletes where `_id ∈ assignedAthleteIds`.
- Query: `?q=name&sport=...`
- **Scope**: filter `{ _id: { $in: assignedAthleteIds } }`.

### GET `/api/coach/athletes/:id`
- **Scope**: `assertCanAccessAthlete(actor, id)`.

### POST `/api/coach/athletes` — coach-led onboarding
- Body: `{ name, email, sport, position?, timezone? }`
- Creates `User{ role:"athlete", academyId: actor.academyId }` + `AthleteProfile` + `CoachAthleteAssignment{ coachId: actor, assignedBy: actor }`. Returns `201 { athlete, tempPassword }` (temp password shown once; only its bcrypt hash is stored). `409 email_already_exists` on duplicate; rolls back partial creates on failure (no transactions in this stack). Audited `outcome:"allow", reason:"athlete_created"`.
- **Scope**: coach can only create `athlete`/`guardian` roles, in their own academy. Replaces the removed admin provisioning.

### POST `/api/coach/athletes/:id/guardians`
- Body: `{ name, email, relationship? }`
- **Scope**: `requireAthleteAccess(id)` — coach may only add guardians to assigned athletes.
- Creates `User{ role:"guardian" }` + `GuardianAthleteLink`, OR reuses an existing guardian account with that email (one parent ↔ many athletes). `201 { guardian, linkedExisting, tempPassword? }`. `409 already_linked` / `email_already_exists`. Audited `reason:"guardian_linked"`.

### GET/POST `/api/coach/coaches` — academy owner only
- **Auth/Scope**: coach **with `isAcademyOwner: true`** (a scoped capability, *not* an admin role); `requireOwner` → `403 forbidden_not_owner` otherwise.
- `GET` lists coaches in the owner's academy. `POST { name, email }` creates `User{ role:"coach", academyId: owner's, isAcademyOwner:false, mustChangePassword:true }` + temp password → `201 { coach, tempPassword }`. `409 email_already_exists`. Audited `reason:"coach_created"`. New coaches are not owners.

### GET `/api/coach/stats/daily`
- Query: `?date=YYYY-MM-DD` (defaults to today in coach's tz)
- Returns daily stats row per assigned athlete for that date.
- **Scope**: `DailyStat.find({ athleteId: { $in: assignedAthleteIds }, date })`.

### GET `/api/coach/attendance`
- Query: `?from=&to=&athleteId?`
- If `athleteId` provided → assert access.
- Else → filter by `{ athleteId: { $in: assignedAthleteIds } }`.

### POST `/api/coach/attendance`
- Body: `{ athleteId, date, status, note? }`
- **Scope**: assert access to `athleteId` before write.

### GET `/api/coach/training`
- Query: `?athleteId?&from=&to=&status?`
- **Scope**: same pattern.

### POST `/api/coach/training`
- Body: `{ athleteId, date, type, plan, durationMin?, notes? }`
- Sets `coachId = actor.coachId`.
- **Scope**: assert access.

### PATCH `/api/coach/training/:sessionId`
- Resolve the session, then `assertCanAccessAthlete(actor, session.athleteId)`.

### GET `/api/coach/wellness`
- Query: `?athleteId?&from=&to=`
- **Scope**: assert or `$in`.

### GET `/api/coach/recovery`
- Same pattern as wellness.

### GET `/api/coach/performance`
- Query: `?athleteId?&metric?&from=&to=`
- **Scope**: same pattern.

### POST `/api/coach/performance`
- Body: `{ athleteId, date, metric, value, unit, context? }`
- **Scope**: assert access.

---

## Athlete

All athlete endpoints run `withAuth → withRole(["athlete"]) → withScope({ resource: "athlete" })`, so `actor.athleteId` is the only id ever used.

### GET `/api/athlete/dashboard`
- Returns last 7d of daily stats for self.

### GET/POST `/api/athlete/wellness`
- POST body: `{ date, sleepHours, sleepQuality, mood, stress, soreness, fatigue, note? }`
- Always scoped to `actor.athleteId`.

### GET/POST `/api/athlete/recovery`
- Same pattern.

### GET `/api/athlete/training`
- Lists own sessions; allows PATCH to update `status` + `intensityRpe` on own sessions only.

### GET `/api/athlete/performance`
- Read-only for athletes (coaches create entries).

---

## Guardian

All guardian endpoints run `withAuth → withRole(["guardian"]) → withScope({ resource: "guardian" })`, so `actor.linkedAthleteIds` is always available. Guardians are **read-only** — there are no guardian write endpoints. Access to a non-linked athlete returns `403 { error: { code: "FORBIDDEN", message: "not_linked_guardian" } }`.

### GET `/api/guardian/athletes`
- Returns linked-athlete roster (summary only).
- **Scope**: filter `{ _id: { $in: linkedAthleteIds } }`.

### GET `/api/guardian/athletes/:id/daily-card`
- Query: `?date=YYYY-MM-DD`
- **Scope**: `assertCanAccessAthlete(actor, id)`.

### GET `/api/guardian/athletes/:id/coach-comments`
- Coach feedback for a linked athlete.

### GET `/api/guardian/athletes/:id/trends` / `.../activity`
- Read-only per-day trend series / recent-activity timeline. **Scope**: assert access.

---

## Authorization snippet (canonical pattern)

Every coach endpoint should look approximately like this:

```ts
export const GET = withAuth(withRole(["coach"], withScope("coach", async (req, ctx) => {
  const { actor } = ctx;
  const url = new URL(req.url);
  const athleteId = url.searchParams.get("athleteId");

  if (athleteId) {
    assertCanAccessAthlete(actor, new ObjectId(athleteId));
    const rows = await Wellness.find({ athleteId, ...dateRange(url) }).lean();
    return json({ data: rows });
  }

  const rows = await Wellness.find({
    athleteId: { $in: actor.assignedAthleteIds },
    ...dateRange(url),
  }).lean();
  return json({ data: rows });
})));
```

This is the **only** pattern coach handlers should use for reads/writes touching athlete data.
