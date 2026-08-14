import { useCallback, useEffect, useRef } from "react";
import { InteractionManager, useWindowDimensions, View, type ViewProps } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMobileTour, type TourRect } from "./MobileTourProvider";
import { MIN_VALID_TARGET_PX } from "./tourConfig";

export type SpotlightRect = TourRect;

type SpotlightTargetProps = ViewProps & {
  id: string;
  children: React.ReactNode;
};

/** A measurement this implausible is a layout glitch (mid-transition, a
 * flattened/misattributed native node, a stale frame), not a real target —
 * report nothing and let the next frame try again rather than showing a
 * spotlight that visibly doesn't match the feature. */
function isPlausibleRect(x: number, y: number, width: number, height: number, windowWidth: number, windowHeight: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) return false;
  if (width < MIN_VALID_TARGET_PX || height < MIN_VALID_TARGET_PX) return false;
  if (width > windowWidth * 3 || height > windowHeight * 3) return false;
  // Fully off-screen in either axis — not "needs scrolling", just nonsensical.
  if (x + width <= 0 || x >= windowWidth || y + height <= 0 || y >= windowHeight * 4) return false;
  return true;
}

/**
 * Shared "am I the active step, and if so where am I really on screen right
 * now" logic for both `SpotlightTarget` (wraps a target) and `useSpotlightRef`
 * (attaches to one that's already absolutely positioned). Tracks every frame
 * — not on a coarse timer — so a layout shift from data loading, an
 * appearing/disappearing banner, a keyboard, or scrolling is reflected the
 * very next frame instead of appearing as a briefly misplaced highlight.
 * Also asks the tour to auto-scroll the target into view when it's only
 * partially visible behind the screen's fixed header/tab-bar chrome.
 */
function useLiveTargetRect(id: string, viewRef: React.RefObject<View | null>) {
  const { state, reportTargetRect, chrome, scrollViewport, requestScrollIntoView, measureRelativeToRoot } = useMobileTour();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isCurrentStep = state.active && state.steps[state.index]?.id === id;
  const lastAcceptedRef = useRef<TourRect | null>(null);

  const measure = useCallback(() => {
    const node = viewRef.current;
    if (!node) return;
    measureRelativeToRoot(node, (x, y, width, height) => {
      if (!isPlausibleRect(x, y, width, height, windowWidth, windowHeight)) return;

      // Require the same measurement twice in a row before trusting it as
      // "settled" — a single frame can land mid-layout-pass (e.g. right after
      // a cross-screen nav, or while async content is still expanding a
      // header/card), and reporting that transient value would flash a
      // wrong-sized spotlight for a frame before self-correcting. Once
      // settled, every subsequent frame still reports live (for scroll/resize
      // tracking) since consecutive real frames naturally repeat-confirm.
      const prev = lastAcceptedRef.current;
      const settled = Boolean(prev && Math.abs(prev.x - x) < 0.5 && Math.abs(prev.y - y) < 0.5 && Math.abs(prev.width - width) < 0.5 && Math.abs(prev.height - height) < 0.5);
      lastAcceptedRef.current = { x, y, width, height };
      if (!settled) return;

      reportTargetRect(id, { x, y, width, height });

      // Prefer the registered scroll view's own measured bounds — by
      // construction that's exactly the true visible area (see
      // `useTourScrollView` doc comment). Fall back to the screen's tracked
      // header/tab-bar chrome, then to safe-area insets, so a screen missing
      // either signal still gets a reasonable visibility check.
      const safeTop = scrollViewport ? scrollViewport.y : chrome.top ? chrome.top.y + chrome.top.height : insets.top;
      const safeBottom = scrollViewport
        ? scrollViewport.y + scrollViewport.height
        : chrome.bottom
          ? chrome.bottom.y
          : windowHeight - insets.bottom;
      const fullyVisible = y >= safeTop - 0.5 && y + height <= safeBottom + 0.5;
      if (!fullyVisible) requestScrollIntoView(id, node);
    });
  }, [id, viewRef, reportTargetRect, chrome, scrollViewport, insets, windowWidth, windowHeight, requestScrollIntoView, measureRelativeToRoot]);

  useEffect(() => {
    if (!isCurrentStep) return;
    lastAcceptedRef.current = null;
    let frame = 0;
    let cancelled = false;
    const loop = () => {
      if (cancelled) return;
      measure();
      frame = requestAnimationFrame(loop);
    };
    // A step can go active right as a route/tab transition is still
    // finishing (nav animation, a re-render from newly-loaded data) — give
    // native interactions a chance to settle before the first measurement
    // instead of racing it, rather than trusting whatever layout exists at
    // the exact instant the step becomes current.
    const handle = InteractionManager.runAfterInteractions(loop);
    return () => {
      cancelled = true;
      handle.cancel();
      cancelAnimationFrame(frame);
    };
  }, [isCurrentStep, measure]);

  return measure;
}

/**
 * Wraps a tour target so its live on-screen rect (relative to the shared
 * root view — see `measureRelativeToRoot`) is reported to the tour provider
 * whenever it might have moved: mount, layout, and every animation frame
 * while it's the active step (see `useLiveTargetRect`) — that covers
 * scrolling, resizing, and content reflowing for free, since a live
 * measurement is taken on every call. This is separate from (and coexists
 * with) the provider's own 100ms mount-poll, which only answers "has the
 * target mounted," not "where is it right now."
 *
 * `collapsable={false}` is load-bearing on Android: without it, RN's native
 * view-flattening optimization can merge this wrapper away when it has no
 * distinguishing paint of its own, and measuring a flattened node has been
 * observed to answer for the wrong (parent or sibling-merged) bounds — the
 * exact "highlight matches a different element" failure mode.
 */
export function SpotlightTarget({ id, children, style, ...rest }: SpotlightTargetProps) {
  const viewRef = useRef<View>(null);
  const measure = useLiveTargetRect(id, viewRef);

  return (
    <View ref={viewRef} style={style} onLayout={measure} collapsable={false} {...rest}>
      {children}
    </View>
  );
}

/**
 * Same measurement/tracking behavior as `SpotlightTarget`, but for targets
 * that are already absolutely positioned in their own tree (the Ask Agent
 * FABs) — attach `ref`/`onLayout` directly to the existing component instead
 * of adding a wrapping View that would disturb its own absolute positioning.
 * Callers must also spread `collapsable={false}` onto that component (see
 * `SpotlightTarget`'s doc comment for why).
 */
export function useSpotlightRef(id: string): { ref: React.RefObject<View | null>; onLayout: () => void } {
  const viewRef = useRef<View>(null);
  const measure = useLiveTargetRect(id, viewRef);
  return { ref: viewRef, onLayout: measure };
}
