# MongoDB Schema Plan

All collections use Mongoose. Timestamps (`createdAt`, `updatedAt`) are added via `{ timestamps: true }` and omitted from the field lists below for brevity.

## Collections

### 1. `users`
The authentication identity. One row per real person.

| Field        | Type                              | Notes                                |
|--------------|-----------------------------------|--------------------------------------|
| `_id`        | ObjectId                          | PK                                   |
| `email`      | string (unique, lowercased)       | login id                             |
| `passwordHash` | string                          | bcrypt                               |
| `role`       | enum: `coach` \| `athlete` \| `guardian` | drives RBAC                   |
| `name`       | string                            |                                      |
| `phone`      | string?                           |                                      |
| `isActive`   | boolean                           | default true                         |
| `refreshTokenHash` | string?                     | for rotating refresh                 |

Indexes: `{ email: 1 } unique`, `{ role: 1 }`.

### 2. `coaches`
Profile data for users with role `coach`.

| Field        | Type            | Notes                            |
|--------------|-----------------|----------------------------------|
| `_id`        | ObjectId        |                                  |
| `userId`     | ObjectId → users (unique) | 1:1 with user          |
| `specialty`  | string?         | e.g. "strength", "endurance"     |
| `bio`        | string?         |                                  |

Indexes: `{ userId: 1 } unique`.

### 3. `athletes`
Profile data for users with role `athlete`.

| Field         | Type                  | Notes                          |
|---------------|-----------------------|--------------------------------|
| `_id`         | ObjectId              |                                |
| `userId`      | ObjectId → users (unique) |                            |
| `dob`         | Date?                 |                                |
| `sport`       | string                |                                |
| `position`    | string?               |                                |
| `heightCm`    | number?               |                                |
| `weightKg`    | number?               |                                |
| `timezone`    | string                | IANA, e.g. "Asia/Kolkata"      |

Indexes: `{ userId: 1 } unique`, `{ sport: 1 }`.

### 4. `coach_assignments`  **(the critical table)**
Many-to-many between coaches and athletes. Every coach-scope query MUST consult this.

| Field         | Type                 | Notes                                |
|---------------|----------------------|--------------------------------------|
| `_id`         | ObjectId             |                                      |
| `coachId`     | ObjectId → coaches   |                                      |
| `athleteId`   | ObjectId → athletes  |                                      |
| `assignedBy`  | ObjectId → users     | user who created the link            |
| `assignedAt`  | Date                 |                                      |
| `endedAt`     | Date?                | null = active                        |

Indexes:
- `{ coachId: 1, endedAt: 1 }` — list active athletes for a coach.
- `{ athleteId: 1, endedAt: 1 }` — find current coach(es) for an athlete.
- `{ coachId: 1, athleteId: 1, endedAt: 1 }` — uniqueness for active assignments (partial unique where `endedAt: null`).

### 5. `attendance`
Per-athlete per-day presence at training.

| Field         | Type                 | Notes                                  |
|---------------|----------------------|----------------------------------------|
| `athleteId`   | ObjectId → athletes  |                                        |
| `date`        | Date (YYYY-MM-DD UTC)|                                        |
| `status`      | enum: `present` \| `absent` \| `late` \| `excused` | |
| `note`        | string?              |                                        |
| `recordedBy`  | ObjectId → users     | coach                                  |

Indexes: `{ athleteId: 1, date: -1 } unique`.

### 6. `training_sessions`
A session prescribed and/or completed.

| Field          | Type                 | Notes                                 |
|----------------|----------------------|---------------------------------------|
| `athleteId`    | ObjectId → athletes  |                                       |
| `coachId`      | ObjectId → coaches   | author                                |
| `date`         | Date                 |                                       |
| `type`         | string               | "strength", "cardio", "skill"…        |
| `plan`         | object               | structured drills                     |
| `status`       | enum: `planned` \| `in_progress` \| `completed` \| `skipped` | |
| `durationMin`  | number?              |                                       |
| `intensityRpe` | number? (1–10)       | athlete-reported                      |
| `notes`        | string?              |                                       |

Indexes: `{ athleteId: 1, date: -1 }`, `{ coachId: 1, date: -1 }`.

### 7. `wellness`
Daily subjective wellness check-in by the athlete.

| Field           | Type                | Range  |
|-----------------|---------------------|--------|
| `athleteId`     | ObjectId → athletes |        |
| `date`          | Date                |        |
| `sleepHours`    | number              | 0–14   |
| `sleepQuality`  | number              | 1–5    |
| `mood`          | number              | 1–5    |
| `stress`        | number              | 1–5    |
| `soreness`      | number              | 1–5    |
| `fatigue`       | number              | 1–5    |
| `note`          | string?             |        |

Indexes: `{ athleteId: 1, date: -1 } unique`.

### 8. `recovery`
Recovery metrics (post-session or daily).

| Field             | Type                | Notes                       |
|-------------------|---------------------|-----------------------------|
| `athleteId`       | ObjectId → athletes |                             |
| `date`            | Date                |                             |
| `restingHr`       | number?             |                             |
| `hrv`             | number?             |                             |
| `recoveryScore`   | number? (0–100)     | derived or device-sourced   |
| `modalities`      | string[]?           | "ice", "massage", "sauna"   |
| `note`            | string?             |                             |

Indexes: `{ athleteId: 1, date: -1 } unique`.

### 9. `performance`
Test/competition results.

| Field        | Type                | Notes                                |
|--------------|---------------------|--------------------------------------|
| `athleteId`  | ObjectId → athletes |                                      |
| `date`       | Date                |                                      |
| `metric`     | string              | "100m", "vertical_jump", "1rm_squat" |
| `value`      | number              |                                      |
| `unit`       | string              | "s", "cm", "kg"                      |
| `context`    | string?             | "test", "competition", "training"    |

Indexes: `{ athleteId: 1, metric: 1, date: -1 }`.

### 10. `daily_stats` (materialized)
Pre-aggregated per-athlete-per-day rollup for fast dashboard reads.

| Field             | Type                | Notes                                  |
|-------------------|---------------------|----------------------------------------|
| `athleteId`       | ObjectId → athletes |                                        |
| `date`            | Date                |                                        |
| `attendanceStatus`| string?             | from `attendance`                      |
| `trainingStatus`  | string?             | from `training_sessions`               |
| `wellnessScore`   | number?             | composite                              |
| `recoveryScore`   | number?             | from `recovery`                        |
| `topPerformance`  | object?             | best metric of day                     |

Indexes: `{ athleteId: 1, date: -1 } unique`.

Recomputed by a service after writes to any source collection (or via a nightly job).

### 11. `audit_logs`

| Field         | Type     | Notes                                              |
|---------------|----------|----------------------------------------------------|
| `actorId`     | ObjectId | user who acted                                     |
| `actorRole`   | string   |                                                    |
| `action`      | string   | e.g. `coach.read.wellness`                         |
| `targetType`  | string   | "athlete"                                          |
| `targetId`    | ObjectId |                                                    |
| `outcome`     | enum: `allow` \| `deny` |                                     |
| `reason`      | string?  | "not_in_assignments"                               |
| `ip`          | string?  |                                                    |

Indexes: `{ actorId: 1, createdAt: -1 }`, `{ outcome: 1, createdAt: -1 }`.

## Referential rules

- Deleting a `User` soft-deletes (set `isActive=false`); never hard-delete to preserve audit trail.
- Ending an assignment sets `endedAt`; we never delete assignment rows.
- All "current coach for athlete X" lookups must filter `endedAt: null`.
