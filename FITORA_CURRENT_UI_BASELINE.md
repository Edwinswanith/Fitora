# Fitora Current UI Baseline

Audit-only capture of the Fitora app exactly as it behaves today, for use as a reference before a screen-by-screen redesign. **No design, layout, style, or code changes were made to produce this document.** Native Android emulator is the primary source of truth; code (`mobile/src/app/**`, `mobile/src/components/fitora.tsx`, `mobile/src/lib/theme.ts`) is the secondary source for exact structural/token facts that are hard to read off a screenshot (styles, field names, conditional logic).

Screenshots live under `qa-artifacts/ui-baseline/<role>/<screen>/`. The full path→state map is in `qa-artifacts/ui-baseline/SCREENSHOT_INDEX.md`.

---

## Master Screen Table

| # | Role | Screen | Route | Screenshot (representative) | Density | Redesign Priority |
|--:|---|---|---|---|---|---|
| 1 | Athlete | Today | `/athlete/dashboard` (tab: today) | `athlete/today/normal.png` | LOW–MODERATE | P0 |
| 2 | Athlete | Training | `/athlete/dashboard` (tab: workouts) | `athlete/training/today-segment.png` | MODERATE | P0 |
| 3 | Athlete | Active Workout | `/athlete/active-workout?assignmentId=` | `athlete/active-workout/start.png` | MODERATE–HIGH | P0 |
| 4 | Athlete | RPE / Post-Session | `/athlete/rpe` (also inline post-workout) | `athlete/active-workout/final-state.png` | MODERATE | P0 |
| 5 | Athlete | Nutrition | `/athlete/dashboard` (tab: nutrition) | `athlete/nutrition/normal.png` | LOW | P0 |
| 6 | Athlete | Log Meal | `/athlete/log-meal` | `athlete/log-meal/initial.png` | LOW | P1 |
| 7 | Athlete | Meal Scan | `/athlete/meal-scan` | `athlete/meal-scan/initial.png` | LOW | P1 |
| 8 | Athlete | Coach | `/athlete/dashboard` (tab: coach) | `athlete/coach/active-coach.png` | MODERATE | P0 |
| 9 | Athlete | Marketplace | `/athlete/coach-discovery` | `athlete/marketplace/listing.png` | MODERATE–HIGH | P1 |
| 10 | Athlete | Marketplace Coach Profile | `/athlete/coach-profile/[coachId]` | `athlete/marketplace-profile/top.png` | HIGH | P1 |
| 11 | Athlete | Progress | `/athlete/dashboard` (tab: progress) | `athlete/progress/7d.png` | HIGH | P1 |
| 12 | Athlete | Check-in | `/athlete/check-in` | `athlete/check-in/saved.png` | MODERATE–HIGH | P0 |
| 13 | Athlete | Water | `/athlete/water` | `athlete/water/top.png` | MODERATE–HIGH | P1 |
| 14 | Athlete | Trends | `/athlete/trends` | (captured earlier this session; structure unchanged) | MODERATE | P2 |
| 15 | Athlete | Profile / Account | `/account` | `athlete/profile/top.png` | HIGH | P2 |
| 16 | Athlete | Notifications | `/notifications` | `athlete/notifications/list.png` | LOW | P2 |
| 17 | Coach | Home | `/coach/dashboard` | `coach/home/normal-squad.png` | MODERATE | P0 |
| 18 | Coach | Clients | `/coach/athletes` | `coach/clients/default.png` | MODERATE | P0 |
| 19 | Coach | Client Detail | `/coach/athletes/[athleteId]` | `coach/client-detail/chetan-top.png` | HIGH | P0 |
| 20 | Coach | Plan (Assignments/Templates/Routines) | `/coach/plan` | `coach/plan/assignments-tab.png` | MODERATE–HIGH | P0 |
| 21 | Coach | Assign sheet ("Workout Builder") | opened from Plan | `coach/workout-builder/step1.png` | MODERATE | P1 |
| 22 | Coach | Content | `/coach/content` | `coach/content/library-tab.png` | MODERATE | P1 |
| 23 | Coach | Messages | `/coach/messages` | `coach/messages/thread-list.png` | LOW–MODERATE | P0 |
| 24 | Coach | Profile | `/coach/profile` | `coach/profile/top.png` | HIGH | P1 |
| 25 | Coach | Announcements | `/coach/announcements` | `coach/announcements/main.png` | MODERATE | P2 |
| 26 | Coach | Coaches (owner-only) | `/coach/coaches` | `coach/coaches/roster.png` | LOW | P3 |
| 27 | Shared | Landing | `/` | `shared/login/landing.png` | MODERATE | P2 |
| 28 | Shared | Role login | `/login/[role]` | `shared/login/athlete-login-form.png` | LOW | P2 |
| 29 | Shared | Register (athlete self-signup) | `/register` | code-derived (see below) | LOW | P3 |
| 30 | Shared | Add/Link client | `/coach/athletes/new` | code-derived (see below) | LOW–MODERATE | P2 |

Density and priority are judged from actual structure observed below, not aesthetic opinion.

---

## Part 1 — Screen Map

26 route files under `mobile/src/app/`. Athlete uses a plain `Stack` (`athlete/_layout.tsx`) — **Today/Training/Nutrition/Coach/Progress are not separate routes**; they are one screen (`athlete/dashboard.tsx`) with internal `AthleteTab` state (`today|workouts|nutrition|coach|progress`), driven by a custom `BottomNavigation` and a `?section=` query param alias (`normalizeTab()`). Coach uses a real Expo Router `Tabs` navigator (`coach/_layout.tsx`) with 5 visible tabs (dashboard/athletes/plan/content/profile) plus 3 tabs registered with `href: null` (messages, announcements, coaches) — reachable by navigation but never shown in the tab bar.

| Role | Screen | Route | Entry Point | Reachable? | Type | Main Purpose |
|---|---|---|---|---|---|---|
| — | Landing | `/` (`index.tsx`) | App launch, logged out | Yes | STACK SCREEN | Role picker → login |
| — | Role Login | `/login/[role]` | Landing "Continue" | Yes | STACK SCREEN | Email/password or Google sign-in |
| — | Register | `/register` | (no visible link found in current UI; reachable by direct nav) | Yes (indirect) | STACK SCREEN | Athlete-only self-signup |
| Athlete | Dashboard shell (Today/Training/Nutrition/Coach/Progress) | `/athlete/dashboard` | Post-login default | Yes | PRIMARY TAB (internal) | Daily hub, 5 internal tabs |
| Athlete | Check-in | `/athlete/check-in` | Today's "Check In" CTA | Yes | STACK SCREEN | Daily wellness form |
| Athlete | Active Workout | `/athlete/active-workout` | Today/Training "Start Workout" | Conditional (needs `assignmentId`) | CONDITIONAL SCREEN | Set-by-set workout execution |
| Athlete | RPE | `/athlete/rpe` | Deep link / post-workout transition | Yes | STACK SCREEN | Post-session response form |
| Athlete | Water | `/athlete/water` | Nutrition tab, Today card | Yes | STACK SCREEN | Hydration goal + log |
| Athlete | Trends | `/athlete/trends` | Progress tab links | Yes | STACK SCREEN | Historical charts |
| Athlete | Log Meal | `/athlete/log-meal` | Nutrition "Log Meal" | Yes | STACK SCREEN | Manual meal entry |
| Athlete | Meal Scan | `/athlete/meal-scan` | Nutrition "Scan Food" | Yes | STACK SCREEN | AI photo→meal flow |
| Athlete | Coach Discovery (Marketplace) | `/athlete/coach-discovery` | Coach tab, "Find Coach" | Yes | STACK SCREEN | Browse/subscribe to coaches |
| Athlete | Coach Profile (Marketplace) | `/athlete/coach-profile/[coachId]` | Marketplace card "View Coach" | Yes | STACK SCREEN | Coach detail + pricing + subscribe |
| — | Account | `/account` | Avatar tap (any role) | Yes | STACK SCREEN | Profile, personal/nutrition data, settings, logout — role-adaptive content |
| — | Notifications | `/notifications` | Bell icon (any role) | Yes | STACK SCREEN | Notification list |
| Coach | Dashboard (Home) | `/coach/dashboard` | Post-login default | Yes | PRIMARY TAB | Squad overview |
| Coach | Athletes (Clients) | `/coach/athletes` | Tab bar | Yes | PRIMARY TAB | Roster list |
| Coach | Athlete Detail | `/coach/athletes/[athleteId]` | Clients list row | Yes | STACK SCREEN | Single-client deep view |
| Coach | Add/Link Athlete | `/coach/athletes/new` | Clients "+" | Yes | STACK SCREEN | Create or link a client account |
| Coach | Plan | `/coach/plan` | Tab bar | Yes | PRIMARY TAB | Assignments/Templates/Routines, 3 internal segments |
| Coach | Content | `/coach/content` | Tab bar | Yes | PRIMARY TAB | Video library, 3 internal segments |
| Coach | Profile | `/coach/profile` | Tab bar | Yes | PRIMARY TAB | Public marketplace profile + settings |
| Coach | Messages | `/coach/messages` | Client detail message icon, notification deep link | Yes | HIDDEN ROUTE (tab, `href:null`) | 1:1 athlete threads |
| Coach | Announcements | `/coach/announcements` | (no visible tab-bar link found; reachable by nav/deep link) | Yes (indirect) | HIDDEN ROUTE | Broadcast to squad |
| Coach | Coaches | `/coach/coaches` | Profile screen link (owner accounts only) | Conditional | OWNER ONLY | Academy coach roster/provisioning |

---

## Part 2 — Athlete Navigation Map

```
Login (role: User)
 ↓
Dashboard shell (single screen, 5 internal tabs via BottomNavigation)
 ├── Today       (default)
 ├── Training    (segments: Today | Upcoming | History, own day-of-week strip)
 ├── Nutrition
 ├── Coach
 └── Progress    (range: 7D | 4W | 3M, sub-tabs: Training | Body | Nutrition | Recovery)

Stack-pushed from Today/Training/Nutrition/Coach/Progress:
 ├── Check-in            (from Today's "Check In" CTA)
 ├── Active Workout       (from Today/Training's "Start Workout" — requires assignmentId)
 │     └── transitions in-place into the RPE "How hard was this workout?" step, then a full Post-Session Response screen
 ├── RPE / Post-Session Response
 ├── Water                (from Nutrition's water card / Today status)
 ├── Log Meal             (from Nutrition)
 ├── Meal Scan            (from Nutrition)
 ├── Trends               (from Progress)
 ├── Coach Discovery (Marketplace)  (from Coach tab's "Find Coach")
 │     └── Coach Profile (Marketplace)
 ├── Notifications        (bell icon, present on every screen's app bar)
 └── Account              (avatar tap, present on every screen's app bar)
```

All of the above confirmed against real route files and live navigation, not assumed from naming.

---

## Part 3 — Coach Navigation Map

```
Login (role: Coach)
 ↓
Tab bar: Home | Clients | Plan | Content | Profile
 ├── Home (dashboard.tsx)
 ├── Clients (athletes/index.tsx)
 │     └── Client Detail (athletes/[athleteId].tsx)
 │            └── Add/Link Athlete (athletes/new.tsx, from Clients "+")
 ├── Plan (plan.tsx — 3 internal segments: Assignments | Templates | Routines)
 │     └── Assign sheet (4 modes: Workout | Tasks | Meal | Routine — see Part 5)
 ├── Content (content.tsx — 3 internal segments: Library | Assigned | Analytics)
 └── Profile (profile.tsx)
        └── Coaches (coaches.tsx — owner accounts only, academy roster)

Hidden tabs (registered, no tab-bar icon, reached by push/deep-link):
 ├── Messages (messages.tsx — thread list + open conversation)
 └── Announcements (announcements.tsx — composer + history)

Shared with athlete:
 ├── Notifications (/notifications)
 └── Account (/account)
```

---

## Part 4/5/12 — Per-Screen Baseline

### Screen: Athlete Today
**Route:** `/athlete/dashboard` (tab: today)
**Purpose:** Daily hub — what's next, today's plan, at-a-glance status.
**Screenshots:** `athlete/today/normal.png` (check-in pending), `athlete/today/checkin-done-refreshed.png` (check-in done, workout next)
**Current Layout (observed order, check-in pending, has an assigned workout):**
1. Header — greeting ("Good morning, {name}") + date, bell icon, avatar circle (initials)
2. "Next Up" card — icon tile, label, title, one-line description, single filled CTA button (`Check In` → after check-in, becomes `Start Workout`)
3. "Today's Schedule" card — one row per scheduled workout (icon, name, "x / y exercises complete" pill)
4. "Daily Status" card — 2×2 metric grid: Readiness, Nutrition, Water, Training
**Above the Fold:** All 4 sections fit in one viewport on this data set (no scrolling needed) — the screen is currently very short because this athlete has no meal plan, no coach feedback yet, and no upcoming session; those are conditional sections that were **not observed to render** with this data set (their exact appearance with data was not captured in this pass — flagged as a gap, see Part 4/16 below).
**Primary CTA:** The "Next Up" button (Check In / Start Workout) — visually strongest (full-width filled blue).
**Secondary Actions:** None visible above the single CTA; Daily Status metrics are read-only (not tappable per uiautomator).
**Current Components:** Header row, `AppCard`-style bordered white cards, `StatusChip`-like progress pill, 2×2 metric grid, `ActionButton` (filled, icon+label).
**Current Data:** Greeting name, date, workout name + exercise count, readiness score/label, kcal consumed, water L/goal, training x/y.
**States observed:** check-in pending (readiness "—, No check-in"); check-in done (readiness "45, Low", red/danger tone, "Next Up" swaps to the assigned workout).
**States not captured this pass:** no workout assigned; alert/risk-flag banner; upcoming coach session card; coach feedback card; meal plan card. (Code shows these are conditional blocks in `dashboard.tsx` gated on data presence — not fabricated/guessed, just not exercised with this account's data.)
**Scroll/Density:** LOW at this data volume (fits one screen); code suggests MODERATE–HIGH once meal plan, session, and feedback cards are populated (see the September QA report's longer 9-section description of a fuller data set).
**Current Visual Style:** Current Fitora system throughout (`ScreenContainer`/`AppCard`/`ActionButton`).
**Current UX Issues:**
- The dashboard did **not** auto-refresh after returning from Check-in via direct navigation; a manual pull-to-refresh was required to see the updated readiness/CTA. (Observed directly — screenshot before/after refresh differ only after the manual pull.)
- The screen's actual section count varies a great deal by data state; "Today" can be extremely sparse (as captured) or much longer, with no visual transition/skeleton for the cards that appear once data exists.
**Functionality to preserve:** the `?section=` deep-link alias mechanism; the Check-In → readiness recompute → Next-Up swap sequence; the 2×2 metric grid semantics.

---

### Screen: Athlete Training
**Route:** `/athlete/dashboard` (tab: workouts)
**Purpose:** Day-by-day workout schedule and execution entry point.
**Screenshots:** `athlete/training/today-segment.png`, `upcoming-segment.png`, `history-segment.png`
**Current Layout:**
1. Header ("Training" title, calendar icon)
2. Segment control — Today | Upcoming | History
3. (Today only) 7-day-strip date picker (Mon–Sun, current day highlighted)
4. Workout card — status badges (`TODAY`, `Coach Assigned`, `Scheduled`), title, "N exercises · Approx. X min", coach name, progress bar + %, `Start Workout` CTA
5. "Exercise Preview" card — first 3 exercises (icon, name, set×rep), each row a `Not Started` chip + chevron, "View all N exercises" link
**Above the Fold:** Segment control + date strip + workout card + first 2 exercise rows are visible without scrolling; "View all" and 3rd exercise row are borderline.
**Primary CTA:** `Start Workout` (full-width filled).
**Secondary Actions:** individual exercise rows (chevron, presumably jump to that exercise), "View all N exercises" text link.
**Current Data:** date strip, workout name/duration/exercise count, coach display name, per-exercise set×rep, completion %.
**States observed:** Today (workout scheduled, 0% progress); Upcoming (not fully inspected this pass — screenshot captured, not detailed); History empty state ("No workout history yet. Complete a few workouts to build your history.").
**Current Visual Style:** Current Fitora system.
**Current UX Issues:**
- Coach display name renders as **"Coach Coach Kumar"** — the UI appears to prepend the literal word "Coach" in front of a coach's own `name` field, which for this account already starts with "Coach" ("Coach Kumar"), producing a duplicated word. Observed identically on the Today workout card, the Training tab, and the athlete's "My Coach" screen — a copy bug, not isolated to one screen.
**Functionality to preserve:** segment/date-strip navigation, per-exercise "Not Started" status chips, the Start Workout entry point into Active Workout.

---

### Screen: Athlete Active Workout
**Route:** `/athlete/active-workout?assignmentId=…`
**Purpose:** Execute one exercise at a time through a full workout.
**Screenshots:** `athlete/active-workout/start.png`, `mid-sets-complete.png` (rest timer), `note-expanded.png`, `skip-exercise-reasons.png`, `exercise2.png` (no-video placeholder), `final-state.png` (RPE hand-off), `completion.png`
**Current Layout (per exercise):**
1. Header — back button, workout name
2. Progress card — "EXERCISE N OF 6", workout name repeated, thin progress bar
3. "Current exercise" card — label, exercise name, video (thumbnail with duration overlay, or a dark placeholder+play icon when no video is attached), chips (`N sets`, `N reps` — absent for duration-type exercises, `Rest Ns`), "Add a note" link
4. "Sets" card — one row per set (circle checkbox, "Set N", trailing "Pending" or completed rep count), Reps/Weight steppers, `Complete Set` button, "Can't perform this exercise" link
5. **Only one exercise is shown at a time** — not a scrollable list of all 6.
**Sub-states observed:**
- **Rest timer** — replaces the Complete-Set area with "M:SS rest remaining" + `+30 sec` / `Skip Rest`; auto-expires back to the normal Complete-Set state.
- **Add a note** — expands an inline text field with Cancel/Save Note.
- **Skip exercise** — "Can't perform this exercise" opens an inline reason picker (`Equipment unavailable` / `Pain or discomfort` / `Too difficult` / `Other`) + Cancel/Confirm.
- **Final exercise → RPE hand-off** — completing/skipping the last exercise replaces the Sets card with "How hard was the workout?" (1–10 scale) + `Log Effort`, which then navigates into a full **Post-Session Response** screen (session slot AM/AFT/PM, workout-hardness carried over, "How do you feel now?" Better/Same/Worse, a collapsed "Training category, intensity, heart rate" section, `Log Session`).
**Primary CTA:** `Complete Set` (or `Finish Workout` on the last set of the last exercise, per code).
**Secondary Actions:** "Add a note", "Can't perform this exercise", rest-timer `+30 sec`/`Skip Rest`.
**Current UX Issues (real, observed):**
- The floating Ask Agent button visually sits on top of the `Complete Set`/`Skip Rest` controls at the **default** (no-scroll) position for several exercises in this pass — not merely a transient mid-scroll overlap, but present on first view of the screen for some exercise cards.
- One exercise ("Incline DB Press", "Shoulder Press") had no attached demo video — a dark placeholder with a play icon that does nothing, rather than an empty/"no demo available" state.
**Functionality to preserve:** single-exercise-at-a-time flow, rest timer with skip/extend, skip-with-reason (not a silent skip), the automatic hand-off into RPE at the end of the last exercise.

---

### Screen: Athlete RPE / Post-Session Response
**Route:** `/athlete/rpe`, and inline at the end of Active Workout
**Purpose:** Post-session subjective load logging.
**Screenshot:** `athlete/active-workout/final-state.png`
**Current Layout:**
1. Header (back + "Post-Session Response" title)
2. Subcopy ("A couple of quick taps — this drives your training load and risk flags.")
3. Card: Session slot selector (AM/AFT/PM, segmented), "How hard was this workout?" 1–10 circular scale, "How do you feel now?" 3-way (Better/Same/Worse), collapsed "Training category, intensity, heart rate" disclosure
4. `Log Session` full-width filled CTA
**Current Visual Style:** already-migrated Fitora system (confirmed in the prior release-hardening pass).
**Current UX Issues:** none newly observed this pass beyond what's already fixed (bottom clearance from the floating button, confirmed working here).
**Functionality to preserve:** value carry-over from Active Workout's "how hard was the workout" tap into this screen's pre-filled hardness value.

---

### Screen: Athlete Nutrition
**Route:** `/athlete/dashboard` (tab: nutrition)
**Purpose:** Daily nutrition target + logging entry points + hydration.
**Screenshots:** `athlete/nutrition/normal.png`, `logged.png` (validation-error variant)
**Current Layout (no target configured):**
1. Header — "Nutrition" + date, calendar icon, avatar
2. "No nutrition target" card (icon, title, one line body — empty/unconfigured state, not a true empty-day state)
3. `Log Meal` (filled) / `Scan Food` (outlined) — side-by-side buttons
4. "Consumed Today" strip — icon + "Log meals to see consumed nutrition here."
5. "Water" card — L/goal, progress bar, `+250 ml` quick-add button
**Primary CTA:** `Log Meal`.
**Secondary Actions:** `Scan Food`, water quick-add.
**Current UX Issues:** none newly observed (the target-not-configured state is itself informative, links out to profile).
**Functionality to preserve:** the target-missing empty state's messaging, the water quick-add inline on this tab as well as on the dedicated Water screen.

---

### Screen: Athlete Log Meal
**Route:** `/athlete/log-meal`
**Screenshots:** `athlete/log-meal/initial.png`, `logged.png` (validation error state — "what you ate first" required-field message)
**Current Layout:**
1. Header (back + "Log Meal")
2. "Meal Type" card — 4 segmented chips (Breakfast/Lunch/Snack/Dinner)
3. "What did you eat?" card — free-text field, "Scan a photo instead" link
4. Collapsed "Nutrition details (optional)" disclosure, `Save Meal` CTA
5. "No meal history yet" card (Recent-picks empty state)
**Current UX Issues:** the free-text field did not accept a programmatic `adb input text` while unfocused in this pass — not conclusive evidence of a real focus bug (could be a test-tooling artifact), but the resulting validation-error render itself is clean and correctly worded.
**Functionality to preserve:** meal-type segmented selection, optional nutrition-details expansion, "scan instead" cross-link to Meal Scan.

---

### Screen: Athlete Meal Scan
**Route:** `/athlete/meal-scan`
**Screenshot:** `athlete/meal-scan/initial.png` (upload prompt)
**Current Layout:** header, single card — camera icon tile, "Camera or Gallery" title, one-line description, `Choose Photo` CTA.
**States not captured live this pass** (no sample photo was pushed through the OS picker in this session) — derived from code instead: `LoadingState` "Analyzing meal..." during upload; a Review card with per-item confidence labels and a `Review required` warning chip for low-quality scans; `Confirm & Save` CTA. This matches the documented "AI-boundary pattern" (schema-constrained generation → defensive parse → human confirm) already established elsewhere in the app.
**Functionality to preserve:** human-confirm gate before any scanned item is saved; per-item confidence display.

---

### Screen: Athlete Coach
**Route:** `/athlete/dashboard` (tab: coach)
**Screenshot:** `athlete/coach/active-coach.png`
**Current Layout (active coach):**
1. Header ("My Coach", bell, avatar)
2. Coach hero card — avatar, name, specialization, rating/review count, years experience, expertise chips, `Message` (outlined) / `View Profile` (filled) buttons
3. "Your Program" card — 3 rows (Workout Plan, Meal Plan, Coach Videos), each with a status line and chevron
4. "Membership" card — icon, status ("No active plan"), `Manage Membership` CTA
5. "Sessions" row (→ Bookings), "Switch Coach" row, "Leave Coach" row (destructive/red)
**Current UX Issues:** the same "Coach {name}" duplication bug as Training ("Coach Coach Kumar").
**States not captured:** "no coach" empty state (this account has an active coach; not reproduced this pass — would require a fresh, unlinked athlete, e.g. the pre-existing `newcomer@test.dev` account).
**Functionality to preserve:** Message/View Profile/Manage Membership/Switch/Leave entry points, Your Program status rows.

---

### Screen: Athlete Marketplace (Coach Discovery)
**Route:** `/athlete/coach-discovery`
**Screenshot:** `athlete/marketplace/listing.png`
**Current Layout:**
1. Header (back arrow, "Find a Coach" centered title), subcopy
2. Info banner (shown because this athlete already has a coach) — "Currently coached by Coach Kumar… choosing a plan below starts a coach switch."
3. Search field
4. Filter-chip row 1 (All/Nutrition/5+ Years/Top Rated/Available…) — horizontally scrollable, clipped at the edge (confirmed scrollable, not a bug)
5. Filter-chip row 2 (specialty tags: strength/nutrition/Strength Training/Football C…)
6. "N Coaches" count
7. Coach cards — avatar, name, specialty, rating+review count, availability dot, chips, starting price, `View Coach` CTA
**Current Data (one coach card's fields):** avatar initials, name, specialty label, star rating, review count, "Available"/"New" status, up to 2 specialty chips, "Rs N/mo · Starting plan", CTA.
**Current UX Issues:** none beyond the already-known, already-fixed-elsewhere floating-button transient overlap pattern (observed here transiently on a mid-list card, not a permanent block).
**Functionality to preserve:** the "already has a coach → this starts a switch" warning banner; search/filter chips; price-first card layout.

---

### Screen: Athlete Marketplace Coach Profile
**Route:** `/athlete/coach-profile/[coachId]`
**Screenshots:** `athlete/marketplace-profile/top.png`, `bottom.png`
**Current Layout:**
1. Header (back, coach name centered)
2. Hero card — avatar, name, rating, years experience, "Your current coach" chip (conditional)
3. "Expertise" card — specialty chips, languages line
4. "About" card — bio paragraph
5. "Availability" card — weekly text summary
6. "Pricing Plans" — one card per plan (name, price, description, feature bullets with check/cross icons, tag chips, radio selector)
7. "Reviews" card — star row + count + average, then individual reviews (stars, date, text)
**Current Data:** full plan feature comparison (Basic vs Premium shown with different included/excluded features), 3 individual reviews with dates and free text.
**Current UX Issues:** none observed.
**Functionality to preserve:** plan radio-select→subscribe/switch flow, per-plan feature checklist format.

---

### Screen: Athlete Progress
**Route:** `/athlete/dashboard` (tab: progress)
**Screenshot:** `athlete/progress/7d.png` (defaulted to the 4W range, not 7D)
**Current Layout:**
1. Header ("Progress", calendar icon)
2. Range selector — 7D / 4W / 3M (segmented, underline-active style)
3. "Your Progress" card — 2 trend rows (Readiness improved +N pts / Workout completion N%), each with an icon, chevron
4. "This Week" card — 2×2 grid (Workout, Nutrition, Check-ins, Recovery), each with a progress bar or status word
5. Sub-tab row — Training / Body / Nutrition / Recovery (segmented pills)
6. Tab content card (Training shown: "Workouts completed" with a bar)
7. Streak card — flame icon, "N day streak", "Longest: N days"
8. "Coach Feedback" card — status row, "No coach feedback yet." placeholder chip
**Current UX Issues:** the range selector's default landing state is 4W, not 7D — inconsistent with the Master Table's naming convention ("7D" first) and worth confirming is intentional.
**Functionality to preserve:** range selector, 4-way sub-tab content switching, streak longest/current split.

---

### Screen: Athlete Check-in
**Route:** `/athlete/check-in`
**Screenshots:** `athlete/check-in/form.png`, `saved.png`
**Current Layout:**
1. Header (back, "Daily Check-in"), tagline ("Takes under a minute — it drives your readiness.")
2. Card — Sleep hours stepper (−/value/+), then 5 rating scales (Sleep quality, Mood, Stress, Soreness, Fatigue), each a 1–5 pill row with low/high hint labels
3. Success/error inline text, `Save Check-in` CTA
4. "Resting heart rate" section header + subcopy
5. Card — Waking/Before-bed bpm fields (side by side), `Save Heart Rate` CTA
**Current Visual Style:** current Fitora system (migrated in the prior hardening pass; re-verified live here, including the floating-button clearance fix — the "Before Bed" field is now fully clear at the end of scroll).
**Functionality to preserve:** 5-scale + sleep-hours + optional-heart-rate two-card structure, independent save actions for wellness vs. heart rate.

---

### Screen: Athlete Water
**Route:** `/athlete/water`
**Screenshot:** `athlete/water/top.png`
**Current Layout:**
1. Header (back, "Water"), tagline
2. "Water goal" card — large ring (% complete), Drunk/Remaining/Goal 3-up stat row, "N ml remaining today · 0 of last 7 days reached the goal" strip
3. "Daily water goal" card — 4 preset chips (2L/2.5L/3L/3.5L) + custom-ml field + `Save`
4. "Log water intake" card — 3 quick-add buttons (+250/+500/+750 ml) + custom-ml field + Add
5. "Reminder notifications" card — toggle row, currently Off, `Enable` CTA
**Current UX Issues:** the custom-ml "Add" button sits directly under the floating Ask Agent button at this screen's default scroll position (same visual-overlap family as Active Workout's Complete Set — confirmed reproducible, not fixed by the earlier bottom-padding change since this is mid-content, not end-of-scroll).
**Functionality to preserve:** ring + 3-stat + weekly-goal-hit-rate combination, preset vs. custom goal/quick-add split.

---

### Screen: Athlete Trends
**Route:** `/athlete/trends`
**Note:** Captured and migrated to the current Fitora system in the prior release-hardening pass this session (`EmptyState`, `LoadingState`, `AppCard`). Structure: back-header, a `Stat` two-up bespoke layout wrapped in `AppCard` per metric, charts. Not re-screenshotted in this pass since nothing has changed since verification; see that phase's `qa-artifacts/verify-athletetrends-bottom.png` for the live capture.

---

### Screen: Athlete Profile / Account
**Route:** `/account`
**Screenshots:** `athlete/profile/top.png`, `mid.png`, `bottom.png`
**Current Layout:**
1. Header ("Profile", `Edit` link)
2. Identity card — avatar, name, sport, email, "Change Photo"
3. "Your Goal" card — status + `Manage Goal`
4. "Personal" card — Weight/Target Weight/Height/Age/Activity Level rows (all "Not set" for this fresh account)
5. "Nutrition" card — Diet/Cuisine/Allergies rows + today's kcal mini-bar
6. "My Coach" card — avatar, "Connected with Coach", `View Coach`
7. "Connected Devices" — Apple Health / Wearable rows
8. "Preferences" — Units / Timezone / Appearance / Privacy rows
9. "Account & Security" row
10. `Log Out`, `Delete Account` (destructive)
**Current UX Issues:** none newly observed (structure matches the coach-side Profile pattern closely, which is a consistency positive, not an issue).
**Functionality to preserve:** the entire settings-row taxonomy; Log Out / Delete Account separation.

---

### Screen: Notifications (shared, role-adaptive)
**Route:** `/notifications`
**Screenshot:** `athlete/notifications/list.png` (empty state)
**Current Layout:** role-label eyebrow ("USER"), title + "You're all caught up" subtitle, a bell icon-button + avatar in the app-bar-style header, a separate `Back` button below it, then either a notification-card list (unread dot, `URGENT` pill for high priority, title, time-ago, body) or the empty-state card shown here.
**Current Visual Style:** **still the OLD design system** — this screen imports `Card`/`Muted` from `components/ui.tsx`, not `fitora.tsx`. Not one of the six screens migrated in the prior hardening pass.
**Current UX Issues:**
- Two back-navigation affordances stacked on top of each other (the header's own back-icon-adjacent layout plus a separate bordered `Back` pill) — redundant.
- This screen maintains its **own**, separate `KNOWN_MOBILE_ROUTES` allowlist (distinct from `_layout.tsx`'s `KNOWN_PUSH_ROUTES` used for push-tap routing), and the two lists have drifted — e.g. `/athlete/active-workout`, `/athlete/meal-scan`, `/coach/plan`, `/coach/content`, and `/coach/profile` are present in one list but missing from the other. A notification tapped from the in-app Notifications screen can therefore resolve differently than the identical link delivered via a real push tap.
**States not captured:** populated list with unread/read/urgent items (no live notification events were available to generate one in this session; empty state only).
**Functionality to preserve:** mark-one-read on tap, mark-all-read action, priority pill, the (accurate for reachable routes) link-routing fallback-to-dashboard behavior.

---

### Screen: Coach Home
**Route:** `/coach/dashboard`
**Screenshots:** `coach/home/normal-squad.png`, `normal-squad-scrolled.png`
**Current Layout:**
1. Header — greeting + date, bell, avatar
2. "Needs Attention" card + "View all" link
3. "Squad Readiness — 7 Days" chart card
4. 2×2 metric grid — Active Clients / Sessions Today / Training / Risk Alerts
5. "Memberships" card — status + `Review` link
6. "Today's Activity" — empty state
7. "Quick Actions" — 3 buttons (Assign Workout filled/primary, Create Plan, Upload Video)
**Above the Fold:** header + Needs Attention + start of the readiness chart.
**Primary CTA:** ambiguous — no single dominant full-width button; "Assign Workout" in Quick Actions is the only filled/primary-styled button but sits below the fold.
**Functionality to preserve:** the 4-metric grid, Quick Actions shortcut set.

---

### Screen: Coach Clients
**Route:** `/coach/athletes`
**Screenshot:** `coach/clients/default.png`
**Current Layout:** header ("Clients", count), filter tabs (All/Attention/Active/Membership), client-card list — avatar+name+sport, readiness/workout/nutrition/membership mini-fields, risk indicator, row tap → detail.
**Current UX Issues:** a newly-linked client's "Workout" field showed "No plan" on this list even though a workout assignment already existed and rendered correctly on that same client's Detail screen — a stale-summary inconsistency between the list and detail views (observed directly: assigned via API, list still said "No plan", detail screen correctly showed "Upper Body Strength").
**Functionality to preserve:** filter tabs, client-card field set.

---

### Screen: Coach Client Detail
**Route:** `/coach/athletes/[athleteId]`
**Screenshots:** `coach/client-detail/chetan-top.png`, `chetan-mid.png` (fuller data set), `meera-top.png` (fresh client)
**Current Layout (full, most-populated example):**
1. Header — back, name, message icon
2. "Today" 4-metric grid — Readiness / Workout / Nutrition / Tasks
3. "Workout" card — current assignment, View/Adjust
4. "Nutrition" card — target status
5. "Today's Sessions"
6. "Next Booked Session"
7. "Progress Preview" — chart
8. "Recent Activity" — RPE log list (up to 5 rows: RPE value, slot, load, category)
9. Bottom action bar — `Assign` (primary/filled) / `Message` / `Add Note`
**Above the Fold:** header + Today grid + start of Workout card only — this is the tallest screen captured this pass (HIGH density, ~2+ screens of scroll).
**Functionality to preserve:** the full 8-card stack and its order, the 3-button action bar.

---

### Screen: Coach Plan
**Route:** `/coach/plan`
**Screenshots:** `coach/plan/assignments-tab.png` + scrolled, `templates-tab.png`
**Current Layout (Assignments segment):**
1. Header ("Plan", "New" link, avatar)
2. Segmented tabs — Assignments / Templates / Routines
3. Quick-filter pills — Workout / Tasks / Meal Plan
4. `New Plan` primary button
5. "Today" section (empty state observed)
6. "Tomorrow" section (empty state observed)
7. "Planning gaps" warning banner
8. "Templates" section — list + "View Templates" link
9. "Upcoming Routines" — athlete+workout pairs
**Templates segment:** "New Workout" / "New Meal Plan" buttons, existing-templates list, "No meal plan templates yet" empty state.
**Functionality to preserve:** the 3-segment structure, the planning-gaps warning, quick-filter pills.

---

### Screen: Coach "Workout Builder" (Assign sheet)
**Reached from:** Plan → New Workout/New Meal Plan/Create Routine, or Client Detail → Assign
**Screenshots:** `coach/workout-builder/step1.png` (Workout mode), `assign-meal-mode.png`, `assign-routine-mode.png`
**Current Layout:** a single reusable sheet with 4 mode tabs (Workout / Tasks / Meal / Routine), each showing: date picker, an existing-template radio list (or "No templates yet — Fitora will create a starter plan" when none exist), a client multi-select checklist, Cancel/Confirm.
**Important structural finding (not a redesign opinion — a fact about current behavior):** **there is no custom exercise-by-exercise or meal-by-meal editor in the mobile app.** "New Workout"/"New Meal Plan" do not open a builder; they open this same assign sheet. If the coach doesn't pick an existing template, confirming silently creates one hardcoded default template (`Full Body Strength` — Goblet Squat/Push-ups/Lat Pulldown/Plank, 3×10-ish) or one hardcoded default meal plan (a fixed 3-meal, 7-day plan), per `coach/plan.tsx`'s `createDefaultWorkoutTemplate`/`createDefaultMealPlan`. A coach cannot customize exercise names, sets/reps/rest, or meal contents from the mobile app at all today.
**Functionality to preserve:** whatever the redesign does here, this default-template fallback behavior is real, current product behavior, not a bug to silently drop.

---

### Screen: Coach Content
**Route:** `/coach/content`
**Screenshots:** `coach/content/library-tab.png`, `assigned-tab.png`, `analytics-tab.png`
**Current Layout:** header, 3 segmented tabs (Library/Assigned/Analytics), filter chips, video-card grid/list (thumbnail, title, visibility tier chip, duration), upload entry point.
**Functionality to preserve:** 3-segment structure, visibility-tier chip system (private/selected_clients/subscribers/public_preview per the domain model).

---

### Screen: Coach Messages
**Route:** `/coach/messages`
**Screenshots:** `coach/messages/thread-list.png`, `open-conversation.png`
**Current Layout:** thread list — header, "Start a Conversation" horizontally-scrollable client-card row, then existing-thread rows (avatar, name, last message preview, timestamp). Open conversation — back+name+specialty header, date-grouped message bubbles, bottom input row (attach "+", text field, send button).
**Current Visual Style:** **partially old design system** — imports `Card`/`Muted` from `ui.tsx` alongside otherwise-current-looking elements.
**Current UX Issues:** the send button sits directly beneath/behind the floating Ask Agent button in the open-conversation view (same overlap family as noted elsewhere) — this screen **does** have a physical bottom tab bar, yet the input row still visually collides with the FAB, because the input is pinned above the keyboard/safe-area independent of the tab-bar's own clearance logic.
**Functionality to preserve:** the "start a conversation" quick-picker row, date-grouped bubbles.

---

### Screen: Coach Profile
**Route:** `/coach/profile`
**Screenshots:** `coach/profile/top.png`, `bottom.png`
**Current Layout:**
1. "Profile" header, `Edit`
2. Identity card — avatar, name, title, rating+reviews, experience, specialty chips, `Preview Public Profile`
3. "Marketplace Profile" toggle — visible-to-athletes switch
4. "Coaching Plans" card — plan rows + `Manage Pricing`
5. "Availability" / "Reviews" — two-column card pair
6. "Professional Details" (Specializations, Languages, Coaching Philosophy — below the fold)
7. "Payments & Membership" (Payout Settings, Payment History, Client Memberships, Invoices)
8. "Settings" (Notifications, Privacy, Account & Security, Help & Support)
9. `Log Out`
**Functionality to preserve:** the marketplace-visibility toggle at the top (high-consequence setting placed prominently), the availability/reviews side-by-side pairing.

---

### Screen: Coach Announcements
**Route:** `/coach/announcements`
**Screenshot:** `coach/announcements/main.png` (reused from the prior hardening-pass verification; unchanged since)
**Current Visual Style:** current Fitora system (migrated in the prior pass) — `AppCard`, `ErrorState` with working retry, `EmptyState`, `ActionButton`.
**Functionality to preserve:** composer + sent-history list.

---

### Screen: Coach Coaches (owner-only)
**Route:** `/coach/coaches`
**Screenshot:** `coach/coaches/roster.png` (reused from the prior hardening-pass verification; unchanged since)
**Current Visual Style:** current Fitora system (migrated in the prior pass) — `StatusChip` for the OWNER badge, `EmptyState` for non-owner/empty roster.
**Functionality to preserve:** owner-only gating, temp-password reveal on creation.

---

### Screen: Landing
**Route:** `/`
**Screenshot:** `shared/login/landing.png`
**Current Layout:** brand mark + wordmark, hero headline, role picker (2 cards: User/Coach, "MOST POPULAR" badge on User), a notice banner about role persistence, a 4-cell feature grid (Daily coaching plan / Readiness & risk flags / Nutrition support / Progress views), `Continue` CTA, footer trust line.
**Current Visual Style:** its own bespoke, fully custom stylesheet (not `ui.tsx` and not `fitora.tsx` — a one-off screen with hand-tuned colors like `#111a30`/`#ff6437`).
**Functionality to preserve:** role selection state → `/login/[role]` navigation.

---

### Screen: Role Login
**Route:** `/login/[role]`
**Screenshot:** `shared/login/role-select.png` is actually the Landing/role-picker; `athlete-login-form.png` is this screen.
**Current Layout:** "ALL ROLES" link, role-specific header ("COACH LOGIN"/"USER LOGIN" with a tailored tagline), Email field, Password field, `Sign in as {role}` CTA, "OR", "Sign in with Google", (athlete only) "New here? Create an account" link.
**Current Visual Style:** **old design system** — imports `Banner, H1, Label, Muted, PrimaryButton, TextField` from `ui.tsx`.
**Functionality to preserve:** role-specific copy/theming, Google sign-in entry, athlete-only register link.

---

### Screen: Register (athlete self-signup)
**Route:** `/register`
**Not screenshotted live this pass** (no in-app entry point was found reachable from the current login screen in this session's flows — the code shows a router push target exists, but the visible "Create an account" link path wasn't exercised on-device; documented from code instead, per this task's own allowance to use code/dev data when a state can't be reproduced naturally).
**Current Layout (from code):** back link, "Create your account" H1, tagline, card — Full name / Email / Password / Sport / Position(optional) fields, inline error banner, `Create account` CTA.
**Current Visual Style:** **old design system** — imports `Banner, Card, H1, Label, Muted, PrimaryButton, TextField` from `ui.tsx`.
**Functionality to preserve:** athlete-only self-signup, client-side email/password-length pre-validation mirroring the server's rules.

---

### Screen: Coach — Add/Link Athlete
**Route:** `/coach/athletes/new`
**Not screenshotted live this pass** (reachable via Clients "+"; not navigated to in this session — documented from code).
**Current Visual Style:** **old design system** — imports `Banner, Card, Label, Muted, PrimaryButton, TextField` from `ui.tsx`.
**Functionality to preserve:** the "Create new / Link existing" toggle noted in the codebase's own architecture doc.

---

## Part 6 — Shared UI Patterns (current Fitora system, `components/fitora.tsx`)

**App bars:** `PrimaryAppBar` (greeting/title/subtitle + optional right-icon + notification bell w/ unread dot + avatar) is the standard tab-root header; several screens (Today's own header, stack-pushed detail screens) hand-roll a similar but not identical header instead of reusing it directly.

**Bottom navigation:** Athlete uses a custom `BottomNavigation` component (5 items, icon+label, underline-active indicator) driven by internal state — not Expo Router's native `Tabs`. Coach uses Expo Router's native `Tabs` (5 visible + 3 hidden) with its own hand-rolled `TabIcon` (34px height indicator bar + icon + label).

**Cards observed today (named by what they show, not a redesign taxonomy):**
- Summary/status card (Daily Status, Today grid) — 2×2 metric grid, no border between cells beyond a thin divider
- Metric tile (single stat, label beneath)
- Workout/plan card (name, meta line, progress bar, CTA)
- Coach card (avatar, name, rating, chips, price, CTA) — marketplace list
- Client card (avatar, name, sport, readiness/workout/nutrition mini-fields) — clients list
- Message/conversation card — avatar, name, preview, timestamp
- Empty-state card (icon tile, bold title, one-line body)
- Error-state card (message + retry button)
- Alert/warning banner (icon + title + body, left-accent color)

**Buttons:** `ActionButton` — filled (primary, white text) and presumably an outlined/secondary variant (seen as "Message"/"Manage Pricing"-style outlined buttons, though these appear to be built ad hoc per screen rather than always through one shared secondary-button component). Destructive actions (Leave Coach, Delete Account) use red text on a plain row, not a distinct button style. Disabled state observed as label-swap + `disabled` prop (e.g. "Saving…") rather than a visually distinct disabled button skin.

**Inputs:** plain `TextInput` styled per-screen (not a single shared `Input` component in the current system — `inputs.tsx` is the old system's input component, `fitora.tsx` has no direct equivalent, so every current screen re-declares its own input style block). Rating pills (1–5, 1–10) are bespoke per screen (`RatingScale` in check-in.tsx/rpe.tsx). Segmented controls exist as `SegmentedControl` (design system) and are used consistently (Meal Type, session AM/AFT/PM, Training/Upcoming/History, etc.).

**Status chips:** `StatusChip` — tone-based (seen: primary/blue for OWNER, warning/orange for "Review required", green for "Available"/positive, red for risk/urgent). Colors map onto the 4 semantic tokens below.

**Modals/Sheets:** the Assign workout/meal/routine flow is the only true in-app sheet/modal observed (Cancel/Confirm pattern, mode tabs). Most "detail" navigation is push-based (new screen), not a modal.

**Empty states:** consistent `EmptyState` component (icon tile, bold title, body) used across Training history, Content, Coaches, Announcements, Meal history.

**Error states:** `ErrorState` (message + retry button) confirmed in the migrated Announcements screen; not observed triggered live elsewhere this pass.

**Loading states:** a full-screen `LoadingState` (spinner + "Loading Fitora…") observed on cold navigation; inline small spinners not separately captured.

**Toast/status messages:** no toast pattern observed — success/error feedback is rendered as inline colored text within the same card (green for success, red for error), not a floating/transient toast.

---

## Part 7 — Visual Design Inventory

### Colors (`mobile/src/lib/theme.ts`, exact values, both roles share one palette)

| Token | Value | Observed Usage |
|---|---|---|
| `surface` | `#fbfcff` | Screen background |
| `surfaceRaised` | `#ffffff` | Cards, bottom nav bar |
| `surfaceInset` | `#f5f7fb` | Inputs, pill backgrounds, inactive segments |
| `ink` | `#0f172a` | Primary text |
| `inkMuted` | `#475569` | Secondary text, labels |
| `inkFaint` | `#64748b` | Tertiary/hint text |
| `line` | `#e2e8f0` | Default borders |
| `lineStrong` | `#cbd5e1` | Emphasized borders (inputs, rating pills) |
| `primary` | `#0b5cff` | CTAs, active nav, links, selected states — **used identically for both athlete and coach roles** (`ROLE_THEMES.athlete.accent === ROLE_THEMES.coach.accent`); the two roles differ only by icon (`home-outline` vs `barbell-outline`), not color |
| `primaryStrong` | `#0048d9` | Pressed/emphasis variant of primary |
| `primarySoft` | `#eaf1ff` | Selected-chip/icon-tile backgrounds |
| `ok` | `#16a34a` | Success text, positive chips |
| `okSoft` | `#e8f7ed` | Success banner backgrounds |
| `warn` | `#f59e0b` | Warning chips/banners |
| `warnSoft` | `#fff7e6` | Warning banner backgrounds |
| `bad` | `#ef4444` | Error text, destructive actions, danger readiness |
| `badSoft` | `#feecec` | Error banner backgrounds |

Landing (`index.tsx`) and the old `ui.tsx` system use their own separate hardcoded hex values (e.g. Landing's `#111a30` ink, `#ff6437` accent dot) rather than these tokens — a real, current inconsistency, not a redesign suggestion.

### Typography (sampled from `fitora.tsx`'s stylesheet; sizes in px, all screens use the system default font)

| Usage | Size | Weight | Line Height |
|---|--:|--:|--:|
| App bar title | 18 | 900 | 23 |
| App bar greeting/subtitle | 12 | default/600 | 16 |
| Section title | 15 | 900 | 20 |
| Section action link | 12 | 800 | — |
| Empty/error state title | 17 | 900 | — (centered) |
| Empty/error state body | 14 | default | 20 |
| Metric value | 16 | 900 | 20 |
| Metric label | 10 | default | 14 |
| Ring label (big number) | 20 | 900 | 23 |
| Alert title | 13 | 900 | 17 |
| Row title | 12 | 900 | 16 |
| Bottom nav label | 9 | 600 (800 active) | 13 |
| Chip text | 10 | 800 | 13 |

Stack-pushed screens (Check-in, RPE, Trends, Water) each declare their **own** larger page-title style locally (observed 26px/900 for "Daily Check-in") rather than pulling from a shared title token — titles are not visually uniform in size across the app (18px app-bar title vs. 26px stack-screen title).

### Spacing
- Screen horizontal padding: 15px (`ScreenContainer`'s `content.paddingHorizontal`)
- Scroll content bottom clearance: 150px (no bottom nav — just fixed this session for FAB clearance) / 98px (with bottom nav)
- Card-to-card gap: 7px (`content.gap`) at the container level; individual card internal `cardGap` commonly 18px between fields
- Bottom nav height: 84px + safe-area inset (coach's native Tabs); athlete's custom BottomNavigation not independently measured this pass

### Geometry
- Card radius: not a single named token in the sampled styles — cards use `borderRadius` values consistent with the `radius` scale (`sm:8, md:12, lg:16, xl:18, pill:999`)
- Buttons/inputs: `radius.md` (12) is the common rounding for pills/inputs/steppers observed in check-in.tsx
- Rating/segment pills: `radius.md` (12) for square-ish scale buttons, `radius.pill` (999) for true pill chips (StatusChip, filter chips)
- Borders: 1px solid `line`/`lineStrong` throughout; no heavier border weights observed
- Shadows: light card shadows observed on Landing's role cards and the floating Ask Agent button; most `AppCard` instances rely on a border, not a shadow, for separation

### Icons
- Library: `@expo/vector-icons` `Ionicons` exclusively, no other icon set observed
- Convention: outline variant for inactive/default, filled (solid) variant on focus/active (bottom-nav tabs, some status icons) — a consistent, deliberate pattern, not an inconsistency
- Typical sizes: 15–22px inline, 27–31px for nav/role icons, 56px for large empty-state icon tiles

---

## Part 8 / 9 — Density & Above-the-Fold

| Screen | Major Sections | Cards | Approx Scroll | Density | First Visible Content | Primary CTA Visible? | Important Info Below Fold? |
|---|--:|--:|---|---|---|---|---|
| Athlete Today | 4 | 3 | ~1 screen (this data set) | LOW–MODERATE | Header + Next Up card | Yes | No (at this data volume) |
| Athlete Training | 5 | 2 | ~1 screen | MODERATE | Segment tabs + date strip | Yes | 3rd exercise row / "View all" borderline |
| Active Workout | 4 | 3 | ~1–1.3 screens per exercise | MODERATE–HIGH | Header + progress card | Yes | Skip-exercise link often below fold |
| Nutrition | 5 | 3 | ~1 screen | LOW | Header + target-status card | Yes | No |
| Coach (athlete) | 5 | 4 | ~1.2 screens | MODERATE | Coach hero card | Yes (Message/View Profile) | Sessions/Switch/Leave rows |
| Marketplace | 7 | 3 cards + filters | ~1.5 screens (3 coaches) | MODERATE–HIGH | Banner + search | No (first CTA is mid-list) | 2nd/3rd coach cards |
| Marketplace Profile | 7 | 6 | ~2.5 screens | HIGH | Hero card | No dedicated top CTA (plan radios are the "action") | Reviews, most pricing detail |
| Progress | 8 | 6 | ~1.8 screens | HIGH | Range selector + trend rows | N/A (no single CTA) | Coach Feedback card |
| Check-in | 5 | 2 | ~1.8 screens | MODERATE–HIGH | Header + tagline | No (below first card) | Heart-rate section |
| Water | 4 | 4 | ~1.5 screens | MODERATE–HIGH | Header + goal ring | No | Reminder toggle |
| Athlete Profile | 10 | 8 | ~2.5 screens | HIGH | Identity card | N/A (settings screen) | Most rows |
| Notifications (empty) | 2 | 1 | ~0.3 screens | LOW | Header + empty card | N/A | No |
| Coach Home | 7 | 5 | ~1.3 screens | MODERATE | Header + Needs Attention | No (Quick Actions below fold) | Quick Actions |
| Coach Clients | 3 | N (list) | ~1–2 screens (roster size) | MODERATE | Filter tabs + first cards | N/A | Later roster rows |
| Client Detail | 9 | 8 | ~2+ screens | HIGH | Header + Today grid | No | Most of the screen |
| Coach Plan | 9 | 5 | ~1.5 screens | MODERATE–HIGH | Segment tabs + quick filters | Yes (New Plan) | Templates/Routines |
| Coach Content | 4 | N (grid) | ~1–1.5 screens | MODERATE | Segment tabs | N/A | Later video rows |
| Coach Messages (list) | 2 | N (threads) | ~1 screen | LOW–MODERATE | "Start a Conversation" row | N/A | Older threads |
| Coach Profile | 9 | 7 | ~2.5 screens | HIGH | Identity card | No (Preview Public Profile is outlined, not filled) | Payments/Settings |
| Landing | 5 | 2 role cards + feature grid | ~1 screen | MODERATE | Brand + hero | Yes (Continue, but bottom) | Feature grid borderline |

---

## Part 10 — Interaction Hierarchy Notes

- **Athlete Today / Training / Nutrition / Check-in / Active Workout / RPE:** each has exactly one clear, unambiguous primary action — no competing-CTA issue found.
- **Coach Home:** no single dominant CTA above the fold; "Assign Workout" (the only filled button) is buried in a below-the-fold Quick Actions row while multiple text links ("View all", "Review") compete for attention above it.
- **Marketplace / Marketplace Profile / Progress / Client Detail / Coach Profile:** these are inherently browse/reference screens with many equal-weight rows and no single primary action — not a defect, just worth naming for redesign prioritization (they're the screens most likely to benefit from a clearer "primary next step" if one is wanted).
- **Athlete Coach tab:** two competing filled/outlined buttons side by side (Message / View Profile) at equal visual weight — a genuine "which one first" ambiguity, factually observed, not just an opinion.
- **Notifications:** two back-navigation affordances (see that screen's issue note) is the one clear "duplicate entry point" found in this pass.

---

## Part 11 — UI/UX Problem Inventory (evidence-based only)

**Information hierarchy**
- Coach Home has no clear single primary action above the fold (Part 10).
- Athlete Coach tab has two equal-weight competing buttons (Message/View Profile).

**Density**
- Client Detail and Coach Profile are the two heaviest screens captured (~2–2.5 screens of scroll, 7–8 cards each).

**Navigation**
- Notifications screen: duplicate back affordance.
- Notifications screen and `_layout.tsx` maintain two independently-drifted route allowlists for what is conceptually the same "can we deep-link here" question.
- Coach Clients list shows a client's workout status as "No plan" immediately after a real assignment was made via the API — the detail screen is correct, the list summary is stale (not re-verified whether a manual refresh fixes it, since the list's own pull-to-refresh wasn't separately tested against this specific field).

**Data/Copy**
- "Coach {name}" duplication bug: any coach whose own `name` already starts with "Coach" (e.g. "Coach Kumar") renders as "Coach Coach Kumar" everywhere a role-prefixed coach label is shown (Training tab, My Coach screen).

**Forms**
- The mobile app has **no custom workout/meal-plan builder** — "New Workout"/"New Meal Plan" either assign an existing template or silently create one fixed default template/plan. This is a large, real functional gap relative to what the Part 5 task brief assumed might exist, not a visual issue.

**Modal/Sheet & floating-element UX**
- The floating Ask Agent button overlaps primary controls (`Complete Set`/`Skip Rest` on Active Workout, the custom "Add" button on Water, the send button on Coach Messages) at these screens' **default** scroll/layout positions — separate from, and in addition to, the "permanently trapped at end-of-scroll" class of bug already fixed earlier this session for no-bottom-nav screens generally. These are default-visible or default-position overlaps, not scroll-dependent ones, and were not covered by that earlier fix.

**Design-system consistency**
- 5 screens beyond the 6 already migrated in the prior pass still import from the old `ui.tsx` system: `notifications.tsx`, `login/[role].tsx`, `register.tsx`, `coach/athletes/new.tsx` (fully), and `coach/messages.tsx` (partially — `Card`/`Muted` only).
- Landing (`index.tsx`) uses its own fully bespoke stylesheet, on neither the old nor current shared system.
- Page-title sizing is inconsistent between tab-root screens (18px `PrimaryAppBar` title) and stack-pushed screens (26px hand-rolled title).
- Both roles share one accent color; only iconography differs — worth confirming this is the intended brand direction before a redesign either reinforces or changes it.

**Empty/Error/Loading states**
- Empty and loading states are consistent and well-covered (`EmptyState`/`LoadingState`/`ErrorState`) everywhere the current design system is in use; the old-system screens (Notifications) use plain text instead.

---

## Part 15 — Device Context

- Emulator: `sdk_gphone64_x86_64`, Android 15
- Native resolution: 1080×2400 px, density 420 (xxhdpi) → ~411dp logical width (this session's earlier responsive pass already covers ~360dp/~430dp buckets separately)
- All screenshots in this baseline were taken at native/default resolution unless otherwise noted
- No font-scaling or display-scaling override was applied

## Part 16 — Data Consistency

A single, consistent QA dataset was used for the majority of captures:
- **Athlete:** "Meera Chandran" (`meera.baseline@fitora.test`), sport Swimming, freshly registered this session, linked to Coach Kumar, assigned the "Upper Body Strength" template (6 exercises) for today, 750ml water logged, one check-in completed (all scales rated 4 → readiness 45/Low)
- **Coach:** "Coach Kumar" (`coach.kumar@acme.test`), pre-existing account from earlier session work, 4.7★/3 reviews, 6 linked clients by the end of this pass (including Meera)
- A second athlete, "Chetan Das" (pre-existing, has real RPE history), was used specifically for Client Detail's "Recent Activity" capture, since Meera's account was too fresh to show that section populated
- Credentials are QA-only test accounts on a non-production Atlas database already used throughout this session's work; not reproduced here for security hygiene

## Part 17 — Source Modifications

No application source files were modified to produce this document. See the final response for the `git status` proof.
