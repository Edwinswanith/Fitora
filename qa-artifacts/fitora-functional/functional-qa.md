# Fitora Functional QA

Date: 2026-08-19

## Environment

- Android emulator: `emulator-5554`
- App package: `app.fitora.coaching`
- Functional API: `http://localhost:4102`
- Mobile API URL in emulator: `http://10.0.2.2:4102`
- Metro: `http://localhost:8081` with `EXPO_PUBLIC_FITORA_QA_MODE=true`
- Apex was not modified or tested as part of this Fitora pass.

## Current Sanity Checks

- API server: connected to `mongodb://127.0.0.1:27017/FitoraLocal` and listening on `http://localhost:4102`
- Metro status: `packager-status:running`
- Android device: `emulator-5554 device`
- Android log scan: no app fatal crash observed during the active checks. Metro showed stale Expo font-loader warnings during one relaunch, but the app recovered and completed the flows.

## Automated Checks

- `npm run typecheck --workspace mobile`: passed
- `npm run typecheck --workspace server`: passed
- `npm run lint --workspace mobile`: passed with warnings only
- `npm test --workspace mobile -- --runInBand`: passed, 9 suites / 137 tests
- `npm test --workspace server`: passed, 61 suites / 592 tests

Lint warnings observed:

- `mobile/src/app/athlete/dashboard.tsx`: unused `upcomingLabel`
- `mobile/src/components/DatePickerPill.tsx`: missing hook dependency `openPicker`
- `mobile/src/lib/__tests__/voiceLanguage.test.ts`: `import/first`

## Direct API Smoke

The emulator was paired with a local functional backend using the same Fitora route surface. Direct API smoke passed with 31 checks and 0 failures.

Summary:

```json
{
  "ok": true,
  "checked": 31,
  "coach": {
    "cards": 4,
    "athletes": 4,
    "sessions": 1,
    "templates": 1,
    "mealPlans": 1,
    "videos": 3,
    "pricingPlans": 3,
    "availabilityRules": 6,
    "bulkAssignmentOk": 1,
    "publicCoachId": "6a8539bfa12276e2405a6402"
  },
  "athlete": {
    "waterBefore": 2050,
    "waterAfter": 2300,
    "mealsBefore": 2,
    "mealsAfter": 3,
    "plannedMeals": 4,
    "coachVideos": 3,
    "workoutsToday": 1,
    "progressedAssignment": "6a8539bfa12276e2405a6450"
  },
  "failures": []
}
```

## Mongo-Backed Resume Pass

Remote MongoDB seeding was attempted with `FITORA_SEED_ALLOW_REMOTE=true`, but this machine could not resolve/connect to the Atlas SRV record:

```text
querySrv ECONNREFUSED _mongodb._tcp.fitora.fdgjddk.mongodb.net
```

To continue functional QA, the app was connected to a local Mongo-compatible `mongodb-memory-server` instance on `127.0.0.1:27017/FitoraLocal`, then seeded with `scripts/seed-fitora-mongo.js`.

Seed credentials:

- Coach: `coach.kumar@acme.test` / `Coach@123`
- Athlete: `athlete.arjun@acme.test` / `Athlete@123`

Post-emulator direct API smoke passed:

```json
{
  "ok": true,
  "checks": 8,
  "coachCards": 4,
  "roster": 4,
  "videos": 3,
  "subscriptionStatus": "active",
  "subscriptionPlan": "Premium Coaching",
  "workoutProgress": "2/6",
  "mealsLogged": 4,
  "mealCalories": 1060,
  "waterMl": 2550,
  "workoutsToday": 1,
  "failures": []
}
```

Fix made during this pass:

- `mobile/src/lib/fitoraData.ts` now normalizes the backend subscription payload from `pricingPlan` into `pricingPlanSnapshot`. This fixed the athlete Coach tab showing `Active` with `No active plan`; emulator now shows `Premium Coaching`, `Rs 3,999 / month`, billing date, and included services.

Additional emulator evidence from the resumed Mongo-backed pass:

- Coach: `mongo_coach_after_login.png`, `mongo_coach_clients_tab.png`, `mongo_coach_clients_search.png`, `mongo_coach_plan_assign_result.png`, `mongo_coach_content_assign_result.png`, `mongo_coach_content_analytics_tab.png`, `mongo_coach_profile_tab.png`, `mongo_coach_public_preview.png`
- Athlete: `mongo_athlete_dashboard.png`, `mongo_athlete_water_after_plus.png`, `mongo_athlete_active_workout.png`, `mongo_athlete_complete_set.png`, `mongo_athlete_nutrition_tab.png`, `mongo_athlete_save_meal_result.png`, `mongo_athlete_coach_after_fix_final.png`, `mongo_athlete_progress_tab.png`, `mongo_athlete_profile_account.png`

Observed action limitations from emulator:

- Coach Clients search worked, but tapping the client row arrow did not visibly open a detail page in this pass.
- Athlete Coach `View Session` did not visibly change the screen in this pass.
- Native file selection/upload and real live video call media were not fully exercised.

## Emulator Checks

### Coach

- Login works with `coach.kumar@acme.test`.
- Home loads backend-backed greeting, date, next session, alerts, stats, memberships, activity, and quick actions.
- Plan loads assignment tabs, templates, routines, upcoming routines, and opens the plan composer.
- Plan composer submits an assignment and the UI shows `Assigned 1 workout and 1 meal plan.`
- Content loads the library, assigned videos, analytics-oriented sections, video stats, and quick actions.
- Assign Video opens a functional assignment sheet and posts successfully.
- Profile loads coach identity, rating, plans, availability, reviews, professional details, payments, settings, and public preview.

Screenshots:

- `fitora_coach_home_20260819.png`
- `fitora_coach_plan_20260819.png`
- `fitora_coach_plan_composer_20260819.png`
- `fitora_coach_plan_assign_result_20260819.png`
- `fitora_coach_content_20260819.png`
- `fitora_coach_assign_video_20260819.png`
- `fitora_coach_assign_video_result_20260819.png`
- `fitora_coach_profile_20260819.png`
- `fitora_coach_profile_preview_20260819.png`

### Athlete

- Login works with `athlete.arjun@acme.test`.
- Today loads backend-backed greeting, date, readiness, plan, workout, meals, nutrition, water, coach note, and bottom navigation.
- `+250 ml` posts water and refreshes from `1.8 / 2.5 L` to `2.0 / 2.5 L`.
- Nutrition loads target, macros, planned meals, consumed meals, coach meal plan, water, and 7-day plan.
- Add Meal opens a real log form, submits a `Protein Shake`, and refreshes nutrition totals and consumed meals.
- Workouts loads today's workout, exercise preview, quick workout, upcoming workouts, and recent workouts.
- Continue Workout opens the active workout flow; Complete Set advances from exercise 2 to exercise 3.
- Coach loads coach profile, membership, session, recommended videos, plans, payments, reviews, and change coach rows.
- Progress loads goal progress, weekly progress, charts, adherence, insights, streak, and coach feedback.
- Profile loads personal data, nutrition preferences, coach connection, devices, settings, and account rows.

Screenshots:

- `fitora_athlete_today_main_20260819.png`
- `fitora_athlete_water_after_20260819.png`
- `fitora_athlete_nutrition_20260819.png`
- `fitora_athlete_add_meal_20260819.png`
- `fitora_athlete_add_meal_result_20260819.png`
- `fitora_athlete_workouts_20260819.png`
- `fitora_athlete_workout_detail_20260819.png`
- `fitora_athlete_workout_complete_set_20260819.png`
- `fitora_athlete_coach_20260819.png`
- `fitora_athlete_progress_20260819.png`
- `fitora_athlete_profile_20260819.png`

## Visual Reference Comparison

Side-by-side comparison images were generated in `qa-artifacts/fitora-functional/comparisons/`:

- `coach-content_comparison.png`
- `coach-plan_comparison.png`
- `coach-profile_comparison.png`
- `athlete-today_comparison.png`
- `athlete-workouts_comparison.png`
- `athlete-nutrition_comparison.png`
- `athlete-coach_comparison.png`
- `athlete-progress_comparison.png`
- `athlete-profile_comparison.png`

Overall style matches the supplied Fitora references: white surface, dark navy type, blue primary actions, rounded elevated cards, compact fitness dashboard sections, real avatar/video assets, and role-specific bottom navigation.

Remaining visual drift from exact screenshots:

- Dynamic date/time and verification-mutated data differ from the static references.
- Coach Content uses a segmented tab treatment where one supplied reference uses underline tabs.
- Coach Plan and Coach Profile use live backend sections and density that are close to the references but not pixel-identical.
- Athlete current state can show updated water, meal, and workout progress after QA actions.

## Limits

- This pass verified a seeded local Mongo-compatible backend and the emulator app. It did not prove production/Atlas MongoDB connectivity because the remote SRV lookup/connect failed from this machine.
- Native file picker/upload was opened through the content flow, but selecting a real device video file was not fully exercised.
- Live video calling was not validated as a real media session.
- Some secondary settings/payment rows remain navigation-level checks unless covered by an explicit backend endpoint.

## Follow-up Action Fixes

Fixed and rechecked two UI actions that were previously flagged:

- Coach Clients row arrow now opens the selected client detail screen using a concrete encoded route. Emulator verified the first client row opens `Edwin Swanith` detail with Today, Workout, Nutrition, Upcoming Session, and Progress Preview sections.
- Athlete Today `View Session` now expands an inline session detail panel instead of acting as a visual-only button. Emulator verified it changes to `Hide Details` and shows Status, Start, Duration, and `Join Call`.

Follow-up screenshots:

- `followup_coach_client_detail.png`
- `followup_athlete_session_detail.png`
- `followup_athlete_join_call_result.png`
