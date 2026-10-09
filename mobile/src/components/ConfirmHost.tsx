import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, Modal, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "./AppText";
import { colors, fonts, radius } from "../lib/theme";
import { setConfirmListener, type ConfirmOptions } from "../lib/confirm";
import { prefersReducedMotion } from "../lib/motion";
import { selectionFeedback } from "../lib/feedback";

type Active = ConfirmOptions & { resolve: (confirmed: boolean) => void; key: number };

/**
 * Bottom sheet for confirmAction() calls: dark scrim fades in, the sheet
 * slides up. Mounted once at the root; works on iOS, Android and web.
 */
export function ConfirmHost() {
  const insets = useSafeAreaInsets();
  const [active, setActive] = useState<Active | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress] = useState(() => new Animated.Value(0));
  const activeRef = useRef<Active | null>(null);

  useEffect(() => {
    setConfirmListener((request) => {
      // A second request while one is open cancels the first.
      activeRef.current?.resolve(false);
      const next = { ...request, key: Date.now() };
      activeRef.current = next;
      setBusy(false);
      setActive(next);
    });
    return () => setConfirmListener(null);
  }, []);

  useEffect(() => {
    if (!active) return;
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: prefersReducedMotion() ? 0 : 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [active, progress]);

  function close(confirmed: boolean) {
    const current = activeRef.current;
    if (!current) return;
    activeRef.current = null;
    Animated.timing(progress, {
      toValue: 0,
      duration: prefersReducedMotion() ? 0 : 180,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setActive((shown) => (shown?.key === current.key ? null : shown));
      setBusy(false);
    });
    current.resolve(confirmed);
  }

  async function onConfirm() {
    const current = activeRef.current;
    if (!current || busy) return;
    selectionFeedback();
    if (!current.onConfirm) {
      close(true);
      return;
    }
    setBusy(true);
    let ok = true;
    try {
      ok = (await current.onConfirm()) !== false;
    } catch {
      ok = false;
    }
    if (activeRef.current?.key !== current.key) return;
    if (ok) close(true);
    else setBusy(false);
  }

  if (!active) return null;

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [320, 0] });
  return (
    <Modal transparent visible animationType="none" onRequestClose={() => !busy && close(false)} statusBarTranslucent>
      <View style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, { opacity: progress }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => !busy && close(false)} accessibilityLabel="Close" />
        </Animated.View>
        <Animated.View
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 8, transform: [{ translateY }] }]}
          accessibilityViewIsModal
          accessibilityRole="alert"
        >
          <View style={styles.handle} />
          <Text style={styles.title}>{active.title}</Text>
          {active.body ? <Text style={styles.body}>{active.body}</Text> : null}
          <Pressable
            onPress={onConfirm}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={active.confirmLabel}
            accessibilityState={{ busy, disabled: busy }}
            style={({ pressed }) => [styles.button, active.destructive ? styles.danger : styles.primary, pressed ? styles.pressed : null]}
          >
            {busy ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text style={[styles.buttonText, { color: colors.onPrimary }]}>{active.confirmLabel}</Text>
            )}
          </Pressable>
          <Pressable
            onPress={() => close(false)}
            disabled={busy}
            accessibilityRole="button"
            style={({ pressed }) => [styles.button, styles.cancel, busy ? styles.dim : null, pressed ? styles.pressed : null]}
          >
            <Text style={[styles.buttonText, { color: colors.ink }]}>{active.cancelLabel ?? "Cancel"}</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  scrim: { backgroundColor: colors.overlay },
  sheet: {
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    backgroundColor: colors.surfaceRaised,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.line,
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 10,
  },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.lineStrong, marginBottom: 8 },
  title: { color: colors.ink, fontFamily: fonts.display, fontSize: 26, lineHeight: 30, textTransform: "uppercase" },
  body: { color: colors.inkMuted, fontSize: 15, lineHeight: 22, marginBottom: 8 },
  button: { minHeight: 52, borderRadius: radius.lg, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  primary: { backgroundColor: colors.primary },
  danger: { backgroundColor: colors.bad },
  cancel: { backgroundColor: colors.surfaceInset, borderWidth: 1, borderColor: colors.line },
  buttonText: { fontSize: 16, fontWeight: "800" },
  pressed: { opacity: 0.88, transform: [{ scale: 0.97 }] },
  dim: { opacity: 0.5 },
});
