import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Platform, useWindowDimensions, type View, type ViewStyle } from "react-native";
import * as SecureStore from "expo-secure-store";
import { router, usePathname } from "expo-router";
import { apiJson } from "../api";
import { useAuth } from "../auth";
import { dashboardPathForRole, type Role } from "../roles";
import { MOBILE_TOUR_STEPS, type MobileTourStep, type MobileTourStepContext } from "./steps";
import { speakTourStep, stopTourNarration } from "./tourNarration";
import {
  DEFAULT_TOUR_PREFS,
  getStoredJson,
  setStoredJson,
  tourCompletedKey,
  tourPrefsKey,
  tourSkippedKey,
  type TourPrefs,
} from "./tourStorage";
import { fireMascotReaction } from "./reactions";
import { LANDING_DURATION_MS, SCROLL_INTO_VIEW_MARGIN, SCROLL_INTO_VIEW_RETRY_MS } from "./tourConfig";

// Single switch for the guided tour's trigger behavior.
//   false (default) — shows once per new user, then stays dismissed.
//   true             — replays on every login (useful for testing/demos).
//
// On the deployed web build, this is read at CONTAINER STARTUP (not baked in
// at Docker build time) from window.__RUNTIME_CONFIG__, which
// docker/entrypoint.sh regenerates from the Cloud Run env var TOUR_ALWAYS_SHOW
// every time the container boots — so changing it in the Cloud Run console
// and deploying a new revision takes effect with no image rebuild. Local dev
// and native builds have no window/__RUNTIME_CONFIG__, so they fall back to
// the build-time EXPO_PUBLIC_TOUR_ALWAYS_SHOW from mobile/.env.
function readTourAlwaysShow(): boolean {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const runtimeValue = (window as unknown as { __RUNTIME_CONFIG__?: Record<string, string> }).__RUNTIME_CONFIG__
      ?.TOUR_ALWAYS_SHOW;
    if (runtimeValue !== undefined) return runtimeValue === "true";
  }
  return process.env.EXPO_PUBLIC_TOUR_ALWAYS_SHOW === "true";
}
const TOUR_ALWAYS_SHOW = readTourAlwaysShow();

// Same-screen steps can still be waiting on that screen's own initial data
// fetch (not just an already-mounted target) — give this real headroom, not
// just enough time for a re-render. Cross-screen steps additionally wait on
// navigation + that screen's mount.
const SAME_SCREEN_TIMEOUT_MS = 5000;
const CROSS_SCREEN_TIMEOUT_MS = 7000;
const POLL_INTERVAL_MS = 100;

/** A target's live on-screen rect in window coordinates, as reported by
 * `SpotlightTarget`/`useSpotlightRef` via `measureInWindow`. */
export type TourRect = { x: number; y: number; width: number; height: number };

/** The screen's fixed, non-scrolling chrome (header above / tab bar below the
 * scrollable body), as measured live by `useReportChrome` in `AppFrame`. Used
 * as a fallback safe-visible-band signal when no scroll view is registered
 * (e.g. a screen mode with no `useTourScrollView`, like the athlete chat
 * panel) — the registered scroll view's own measured bounds (`scrollViewport`)
 * are preferred when available, since a `ScrollView` sized by flexbox between
 * a screen's own header/tab-bar (or a navigator's own tab bar it never
 * extends behind) already reports exactly the true visible band by
 * construction, with no assumptions about surrounding chrome at all. */
type ChromeRects = { top: TourRect | null; bottom: TourRect | null };

function rectsEqual(a: TourRect | null, b: TourRect | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

type TourState = {
  active: boolean;
  role: Role | null;
  steps: MobileTourStep[];
  index: number;
  /** True once the current step's target has confirmed it mounted on screen. */
  ready: boolean;
  /** Current step target's live rect, or null before it's been measured. */
  activeRect: TourRect | null;
  /** True only during the brief post-completion flight to the header badge — see `finish`. */
  landing: boolean;
  note: string | null;
  noteLoading: boolean;
  audioEnabled: boolean;
  audioSpeaking: boolean;
};

export type TourHighlightStyle = ViewStyle;

type TourContextValue = {
  state: TourState;
  startTour: (role: Role) => void;
  /** Starts a short, scoped tour over an arbitrary subset of steps (e.g. from a `ContextualHelp` icon), reusing existing step ids/targets. */
  startMiniTour: (steps: MobileTourStep[]) => void;
  /** Clears this role's "seen" flag and restarts the tour from step 0 — used by the "Replay guided tour" settings action. */
  replayTour: (role: Role) => Promise<void>;
  next: () => void;
  back: () => void;
  skip: () => void;
  reportTargetMounted: (id: string) => void;
  reportTargetUnmounted: (id: string) => void;
  reportTargetRect: (id: string, rect: TourRect) => void;
  /** Reports the header profile badge's live position — read once, at completion, to fly Pex there. */
  reportHomeRect: (rect: TourRect) => void;
  /** The screen's currently-measured fixed header/tab-bar bounds — see `ChromeRects`. */
  chrome: ChromeRects;
  reportChromeRect: (edge: "top" | "bottom", rect: TourRect | null) => void;
  /** The registered scroll view's own live on-screen bounds — the preferred
   * "what's actually visible" signal (see `ChromeRects` doc comment). */
  scrollViewport: TourRect | null;
  reportScrollViewport: (rect: TourRect | null) => void;
  /** The screen currently on-stage registers its main scrollable container so a
   * step whose target isn't fully visible can be scrolled into view automatically. */
  registerScrollView: (ref: RefObject<{ scrollTo: (opts: { x?: number; y?: number; animated?: boolean }) => void } | null>) => () => void;
  /** Asks the registered scroll view to bring `targetNode` fully into the safe
   * (non-chrome-obscured) viewport band, throttled per target id. No-ops if no
   * scroll view is registered (e.g. a non-scrolling screen) or already visible. */
  requestScrollIntoView: (id: string, targetNode: View | null) => void;
  /** Registers the single top-level View (mounted once in the root layout,
   * see `useTourRootView`) that every tour measurement is computed relative
   * to — see `measureRelativeToRoot` for why this replaces `measureInWindow`. */
  registerRootView: (ref: RefObject<View | null>) => () => void;
  /**
   * Measures `node`'s position relative to the shared root view via
   * `measureLayout`, instead of `measureInWindow`'s device-window-relative
   * coordinates. On this app's RN/Fabric + expo-router setup the two are
   * *not* interchangeable: screen content lives inside the router's
   * navigator, which turns out to report `measureInWindow` coordinates from
   * a different effective origin than `TourOverlay`'s own absolutely-
   * positioned root (off by exactly the top safe-area inset in testing —
   * likely a Fabric multi-surface quirk, not something to work around with a
   * hardcoded offset). Measuring both the target *and* the overlay relative
   * to one shared ancestor sidesteps the discrepancy entirely, whatever its
   * native-side cause.
   */
  measureRelativeToRoot: (node: View | null, onResult: (x: number, y: number, width: number, height: number) => void) => void;
  registerAction: (id: string, fn: () => void) => () => void;
  playAudio: () => void;
  pauseAudio: () => void;
  replayAudio: () => void;
  prefs: TourPrefs;
  updatePrefs: (partial: Partial<TourPrefs>) => void;
};

const INITIAL_STATE: TourState = {
  active: false,
  role: null,
  steps: [],
  index: 0,
  ready: false,
  activeRect: null,
  landing: false,
  note: null,
  noteLoading: false,
  audioEnabled: false,
  audioSpeaking: false,
};

const TourContext = createContext<TourContextValue | null>(null);

function seenKey(userId: string, role: Role) {
  return `scp.mobile.tour.seen.${userId}.${role}`;
}

async function getStoredFlag(key: string): Promise<string | null> {
  if (Platform.OS === "web") return globalThis.localStorage?.getItem(key) ?? null;
  return SecureStore.getItemAsync(key);
}

async function setStoredFlag(key: string): Promise<void> {
  if (Platform.OS === "web") {
    globalThis.localStorage?.setItem(key, "1");
    return;
  }
  await SecureStore.setItemAsync(key, "1");
}

async function removeStoredFlag(key: string): Promise<void> {
  if (Platform.OS === "web") {
    globalThis.localStorage?.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export function useMobileTour(): TourContextValue {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error("useMobileTour must be used within MobileTourProvider");
  return ctx;
}

/**
 * Marks a component as the on-screen target for a tour step. The component
 * applies `highlightStyle` to itself (spread into its own style array) when
 * a *different* step is simultaneously visible on the same screen (e.g. the
 * header and the readiness card), dimming itself slightly so the active
 * target reads clearly — the active target's own glow now lives in
 * `TourOverlay`'s spotlight ring instead (drawn above the real content, not
 * as a border the target draws on itself), since the ring also needs the
 * target's live measured rect, which this hook doesn't track (see
 * `SpotlightTarget`/`useSpotlightRef` for that).
 *
 * Still tells the provider "I'm mounted" so its poll/timeout/auto-skip logic
 * (owner-only steps, empty-state steps, etc.) keeps working.
 */
export function useTourHighlight(id: string | undefined | null): {
  isActive: boolean;
  highlightStyle: TourHighlightStyle | undefined;
} {
  const { state, reportTargetMounted, reportTargetUnmounted } = useMobileTour();

  useEffect(() => {
    if (!id) return;
    reportTargetMounted(id);
    return () => reportTargetUnmounted(id);
  }, [id, reportTargetMounted, reportTargetUnmounted]);

  const isActive = Boolean(id) && state.active && state.steps[state.index]?.id === id;
  const isOtherStep = Boolean(id) && state.active && !isActive && state.steps.some((step) => step.id === id);

  // Gentle dim only — a heavier cut (e.g. 0.32) visually compounds with
  // cards' own existing thin borders and reads as a hard dark outline.
  const highlightStyle: TourHighlightStyle | undefined = isOtherStep ? { opacity: 0.62 } : undefined;

  return { isActive, highlightStyle };
}

/** Registers a callback the tour can run right before it waits for a step's target on this screen. */
export function useTourAction(id: string, fn: () => void): void {
  const { registerAction } = useMobileTour();
  useEffect(() => registerAction(id, fn), [registerAction, id, fn]);
}

/**
 * Marks a `View` as one edge of the screen's fixed (non-scrolling) chrome —
 * attach to `AppFrame`'s header and tab-bar wrappers. Reports its live
 * measured bounds so `SpotlightTarget` can tell whether a step's target is
 * actually visible (not hidden behind the header/nav) without hardcoding
 * their heights, which drift with font scale, safe-area insets, and content
 * (e.g. a wrapping subtitle).
 */
export function useReportChrome(edge: "top" | "bottom"): { ref: RefObject<View | null>; onLayout: () => void } {
  const viewRef = useRef<View>(null);
  const { reportChromeRect, measureRelativeToRoot } = useMobileTour();
  const { width, height } = useWindowDimensions();

  const measure = useCallback(() => {
    const node = viewRef.current;
    if (!node) return;
    measureRelativeToRoot(node, (x, y, w, h) => {
      if (w > 0 && h > 0) reportChromeRect(edge, { x, y, width: w, height: h });
    });
  }, [edge, reportChromeRect, measureRelativeToRoot]);

  useEffect(() => {
    measure();
    return () => reportChromeRect(edge, null);
  }, [measure, reportChromeRect, edge, width, height]);

  return { ref: viewRef, onLayout: measure };
}

/**
 * Registers the currently-focused screen's main scrollable container so the
 * active tour step can be auto-scrolled into view. Attach the returned ref to
 * that screen's `ScrollView` (or anything exposing an RN-compatible
 * `scrollTo`). Only one screen is ever on-stage at a time, so the last
 * mounted registration wins; unmounting clears it.
 *
 * Also reports the scroll view's own live window bounds as `scrollViewport` —
 * by construction (flexbox, or a tab navigator that never renders a screen
 * behind its own tab bar) this is exactly the true visible scrollable area,
 * with no need to separately track or hardcode a header/tab-bar height.
 */
export function useTourScrollView<T extends { scrollTo: (opts: { x?: number; y?: number; animated?: boolean }) => void }>(): (
  node: T | null
) => void {
  const { registerScrollView, reportScrollViewport, measureRelativeToRoot } = useMobileTour();
  const holderRef = useRef<RefObject<T | null>>({ current: null });
  const unregisterRef = useRef<(() => void) | null>(null);

  const measure = useCallback(() => {
    const node = holderRef.current.current;
    if (!node) return;
    measureRelativeToRoot(node as unknown as View, (x, y, w, h) => {
      if (w > 0 && h > 0) reportScrollViewport({ x, y, width: w, height: h });
    });
  }, [reportScrollViewport, measureRelativeToRoot]);

  // Re-measure whenever the window size changes (rotation/resize) — the
  // scroll view rarely moves otherwise, so a continuous poll isn't needed.
  const { width, height } = useWindowDimensions();
  useEffect(() => {
    if (holderRef.current.current) measure();
  }, [measure, width, height]);

  // A callback ref (not a plain object ref) so mount/unmount — e.g. a screen
  // swapping its whole body between a scrolling section and a non-scrolling
  // one, like the athlete dashboard's chat panel — is caught immediately:
  // a plain ref changing value doesn't re-run effects, so a stale viewport
  // from the previous mode would otherwise linger until the next resize.
  return useCallback(
    (node: T | null) => {
      holderRef.current.current = node;
      unregisterRef.current?.();
      unregisterRef.current = null;
      if (node) {
        unregisterRef.current = registerScrollView(holderRef.current);
        requestAnimationFrame(measure);
      } else {
        reportScrollViewport(null);
      }
    },
    [registerScrollView, reportScrollViewport, measure]
  );
}

/**
 * Attach the returned ref to a single `View` mounted once near the root of
 * the app (see `_layout.tsx`) — an ancestor of both the actual screen
 * content (inside the router's navigator) and `TourOverlay` itself. Every
 * tour measurement is computed relative to this shared node via
 * `measureRelativeToRoot` instead of `measureInWindow`, so the overlay and
 * its targets are guaranteed to agree on where "the top of the screen" is,
 * regardless of any navigator-specific surface/window quirks.
 */
export function useTourRootView(): RefObject<View | null> {
  const ref = useRef<View>(null);
  const { registerRootView } = useMobileTour();
  useEffect(() => registerRootView(ref), [registerRootView]);
  return ref;
}

export function useAutoStartMobileTour(role: Role): void {
  const { status, user } = useAuth();
  const { startTour, state } = useMobileTour();
  const startedRef = useRef(false);

  useEffect(() => {
    if (status !== "authed" || !user?.id || user.role !== role || startedRef.current || state.active) return;
    startedRef.current = true;
    const key = seenKey(user.id, role);
    getStoredFlag(key)
      .then((seen) => {
        if (!seen || TOUR_ALWAYS_SHOW) startTour(role);
      })
      .catch(() => undefined);
  }, [role, startTour, state.active, status, user?.id, user?.role]);
}

export function MobileTourProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  const [state, setState] = useState<TourState>(INITIAL_STATE);
  const [prefs, setPrefs] = useState<TourPrefs>(DEFAULT_TOUR_PREFS);
  const mountedTargetsRef = useRef(new Set<string>());
  const actionsRef = useRef(new Map<string, () => void>());
  const noteCacheRef = useRef(new Map<string, string>());
  const runIdRef = useRef(0);
  const spokenStepRef = useRef<string | null>(null);
  const homeRectRef = useRef<TourRect | null>(null);
  const [chrome, setChrome] = useState<ChromeRects>({ top: null, bottom: null });
  const [scrollViewport, setScrollViewport] = useState<TourRect | null>(null);
  const scrollViewRefHolder = useRef<RefObject<{ scrollTo: (opts: { x?: number; y?: number; animated?: boolean }) => void } | null> | null>(
    null
  );
  const scrollAttemptsRef = useRef(new Map<string, number>());
  const rootViewRefHolder = useRef<RefObject<View | null> | null>(null);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    if (!user?.id) {
      setPrefs(DEFAULT_TOUR_PREFS);
      return;
    }
    let active = true;
    getStoredJson<TourPrefs>(tourPrefsKey(user.id))
      .then((stored) => {
        if (active) setPrefs(stored ?? DEFAULT_TOUR_PREFS);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [user?.id]);

  const updatePrefs = useCallback(
    (partial: Partial<TourPrefs>) => {
      setPrefs((prev) => {
        const next = { ...prev, ...partial };
        if (user?.id) void setStoredJson(tourPrefsKey(user.id), next);
        return next;
      });
    },
    [user]
  );

  const reportTargetMounted = useCallback((id: string) => {
    mountedTargetsRef.current.add(id);
  }, []);

  const reportTargetUnmounted = useCallback((id: string) => {
    mountedTargetsRef.current.delete(id);
  }, []);

  const reportTargetRect = useCallback((id: string, rect: TourRect) => {
    // `!prev.landing` matters: the just-finished step's own SpotlightTarget
    // keeps polling for a beat after `finish()` starts the landing flight
    // (its rect-tracking effect only stops once `state.index`/`active`
    // change), and would otherwise stomp the landing target back to the old
    // step's rect every ~250ms, fighting the tween to the header badge.
    setState((prev) => (prev.active && !prev.landing && prev.steps[prev.index]?.id === id ? { ...prev, activeRect: rect } : prev));
  }, []);

  const reportHomeRect = useCallback((rect: TourRect) => {
    homeRectRef.current = rect;
  }, []);

  const reportChromeRect = useCallback((edge: "top" | "bottom", rect: TourRect | null) => {
    setChrome((prev) => (rectsEqual(prev[edge], rect) ? prev : { ...prev, [edge]: rect }));
  }, []);

  const reportScrollViewport = useCallback((rect: TourRect | null) => {
    setScrollViewport((prev) => (rectsEqual(prev, rect) ? prev : rect));
  }, []);

  const registerScrollView = useCallback(
    (ref: RefObject<{ scrollTo: (opts: { x?: number; y?: number; animated?: boolean }) => void } | null>) => {
      scrollViewRefHolder.current = ref;
      return () => {
        if (scrollViewRefHolder.current === ref) scrollViewRefHolder.current = null;
      };
    },
    []
  );

  const registerRootView = useCallback((ref: RefObject<View | null>) => {
    rootViewRefHolder.current = ref;
    return () => {
      if (rootViewRefHolder.current === ref) rootViewRefHolder.current = null;
    };
  }, []);

  const measureRelativeToRoot = useCallback((node: View | null, onResult: (x: number, y: number, width: number, height: number) => void) => {
    const rootNode = rootViewRefHolder.current?.current;
    if (!rootNode || !node) return;
    (node as unknown as { measureLayout: (relativeTo: unknown, ok: (x: number, y: number, w: number, h: number) => void, fail?: () => void) => void }).measureLayout(
      rootNode,
      (x: number, y: number, w: number, h: number) => onResult(x, y, w, h),
      () => undefined
    );
  }, []);

  const requestScrollIntoView = useCallback((id: string, targetNode: View | null) => {
    const scrollView = scrollViewRefHolder.current?.current;
    if (!scrollView || !targetNode) return;

    const now = Date.now();
    const lastAttempt = scrollAttemptsRef.current.get(id) ?? 0;
    if (now - lastAttempt < SCROLL_INTO_VIEW_RETRY_MS) return;

    // Pass the scroll view's own ref value directly as the "relative to" node
    // — on the New Architecture, a host ref *is* the native element instance
    // `measureLayout` expects, and translating it through the legacy
    // `findNodeHandle` (a plain numeric tag) makes Fabric reject it.
    (targetNode as unknown as { measureLayout: (relativeTo: unknown, ok: (x: number, y: number) => void, fail?: () => void) => void }).measureLayout(
      scrollView,
      (_x: number, y: number) => {
        scrollAttemptsRef.current.set(id, Date.now());
        scrollView.scrollTo({ y: Math.max(0, y - SCROLL_INTO_VIEW_MARGIN), animated: true });
      },
      () => undefined
    );
  }, []);

  const registerAction = useCallback((id: string, fn: () => void) => {
    actionsRef.current.set(id, fn);
    return () => {
      if (actionsRef.current.get(id) === fn) actionsRef.current.delete(id);
    };
  }, []);

  const persistFinishFlags = useCallback(
    (role: Role, reason: "completed" | "skipped") => {
      if (!user?.id) return;
      const uid = user.id;
      setStoredFlag(seenKey(uid, role)).catch(() => undefined);
      const listKey = reason === "completed" ? tourCompletedKey(uid) : tourSkippedKey(uid);
      getStoredJson<string[]>(listKey)
        .then((list) => setStoredJson(listKey, Array.from(new Set([...(list ?? []), role]))))
        .catch(() => undefined);
    },
    [user]
  );

  const finish = useCallback(
    (reason: "completed" | "skipped" = "completed") => {
      void stopTourNarration();

      // A natural walk-through-to-the-end earns a send-off: Pex flies from
      // wherever it was to the header profile badge and settles there,
      // handing off to the persistent `PexHeaderBadge` sitting at that same
      // spot. Skipping out early doesn't get the flight or the celebration.
      const landingTarget = reason === "completed" ? homeRectRef.current : null;
      if (landingTarget) {
        setState((prev) => {
          if (prev.role) persistFinishFlags(prev.role, reason);
          return { ...prev, ready: false, note: null, noteLoading: false, audioSpeaking: false, landing: true, activeRect: landingTarget };
        });
        setTimeout(() => {
          setState(INITIAL_STATE);
          fireMascotReaction("tour.completed");
        }, LANDING_DURATION_MS);
        return;
      }

      setState((prev) => {
        if (prev.role) persistFinishFlags(prev.role, reason);
        return INITIAL_STATE;
      });
      if (reason === "completed") fireMascotReaction("tour.completed");
    },
    [persistFinishFlags]
  );

  const advanceToRef = useRef<(steps: MobileTourStep[], index: number, myRun: number) => void>(() => undefined);
  const advanceTo = useCallback(
    (steps: MobileTourStep[], index: number, myRun: number) => {
      if (index >= steps.length) {
        finish("completed");
        return;
      }
      const step = steps[index];
      const stepContext: MobileTourStepContext = { isAcademyOwner: user?.isAcademyOwner };
      if (step.skipIf && step.skipIf(stepContext)) {
        advanceToRef.current(steps, index + 1, myRun);
        return;
      }

      void stopTourNarration();
      spokenStepRef.current = null;
      setState((prev) => ({ ...prev, index, ready: false, note: null, noteLoading: false, audioSpeaking: false, activeRect: null }));

      const cameFromNav = Boolean(step.route) && pathnameRef.current !== step.route;
      if (cameFromNav && step.route) {
        router.push(step.route as never);
      }

      const deadline = Date.now() + (cameFromNav ? CROSS_SCREEN_TIMEOUT_MS : SAME_SCREEN_TIMEOUT_MS);
      let actionRan = false;

      const poll = () => {
        if (runIdRef.current !== myRun) return; // superseded by a newer step/skip/finish
        if (mountedTargetsRef.current.has(step.id) && (actionRan || !step.action)) {
          setState((prev) => (prev.index === index ? { ...prev, ready: true } : prev));
          return;
        }
        if (!actionRan && step.action) {
          actionsRef.current.get(step.action)?.();
          actionRan = true;
        }
        if (Date.now() > deadline) {
          advanceToRef.current(steps, index + 1, myRun);
          return;
        }
        setTimeout(poll, POLL_INTERVAL_MS);
      };
      poll();
    },
    [finish, user?.isAcademyOwner]
  );
  useEffect(() => {
    advanceToRef.current = advanceTo;
  }, [advanceTo]);

  const startTour = useCallback(
    (role: Role) => {
      const steps = MOBILE_TOUR_STEPS[role];
      const myRun = ++runIdRef.current;
      // Auto-start (and mini-tours) only ever fire from the role's own
      // dashboard, so this was always a same-screen no-op there — but
      // "Replay guided tour" in Settings can invoke this from elsewhere, and
      // step 0 has no `route` of its own to navigate by (it's a same-screen
      // step once you're on the dashboard).
      const dashPath = dashboardPathForRole(role);
      if (dashPath && pathnameRef.current !== dashPath) {
        router.push(dashPath as never);
      }
      setState({ ...INITIAL_STATE, active: true, role, steps });
      advanceTo(steps, 0, myRun);
    },
    [advanceTo]
  );

  const startMiniTour = useCallback(
    (steps: MobileTourStep[]) => {
      const myRun = ++runIdRef.current;
      setState((prev) => ({ ...INITIAL_STATE, active: true, role: prev.role, steps }));
      advanceTo(steps, 0, myRun);
    },
    [advanceTo]
  );

  const replayTour = useCallback(
    async (role: Role) => {
      if (user?.id) await removeStoredFlag(seenKey(user.id, role));
      startTour(role);
    },
    [user, startTour]
  );

  const next = useCallback(() => {
    const myRun = ++runIdRef.current;
    advanceTo(state.steps, state.index + 1, myRun);
  }, [advanceTo, state.steps, state.index]);

  const back = useCallback(() => {
    const myRun = ++runIdRef.current;
    advanceTo(state.steps, Math.max(0, state.index - 1), myRun);
  }, [advanceTo, state.steps, state.index]);

  const skip = useCallback(() => {
    runIdRef.current++;
    void stopTourNarration();
    finish("skipped");
  }, [finish]);

  const speakCurrentStep = useCallback(
    async (enableAudio: boolean, force = false) => {
      const step = state.steps[state.index];
      const message = [step?.title, state.note ?? step?.fallbackNote].filter(Boolean).join(". ");
      if (!force && step?.id && spokenStepRef.current === step.id) return;
      if (!message.trim()) return;
      if (step?.id) spokenStepRef.current = step.id;
      setState((prev) => ({ ...prev, audioEnabled: enableAudio || prev.audioEnabled, audioSpeaking: true }));
      await speakTourStep(message).finally(() => {
        setState((prev) => ({ ...prev, audioSpeaking: false }));
      });
    },
    [state.index, state.note, state.steps]
  );

  const playAudio = useCallback(() => {
    void speakCurrentStep(true);
  }, [speakCurrentStep]);

  const pauseAudio = useCallback(() => {
    void stopTourNarration();
    setState((prev) => ({ ...prev, audioEnabled: false, audioSpeaking: false }));
  }, []);

  const replayAudio = useCallback(() => {
    void speakCurrentStep(true, true);
  }, [speakCurrentStep]);

  // Fetch the AI-agent narration once the current step's target has confirmed
  // it's mounted; shows the fallback note instantly and swaps in the live
  // text on arrival.
  useEffect(() => {
    if (!state.active || !state.ready) return;
    const step = state.steps[state.index];
    if (!step) return;

    const cached = noteCacheRef.current.get(step.id);
    if (cached) {
      setState((prev) => (prev.index === state.index ? { ...prev, note: cached, noteLoading: false } : prev));
      return;
    }

    let cancelled = false;
    setState((prev) => (prev.index === state.index ? { ...prev, note: step.fallbackNote, noteLoading: true } : prev));
    apiJson<{ note?: string }>("/api/tour/narrate", {
      method: "POST",
      body: JSON.stringify({
        stepId: step.id,
        title: step.title,
        fallbackNote: step.fallbackNote,
        context: { surface: "mobile" },
      }),
    })
      .then((result) => {
        if (cancelled) return;
        const note = typeof result.note === "string" && result.note.trim() ? result.note.trim() : step.fallbackNote;
        noteCacheRef.current.set(step.id, note);
        setState((prev) => (prev.index === state.index ? { ...prev, note, noteLoading: false } : prev));
      })
      .catch(() => {
        if (!cancelled) {
          setState((prev) => (prev.index === state.index ? { ...prev, noteLoading: false } : prev));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [state.active, state.ready, state.index, state.steps]);

  useEffect(() => {
    if (!state.active || !state.ready || !state.audioEnabled || state.noteLoading) return;
    void speakCurrentStep(true);
  }, [speakCurrentStep, state.active, state.audioEnabled, state.index, state.noteLoading, state.ready]);

  useEffect(() => () => {
    void stopTourNarration();
  }, []);

  const value = useMemo(
    () => ({
      state,
      startTour,
      startMiniTour,
      replayTour,
      next,
      back,
      skip,
      reportTargetMounted,
      reportTargetUnmounted,
      reportTargetRect,
      reportHomeRect,
      chrome,
      reportChromeRect,
      scrollViewport,
      reportScrollViewport,
      registerScrollView,
      requestScrollIntoView,
      registerRootView,
      measureRelativeToRoot,
      registerAction,
      playAudio,
      pauseAudio,
      replayAudio,
      prefs,
      updatePrefs,
    }),
    [
      state,
      startTour,
      startMiniTour,
      replayTour,
      next,
      back,
      skip,
      reportTargetMounted,
      reportTargetUnmounted,
      reportTargetRect,
      reportHomeRect,
      chrome,
      reportChromeRect,
      scrollViewport,
      reportScrollViewport,
      registerScrollView,
      requestScrollIntoView,
      registerRootView,
      measureRelativeToRoot,
      registerAction,
      playAudio,
      pauseAudio,
      replayAudio,
      prefs,
      updatePrefs,
    ]
  );

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}
