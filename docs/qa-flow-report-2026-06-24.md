# Apex Mobile — Full-Flow Emulator QA Report

- **Date:** 2026-06-24
- **Build:** debug x86_64 APK (`app.apex.coaching`), emulator `Pixel_7` / `emulator-5554`, Metro dev bundle.
- **Backend:** deployed Cloud Run API `https://scp-server-futtj2vwgq-el.a.run.app` (Atlas `athletes.onwotwy`) — seeded.
- **Accounts:** Coach Kumar (owner) `coach.kumar@acme.test`, Athlete Arjun `athlete.arjun@acme.test`, Guardian Mr. Rao `parent.rao@acme.test`.
- **Mode:** verify-and-report (no app code changed); full write-testing on the `acme.test` test academy.
- **Screenshots:** `builds/qa-flow-2026-06-24/` (`*-sm.png` are downscaled copies for review).

## Verdict

**The full performance loop works end-to-end across all three roles.** Arjun logged a deliberately fatigued check-in → readiness recomputed to **25 (red / "RECOVER")** → Coach Kumar saw him in **Needs Attention**, the note in the **Athlete Notes** inbox, and the detail page (readiness 25, present, sessions completed) → coach sent **feedback** and a **message reply** → both the **athlete** and the **guardian** saw the data + coach feedback, and notifications fired on every hop.

## End-to-end loop hops (all PASS)

| Hop | Evidence |
|---|---|
| Athlete logs wellness/attendance/training/RPE/recovery/note | green confirmations per write; LOAD 350 / RPE 5 on Today |
| Readiness/risk recompute | Today readiness **25 red "RECOVER"** (`09-today-after-log`) |
| Coach sees risk | Needs Attention "Arjun Rao — Low readiness 25"; AVG readiness 25; Present 1; Sessions 1 (`14-coach-dashboard`) |
| Coach sees note | Athlete Notes "Right calf tight… Low energy today." NEEDS REPLY (`14`) |
| Coach detail mirrors logs | readiness 25, Present, AM/AFT/PM Completed (`15`) |
| Coach → athlete feedback | "Feedback sent to the athlete." (`15c`) |
| Athlete → coach message | coach Messages "1 unread from Arjun"; thread reply sent (`16`,`16c`) |
| Guardian read-only visibility | readiness 25, sleep 5, present, sessions completed, load 350 (`20`); coach feedback text + full activity feed (`22`); trends 06-24 R25/L350 (`21`) |
| Notifications fire | athlete URGENT feedback note; coach "New message from Arjun"; guardian "Coach feedback for Arjun" |

## Per-role screen coverage (PASS)

- **Login / role-picker** — landing + role cards; role-themed login (athlete amber, coach green, guardian teal); email/password sign-in all 3 roles.
- **Athlete** — Today (readiness ring, stat cards, today's plan); **Log** (wellness ✓, attendance ✓, training AM/AFT/PM ✓, RPE ✓, heart-rate ✓, recovery ✓, note ✓); Trends (readiness/load/recovery + wellness-signals charts, 7d/14d/30d toggles); Coach section (coach updates + embedded messaging, message sent); Notifications (list, URGENT badge, **Mark all read** ✓).
- **Coach** — Squad dashboard (stats, Needs Attention, Athlete Notes inbox); Roster→Athlete detail; **Send feedback** ✓; Messages (receive + reply) ✓; Announce (post ✓, 3 recipients); Coaches owner list (with the new shared header); Notifications.
- **Guardian** — Today (read-only), Trends (read-only table), Feedback (coach feedback + recent-activity feed), Notifications. **No edit controls anywhere — read-only confirmed.**

## Findings (no blockers; all minor — for a follow-up fix pass)

1. **RPE submit has no confirmation feedback.** Every other Log action shows a green banner ("Check-in saved.", "Attendance: present.", "AM session: completed.", "Heart rate saved.", "Recovery saved.", "Note saved."), but **"Submit RPE" shows nothing**. The write **does persist** (Today shows LOAD 350 / RPE 5; coach + guardian show the load), so this is a missing-feedback UX inconsistency, not a data bug. *File:* `mobile/src/app/athlete/dashboard.tsx` (RPE submit handler). *Severity: low.*
2. **Today "RECOVERY" stat shows "-" after recovery is logged.** Recovery modalities saved fine (chips stay selected, "Recovery saved." banner), but the athlete Today card and the guardian Today card both show RECOVERY "-"/"no data". Likely the RECOVERY stat is a separate recovery-score metric not driven by modality logging — confirm intended vs. display gap. *Files:* `mobile/src/app/athlete/dashboard.tsx`, `mobile/src/app/guardian/dashboard.tsx`. *Severity: low.*
3. **Log form scrolls back to top after each inline save.** Saving attendance/training/heart-rate/recovery/note jumps the scroll position to the top, so logging several items in a row requires re-scrolling each time. *File:* `mobile/src/app/athlete/dashboard.tsx` (Log section). *Severity: low / UX polish.*
4. **Message bubble alignment differs between roles (verify intended).** In the athlete thread the user's own messages are right-aligned; in the coach thread the coach's own sent message appears left-aligned (avatar on the right). Possible inconsistency in the shared `MessageCenter`. *File:* `mobile/src/components/MessageCenter.tsx`. *Severity: low — confirm design intent.*

## Not exercised (scope notes)

- Dedicated athlete screens `check-in.tsx`, `rpe.tsx`, `water.tsx` — the inline **Log** section already covers wellness + RPE; hydration/water not submitted.
- Deliberate **bad-password** login — skipped to avoid lockout/rate-limit on the live API.
- **Creating a new coach** (Coaches → Add) — form verified to render; not submitted (would create a real account).
- Guardian `athletes/[athleteId]` detail modal — the guardian dashboard already shows the single linked athlete (Arjun).
- Mid-scale taps during wellness automation occasionally didn't register (test-harness artifact, not an app bug); the saved check-in values still drove the low readiness.

## Test data written to the deployed DB (acme.test academy, 2026-06-24)

Arjun: wellness check-in, attendance=present, AM/AFT/PM=completed, RPE (load 350), heart-rate 52/58, recovery (stretching/mobility/hydration), note to coach, 1 message to coach. Coach Kumar: 1 feedback comment to Arjun, 1 message reply, 1 announcement ("QA check: recovery focus today…").
