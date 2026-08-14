import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/** OS-level "reduce motion" ORed with the user's own in-app animation toggle
 * (passed in by the caller). When true, mascot/bubble animations should snap
 * instead of tweening. No existing precedent in this app — first use. */
export function useOsReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => active && setReduced(value))
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (value) => {
      if (active) setReduced(value);
    });
    return () => {
      active = false;
      sub.remove();
    };
  }, []);

  return reduced;
}
