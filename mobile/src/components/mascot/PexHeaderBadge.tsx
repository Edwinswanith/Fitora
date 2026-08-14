import { useCallback, useEffect, useRef } from "react";
import { View } from "react-native";
import { useMobileTour } from "../../lib/tour/MobileTourProvider";
import { useOsReducedMotion } from "../../lib/tour/useReducedMotion";
import { HOME_RECT_POLL_INTERVAL_MS } from "../../lib/tour/tourConfig";
import { PexMascot } from "./PexMascot";

/**
 * The persistent Pex badge shown in place of the plain profile-avatar icon in
 * every dashboard header. Doubles as the landing target for the guided
 * tour's post-completion flight (see `reportHomeRect` in the provider and
 * the `landing` phase in `TourOverlay`) — it continuously reports its own
 * position so that flight always lands exactly on top of it, making the
 * handoff from "tour mascot" to "header mascot" read as one continuous Pex.
 */
export function PexHeaderBadge({ size = 38 }: { size?: number }) {
  const { reportHomeRect, prefs, measureRelativeToRoot } = useMobileTour();
  const osReducedMotion = useOsReducedMotion();
  const reducedMotion = osReducedMotion || !prefs.mascotAnimationsEnabled;
  const ref = useRef<View>(null);

  const measure = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    measureRelativeToRoot(node, (x, y, width, height) => {
      if (width > 0 && height > 0) reportHomeRect({ x, y, width, height });
    });
  }, [reportHomeRect, measureRelativeToRoot]);

  useEffect(() => {
    measure();
    const interval = setInterval(measure, HOME_RECT_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [measure]);

  return (
    <View ref={ref} onLayout={measure} collapsable={false}>
      <PexMascot pose="neutral" state="waiting" tone="ready" size={size} reducedMotion={reducedMotion} />
    </View>
  );
}
