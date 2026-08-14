import type { SpotlightRect } from "./SpotlightTarget";
import { BUBBLE_MARGIN, BUBBLE_MAX_WIDTH, BUBBLE_TARGET_GAP, MASCOT_SIZE, RESERVED_BOTTOM_FAB_CLEARANCE } from "./tourConfig";

export type Viewport = { width: number; height: number };
export type Insets = { top: number; bottom: number };

export type TourGroupPlacement = {
  side: "above" | "below";
  /** Top-left of the mascot+bubble row. */
  x: number;
  y: number;
  width: number;
  /** Horizontal offset (within the group) the bubble's tail should point at. */
  pointerX: number;
};

const MIN_GROUP_HEIGHT = 140;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * Computes where the mascot+bubble row sits relative to a target rect: always
 * fully above or fully below it (never overlapping), horizontally clamped to
 * the viewport, and never inside the reserved Ask Agent FAB clearance at the
 * bottom. Both the mascot and the speech bubble read this same box so they
 * move and re-anchor together.
 */
export function computeTourGroupPlacement(rect: SpotlightRect, viewport: Viewport, insets: Insets): TourGroupPlacement {
  const topLimit = insets.top + BUBBLE_MARGIN;
  const bottomLimit = viewport.height - insets.bottom - RESERVED_BOTTOM_FAB_CLEARANCE;

  const width = Math.min(viewport.width - BUBBLE_MARGIN * 2, BUBBLE_MAX_WIDTH + MASCOT_SIZE + 12);
  const x = clamp(rect.x + rect.width / 2 - width / 2, BUBBLE_MARGIN, Math.max(BUBBLE_MARGIN, viewport.width - width - BUBBLE_MARGIN));

  const spaceBelow = bottomLimit - (rect.y + rect.height + BUBBLE_TARGET_GAP);
  const spaceAbove = rect.y - BUBBLE_TARGET_GAP - topLimit;
  const side: "above" | "below" = spaceBelow >= MIN_GROUP_HEIGHT || spaceBelow >= spaceAbove ? "below" : "above";

  const y =
    side === "below"
      ? clamp(rect.y + rect.height + BUBBLE_TARGET_GAP, topLimit, Math.max(topLimit, bottomLimit - MIN_GROUP_HEIGHT))
      : clamp(rect.y - BUBBLE_TARGET_GAP - MIN_GROUP_HEIGHT, topLimit, Math.max(topLimit, bottomLimit - MIN_GROUP_HEIGHT));

  const pointerX = clamp(rect.x + rect.width / 2 - x, 24, width - 24);

  return { side, x, y, width, pointerX };
}

/** Mascot's own top-left within the group box (bubble occupies the rest of the row width). */
export function mascotOriginWithinGroup(placement: TourGroupPlacement): { x: number; y: number } {
  return { x: placement.x, y: placement.y };
}

/**
 * A step's target can legitimately never mount — e.g. the guardian athlete
 * switcher only renders when there are 2+ linked athletes — while the step
 * itself still reports "ready" (that mount-tracking is independent of
 * `SpotlightTarget`'s own rect measurement). Without a fallback, `TourOverlay`
 * would have nothing to anchor to and would render nothing at all: a silent
 * stall with no dim, no mascot, no bubble, and no way for the user to even
 * see a Skip button. This mirrors the old fixed-position dialog's behavior
 * (which never depended on measuring anything) so a step with no real target
 * still shows its explanation, just without a spotlight cutout to point at.
 */
export function computeFallbackPlacement(viewport: Viewport, insets: Insets, cardPosition: "top" | "bottom" = "bottom"): TourGroupPlacement {
  const topLimit = insets.top + BUBBLE_MARGIN;
  const bottomLimit = viewport.height - insets.bottom - RESERVED_BOTTOM_FAB_CLEARANCE;
  const width = Math.min(viewport.width - BUBBLE_MARGIN * 2, BUBBLE_MAX_WIDTH + MASCOT_SIZE + 12);
  const x = clamp((viewport.width - width) / 2, BUBBLE_MARGIN, Math.max(BUBBLE_MARGIN, viewport.width - width - BUBBLE_MARGIN));
  const y = cardPosition === "top" ? topLimit : Math.max(topLimit, bottomLimit - MIN_GROUP_HEIGHT);
  return { side: cardPosition === "top" ? "above" : "below", x, y, width, pointerX: width / 2 };
}
