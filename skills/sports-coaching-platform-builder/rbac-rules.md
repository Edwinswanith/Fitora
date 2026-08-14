# RBAC / Access-Control Plan

## Principles

1. **Role-based gate first** — which role(s) can hit the endpoint at all.
2. **Scope filter second** — for coaches, narrow data to assigned athletes; for athletes, narrow to self.
3. **Default deny** — anything not explicitly allowed is denied.
4. **Enforce in the data layer** — never trust the client to pass the right `athleteId`.

## Roles

| Role     | Description                                              |
|----------|----------------------------------------------------------|
| coach    | Read/write only for athletes assigned to them.           |
| athlete  | Read/write only their own records.                       |
| guardian | Read-only access to linked athletes' summaries.          |

There is **no admin role** — it was removed by client request. `User.academyId` still tags rows for audit but no longer gates access. Do not reintroduce admin without an explicit ask.

## Permission matrix

Legend: `R` = read, `W` = write/create/update, `—` = no access, `R(scope)` = read constrained by scope.

| Resource              | coach              | athlete (self)      | guardian (linked)   |
|-----------------------|--------------------|---------------------|---------------------|
| User accounts         | —                  | R (self), W (self profile) | R (self)     |
| Coaches               | R (self)           | —                   | —                   |
| Athletes              | R(assigned only)   | R (self)            | R(linked only)      |
| CoachAssignment       | R (where coach=self) | —                 | —                   |
| Attendance            | R/W(assigned only) | R (self)            | R(linked only)      |
| TrainingSession       | R/W(assigned only) | R (self), W (status update + RPE) | R(linked only) |
| Wellness              | R(assigned only)   | R/W (self)          | R(linked only)      |
| Recovery              | R(assigned only)   | R/W (self)          | R(linked only)      |
| Performance           | R/W(assigned only) | R (self)            | R(linked only)      |
| DailyStat             | R(assigned only)   | R (self)            | R(linked only)      |
| AuditLog              | —                  | —                   | —                   |

## Middleware contracts

### `withAuth(handler)`
- Reads `accessToken` cookie.
- Verifies JWT signature + expiry.
- Loads `User` (cached) to confirm `isActive`.
- Attaches `req.actor = { userId, role }`.
- On failure → 401.

### `withRole(allowedRoles[])`
- Runs after `withAuth`.
- If `actor.role` not in `allowedRoles` → 403.

### `withScope({ resource })`
- Runs after `withRole`.
- For `role === "coach"`: queries `CoachAssignment.find({ coachId: actor.coachId, endedAt: null })` → produces `actor.assignedAthleteIds: ObjectId[]`.
- For `role === "athlete"`: sets `actor.athleteId = ...` from the `athletes` table.
- For `role === "guardian"`: queries `GuardianAthleteLink.find({ guardianId: actor.userId, endedAt: null })` → produces `actor.linkedAthleteIds: ObjectId[]` (read-only).

### Scope guard helper

```
function assertCanAccessAthlete(actor, athleteId) {
  if (actor.role === "coach") {
    if (!actor.assignedAthleteIds.some(id => id.equals(athleteId))) {
      audit("deny", actor, athleteId, "not_in_assignments");
      throw new ForbiddenError();
    }
    return;
  }
  if (actor.role === "athlete") {
    if (!actor.athleteId.equals(athleteId)) {
      audit("deny", actor, athleteId, "not_self");
      throw new ForbiddenError();
    }
    return;
  }
  if (actor.role === "guardian") {
    if (!actor.linkedAthleteIds.some(id => id.equals(athleteId))) {
      audit("deny", actor, athleteId, "not_linked_guardian");
      throw new ForbiddenError();
    }
    return; // read-only — guardians have no write endpoints
  }
  throw new ForbiddenError();
}
```

Every coach/athlete endpoint that takes an `athleteId` parameter MUST call this before reading or writing.

### Bulk list endpoints

For endpoints like `GET /api/coach/athletes` that return *many* records, do not call `assertCanAccessAthlete` per row. Instead, apply the filter directly in the Mongo query:

```
const filter = { athleteId: { $in: actor.assignedAthleteIds } };
```

This guarantees the coach can only ever load assigned athletes, even if a buggy UI sent no filter. Guardians use the equivalent `{ athleteId: { $in: actor.linkedAthleteIds } }` filter on their read-only endpoints.

## Edge-level guard (Next.js `middleware.ts`)

- `/login`, `/register` → public.
- `/api/auth/*` → public.
- `/coach/*` and `/api/coach/*` → require role `coach`.
- `/athlete/*` and `/api/athlete/*` → require role `athlete`.
- `/guardian/*` and `/api/guardian/*` → require role `guardian`.

The edge middleware only does **role gating**, not scope. Scope must be checked inside the handler (it requires a DB read).

## Audit-log triggers

Write to `audit_logs` on:
- Every `deny` from `assertCanAccessAthlete`.
- Every assignment create/end.
- Every login success and failure.
