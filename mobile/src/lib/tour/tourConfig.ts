/** Shared tuning constants for the Pex tour/mascot system — kept in one place so
 * spacing/timing stay consistent across TourOverlay, SpeechBubble, and MascotAnimation. */

/** Fixed anatomy shared by every Pex pose (viewBox 0 0 200 190). */
export const MASCOT_ANATOMY = {
  viewBox: "0 0 200 190",
  ring: { cx: 100, cy: 88, r: 66, strokeWidth: 8 },
  body: { cx: 100, cy: 92, r: 46, strokeWidth: 4 },
} as const;

/** Default on-screen footprint of the mascot (before any scale prop). */
export const MASCOT_SIZE = 84;

/** How much room to leave clear at the bottom of the screen so the bubble/mascot
 * never overlaps the Ask Agent FAB stack (fab bottom:16 h:56, executeFabWrap
 * bottom:150, statusPill bottom:208 — see components/AskAgentControl.tsx). */
export const RESERVED_BOTTOM_FAB_CLEARANCE = 220;

export type SpotlightPadding = { top: number; right: number; bottom: number; left: number };

/** Default spotlight padding on all four edges — a step can override any
 * subset via `MobileTourStep.spotlightPadding` (e.g. a wide-but-short banner
 * may want less top/bottom padding than left/right). */
export const DEFAULT_SPOTLIGHT_PADDING: SpotlightPadding = { top: 10, right: 10, bottom: 10, left: 10 };

/** Default spotlight corner radius — override per step via `spotlightRadius`
 * to match a target that isn't itself an ~16px-radius card (e.g. a pill). */
export const SPOTLIGHT_RADIUS = 16;

/** @deprecated kept for any external reference; use `DEFAULT_SPOTLIGHT_PADDING`. */
export const SPOTLIGHT_PADDING = DEFAULT_SPOTLIGHT_PADDING.top;

export const BUBBLE_MAX_WIDTH = 320;
export const BUBBLE_MARGIN = 16;
export const BUBBLE_TARGET_GAP = 14;

/** A measured rect narrower or shorter than this is treated as not-yet-settled
 * layout noise (e.g. a first pass before content/images finish sizing) rather
 * than a real target — the spotlight waits instead of drawing a bogus box. */
export const MIN_VALID_TARGET_PX = 6;

/** Breathing room kept between a scrolled-to target's leading edge and the
 * screen's fixed chrome (header above / tab bar below) after an auto-scroll. */
export const SCROLL_INTO_VIEW_MARGIN = 24;

/** Minimum time between repeated auto-scroll attempts for the same target —
 * `SpotlightTarget` re-checks visibility every frame, but re-issuing
 * `scrollTo` that often would fight its own in-flight scroll animation. */
export const SCROLL_INTO_VIEW_RETRY_MS = 500;

/** Rect re-measurement cadence while a tour/mini-tour is active, used as a
 * fallback for environments where `requestAnimationFrame` is throttled (e.g.
 * a backgrounded webview) — the primary tracking loop runs every frame so
 * layout shifts, scrolling, and content loading are reflected virtually
 * instantly instead of up to one poll interval late. */
export const RECT_POLL_INTERVAL_MS = 250;

export const MOVE_DURATION_MS = 550;
export const ENTER_DURATION_MS = 320;
export const LEAVE_DURATION_MS = 260;
export const BUBBLE_ENTER_DURATION_MS = 260;

export const REACTION_DEFAULT_DURATION_MS = 2000;

/** How long Pex's post-tour "flight" to the header badge plays before the tour
 * layer hands off to the persistent `PexHeaderBadge` sitting at that same spot. */
export const LANDING_DURATION_MS = 700;

/** How often `PexHeaderBadge` re-measures its own position and reports it as the
 * landing target — header position rarely changes, so this stays cheap and slow. */
export const HOME_RECT_POLL_INTERVAL_MS = 1000;
