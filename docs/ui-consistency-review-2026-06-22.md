# UI Consistency Review - Updated 2026-06-23

## Current Runtime Status

- `npm run dev` was started successfully outside the sandbox after the in-sandbox attempt hit `spawn EPERM`.
- Web is live at `http://localhost:3000` and returned status `200`.
- API is live at `http://localhost:4000/api/health` and returned `status: ok`.
- Fresh mobile-width web screenshots were captured into:
  - `ui-consistency-review-2026-06-23/`

## Fresh Web Evidence Captured

- Landing and athlete registration.
- Coach login, dashboard, roster, messages, announcements, coaches, notifications.
- Athlete login, dashboard, notifications.
- Guardian login, dashboard, notifications.
- Fixed follow-up captures:
  - `web-03b-coach-dashboard-mobile-fixed.png`
  - `web-04b-coach-roster-mobile-fixed.png`
  - `web-09b-athlete-dashboard-mobile-fixed.png`
  - `web-11b-guardian-dashboard-mobile-fixed.png`

## Fixes From The Fresh Review

- Web app header no longer crushes page titles on phone width:
  - Role/title/user stays on the first row.
  - Date/add page actions move to a second row.
  - Notification/account/logout buttons stay visible and aligned.
- Web coach dashboard now renders cleanly on mobile width:
  - Full title visible.
  - Date and Add controls no longer collide with the title.
- Web coach roster now matches the richer Android roster direction:
  - Search field with icon.
  - All / Attention / Injury / No check-in filters.
  - Result count.
  - Readiness circle.
  - Injury/risk chips.
  - Load/no-RPE state.

## Previously Applied Android/Mobile Parity Fixes

- Android coach dashboard mirrors web structure:
  - KPIs, date rail, needs-attention card, athlete notes, squad analytics, search/filter roster.
- Android coach roster has search, filters, readiness/risk/load rows.
- Android guardian dashboard mirrors Today/Trends/Feedback layout.
- Android coach messaging screen and shared native `MessageCenter` were added.
- Athlete messaging panel and notification deep links were aligned.
- Mobile notification read handling now uses the API `read` field.

## Validation

- `npm run lint --workspace mobile` passed.
- `npm run typecheck --workspace mobile` passed.
- `npm run typecheck --workspace server` passed.
- `git diff --check` passed.
- Mobile and API runtime health checks passed.

## Remaining Unverified Item

- A fresh Android release APK was not produced in this fast pass.
- Current APK output is still:
  - `mobile/android/app/build/outputs/apk/release/app-release.apk`
  - Last modified: `2026-06-22 11:51:07`
- No Android device is attached in `adb devices`.
- Because the APK is old, the current Android source changes still need one final build/install/screenshot pass before claiming full real-device visual verification.

## Fast Next Step

Build the current APK once, install it on an emulator or physical phone, then capture the matching Android screens for:

- Coach dashboard and roster.
- Athlete dashboard.
- Guardian dashboard.
- Messages and notifications.
