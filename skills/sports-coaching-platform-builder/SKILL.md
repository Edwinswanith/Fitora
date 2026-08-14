---
name: sports-coaching-platform-builder
description: Blueprint, verify, and build a production-grade sports coaching and athlete management platform using Next.js, TypeScript, Tailwind, Node.js/Express, MongoDB/Mongoose, JWT auth, RBAC, and tested athlete-coach workflows. Use this skill whenever the user wants to plan, audit, scaffold, extend, fix, or improve a coaching platform, athlete management system, RPE monitoring system, training dashboard, wellness/recovery tracker, or multi-role sports app. Strictly enforces that each coach only sees assigned athletes and that every feature supports the athlete → coach → training → recovery → performance loop.
---

# Sports Coaching Platform Builder

This skill designs, audits, verifies, and implements a sports coaching and athlete management web application.

It must not behave like a generic CRUD app builder. This platform is a sports performance operating system for academies, coaches, athletes, guardians, and support staff.

## Core product loop

Every feature must support this loop:

Athlete
→ Daily training
→ Attendance
→ Wellness
→ RPE / training load
→ Recovery
→ Coach feedback
→ Performance tracking
→ Adapted next plan

If a feature does not strengthen this loop, deprioritize it.

## Non-negotiable core invariant

A coach must only ever see data for athletes explicitly assigned to that coach.

This applies to:
- Athlete profile
- Daily stats
- Attendance
- Training sessions
- Wellness
- RPE monitoring
- Recovery
- Performance
- Injury notes
- Coach comments
- Messages
- Analytics

Enforcement must happen in three layers:

1. JWT authentication middleware
   - Verifies identity.
   - Attaches `userId`, `role`, and scope context.

2. Server-side authorization guard
   - Resolves assigned athlete IDs from `CoachAthleteAssignment`.
   - Every coach-scoped Mongo query must include:
     `{ athleteId: { $in: assignedAthleteIds } }`
   - Single-athlete routes must verify the athlete is assigned before reading or writing.

3. UI route guard
   - Pages call only role-aware endpoints.
   - Never rely on frontend filtering to hide unauthorized data.

Never bypass RBAC for convenience.

## Roles

Supported roles:

- `coach`
- `athlete`
- `guardian`

There is **no admin role** — it was removed by client request. Do not reintroduce an `admin` role, `/admin/*` UI, or `/api/admin/*` endpoints without an explicit ask. `User.academyId` still tags rows for audit but does not gate access.

Minimum access rules:

### Coach
Can read and write only assigned athlete data.

### Athlete
Can read and write only own daily data.

Athlete routes must always use:

`req.actor.athleteProfileId`

Never trust `athleteId` from request body.

### Guardian
Can view only linked athlete summaries.

## Required implementation order

Never build UI first.

For every feature, follow this order:

1. Confirm business workflow.
2. Confirm MongoDB schema and indexes.
3. Implement backend model.
4. Implement API route.
5. Implement RBAC guard.
6. Add validation and error handling.
7. Add tests.
8. Only then build UI.
9. Update README and relevant docs.

If any step is missing, stop and report the gap.

## Database rules

Use MongoDB with Mongoose.

Database name for current project:

`athletes`

Daily records must prevent accidental duplicates using compound indexes.

Examples:

- Attendance: `athleteId + date`
- Wellness: `athleteId + date`
- Recovery: `athleteId + date`
- TrainingSession: `athleteId + date + slot`
- RpeMonitoring: `athleteId + date + sessionType`

Use `upsert` for editable same-day records.

Do not create duplicate daily rows unless the business logic explicitly allows multiple entries.

## RPE monitoring requirement

The client's RPE monitoring workflow is a core product requirement.

RPE Monitoring must support:

- Date
- Day, derived server-side from date
- Session type: AM / PM
- Training category
- Planned intensity %
- RPE 0-10
- Body condition feedback
- Resting heart rate
- Sleep quality 0-5
- Muscle soreness 0-5
- Fatigue 0-5
- Mood / motivation 0-5
- Calculated training load
- Risk flag
- Risk reasons
- Optional readiness score

Training category must include the client's categories:

- ENDURANCE
- TEMPO / EXTENSIVE
- ACCELERATION (SHORT)
- MAX SPEED
- SPEED ENDURANCE
- SPECIAL ENDURANCE I
- SPECIAL ENDURANCE II
- LOW INTENSITY PLYO
- MODERATE PLYOS
- HIGH INTENSITY PLYOS
- TECHNIQUE / COORDINATION DRILLS
- CORE / STABILITY
- GENERAL STRENGTH & MOBILITY
- EXPLOSIVE / OLYMPIC LIFTS
- STRENGTH ENDURANCE
- Mental Skills / Focus
- Visualization / Breathing
- Competition Simulation
- SWIMMING
- MASSAGE
- ICE BATH
- ACTIVE REST / REST
- REHAB
- SUB MAX VELOCITY - SPEED ENDURANCE/SPECIAL
- SUB MAX VELOCITY - SPECIAL ENDURANCE 2
- Test / Trials
- Elastic Reactive Strength

## RPE risk logic

Minimum rule:

```ts
RED   if rpe >= 8 and fatigue >= 4
RED   if muscleSoreness >= 4 and fatigue >= 4
AMBER if sleepQuality <= 2
AMBER if moodMotivation <= 2
AMBER if restingHeartRate >= 100
GREEN otherwise
```

Always return:

```ts
riskFlag: "green" | "amber" | "red"
riskReasons: string[]
```

A risk flag without reasons is not useful.

## Readiness score

When possible, compute readiness score from:

- Sleep quality
- Mood / motivation
- Fatigue
- Muscle soreness

Output:

```ts
readinessScore: number // 0-100
readinessFlag: "green" | "amber" | "red"
```

Suggested thresholds:

- Green: 80-100
- Amber: 60-79
- Red: below 60

Do not claim medical prediction. Use wording like:

- risk flag
- readiness indicator
- coach decision support

Never say:

- injury prediction
- medical diagnosis
- guaranteed recovery recommendation

## UI design standard

The UI must feel like a sports performance platform, not an ERP or admin dashboard.

Design inspiration:

- WHOOP
- Garmin Connect
- Strava
- Oura
- Nike Run Club

Style rules:

- Mobile-first for athletes.
- Desktop-first but responsive for coaches.
- Use cards, chips, status indicators, progress rings, timeline blocks, and simple charts.
- Avoid dense tables unless the coach needs comparison across many athletes.
- Use clear status colors:
  - Green: good / ready
  - Amber: caution
  - Red: risk / attention
- Every dashboard must answer:
  - What happened?
  - What is happening today?
  - What needs attention?
  - What should the coach do next?

Athlete UI must be fast and simple. If athlete logging takes too long, compliance will fail.

## Frontend requirements

Every form must include:

- Loading state
- Error state
- Success state
- Field validation
- Mobile-first layout
- Edit same-day entry flow
- Empty state
- Sign-out handling
- 401/403 handling

Do not build placeholder UI unless explicitly requested.

## API requirements

Every API route must have:

- Auth middleware
- Role middleware
- Scope guard
- Input validation
- Predictable error response
- Tests
- No leaked passwordHash
- No client-trusted athleteId for athlete writes

Use clear errors:

```json
{ "error": "invalid_date" }
{ "error": "not_in_assignments" }
{ "error": "invalid_trainingCategory" }
{ "error": "invalid_sessionType" }
{ "error": "server_error" }
```

## Error handling

All backend routes must fail gracefully.

Add global Express error middleware.

Never allow user input validation errors to crash the dev server.

- Invalid user input must return 400, not 500.
- Unauthorized access must return 401 or 403.

## Security requirements

- Never expose passwordHash.
- Use httpOnly cookies for refresh tokens.
- Use short-lived access tokens.
- Rate-limit login.
- Add write rate limits for athlete daily submission endpoints.
- Redact MongoDB URI in logs.
- Never commit .env.
- Rotate credentials if exposed.
- Audit cross-scope access attempts.

## Testing requirements

Every feature must include tests.

Minimum tests:

- Coach cannot see another coach's athlete.
- Athlete cannot see or write another athlete's data.
- Guardian cannot see unlinked athletes.
- Invalid input returns 400.
- Unauthorized access returns 401.
- Forbidden access returns 403.
- RPE risk flag works.
- Risk reasons are returned.
- Coach dashboard reflects athlete submissions.
- Duplicate AM/PM RPE entries update safely instead of duplicating.
- Audit log records denied cross-scope access where applicable.

Do not consider a feature complete until tests pass.

## Workflow for new requests

When the user asks to add, fix, or verify a feature, first output:

- Current state
- Requirement mapping
- Data model impact
- API impact
- RBAC impact
- UI impact
- Test impact
- Risk or flaw in the request
- Recommended implementation order

Only after that, implement.

## When auditing

When asked to verify the project, check:

- Folder structure
- Models
- Routes
- Middleware
- RBAC
- UI routes
- Tests
- MongoDB indexes
- Error handling
- Security
- Client requirement alignment
- Missing product loops

Then classify issues as:

- Critical
- High
- Medium
- Low

Do not modify files until the audit is complete and the user confirms scope.

## When in doubt

Use first principles.

Ask:

- Who generates this data?
- Who consumes this data?
- What decision does it improve?
- What could go wrong if access control fails?
- Can this be tested?
- Does this improve the athlete-coach performance loop?

If the answer is unclear, do not build blindly.
