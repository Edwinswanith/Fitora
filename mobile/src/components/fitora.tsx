import { ReactNode, useEffect, useId, useMemo, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Image,
  ImageSourcePropType,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleProp,
  StyleSheet,
  TextStyle,
  View,
  ViewStyle,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Polyline, Stop } from "react-native-svg";
import { LinearGradient } from "expo-linear-gradient";
import { Text } from "./AppText";
import { Avatar } from "./Avatar";
import { apiJson } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ROLE_THEMES, colors, layout, metricColors, radius, type MetricKey } from "../lib/theme";

export type IconName = keyof typeof Ionicons.glyphMap;
export type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "energy";

const toneColor: Record<Tone, { text: string; bg: string; border: string }> = {
  neutral: { text: colors.inkMuted, bg: colors.surfaceInset, border: colors.line },
  primary: { text: colors.primary, bg: colors.primarySoft, border: "#d4f2ee" },
  success: { text: colors.ok, bg: colors.okSoft, border: "#bfe8c9" },
  warning: { text: colors.warn, bg: colors.warnSoft, border: "#fedb99" },
  danger: { text: colors.bad, bg: colors.badSoft, border: "#fecaca" },
  // Coral: streaks, achievements, celebrations. Never warnings.
  energy: { text: colors.energyInk, bg: colors.energySoft, border: "#f9cfc5" },
};

const sectionRadius = 10;
const sectionBorder = "#e8f5f3";

const VIDEO_THUMB_ASSETS: Record<string, ImageSourcePropType> = {
  squat: require("../../assets/fitora/video-squat.png"),
  bench: require("../../assets/fitora/video-bench.png"),
  mobility: require("../../assets/fitora/video-mobility.png"),
  nutrition: require("../../assets/fitora/video-nutrition.png"),
};

function fallbackVideoImage(title?: string | null, category?: string | null): ImageSourcePropType | null {
  const text = `${title ?? ""} ${category ?? ""}`.toLowerCase();
  if (text.includes("bench")) return VIDEO_THUMB_ASSETS.bench;
  if (text.includes("shoulder") || text.includes("mobility") || text.includes("recovery")) return VIDEO_THUMB_ASSETS.mobility;
  if (text.includes("nutrition") || text.includes("meal")) return VIDEO_THUMB_ASSETS.nutrition;
  if (text.includes("squat") || text.includes("exercise")) return VIDEO_THUMB_ASSETS.squat;
  return null;
}

export function ScreenContainer({
  children,
  refreshing,
  onRefresh,
  bottomNav,
  contentStyle,
  avoidTopSafeArea,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  bottomNav?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  avoidTopSafeArea?: boolean;
}) {
  return (
    <SafeAreaView style={styles.safe} edges={avoidTopSafeArea ? [] : ["top"]}>
      <View style={styles.shell}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.content, bottomNav ? styles.contentWithNav : null, contentStyle]}
          refreshControl={
            onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={colors.primary} /> : undefined
          }
        >
          {children}
        </ScrollView>
        {bottomNav}
      </View>
    </SafeAreaView>
  );
}

export function AppCard({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function PrimaryAppBar({
  title,
  subtitle,
  greeting,
  showNotifications = true,
  showAvatar = true,
  variant = "default",
  rightIcon,
  onRightPress,
  actionLabel,
  onAction,
}: {
  title: string;
  subtitle?: string;
  greeting?: string;
  showNotifications?: boolean;
  showAvatar?: boolean;
  variant?: "default" | "today";
  rightIcon?: IconName;
  onRightPress?: () => void;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const [unread, setUnread] = useState(0);
  const theme = ROLE_THEMES[(user?.role as keyof typeof ROLE_THEMES) ?? "athlete"] ?? ROLE_THEMES.athlete;

  useEffect(() => {
    let active = true;
    if (!showNotifications) return undefined;
    apiJson<{ unreadCount: number }>("/api/notifications/unread-count")
      .then((result) => {
        if (active) setUnread(result.unreadCount ?? 0);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [showNotifications]);

  const today = variant === "today";

  return (
    <View style={[styles.appBar, today ? styles.appBarToday : null]}>
      <View style={styles.appBarText}>
        {greeting ? <Text style={[styles.greeting, today ? styles.greetingToday : null]}>{greeting}</Text> : null}
        <Text style={[styles.appTitle, today ? styles.appTitleToday : null]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
          {title}
        </Text>
        {subtitle ? <Text style={[styles.appSubtitle, today ? styles.appSubtitleToday : null]} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      <View style={styles.appActions}>
        {actionLabel && onAction ? (
          <Pressable onPress={onAction} style={({ pressed }) => [styles.textAction, pressed ? styles.pressed : null]}>
            <Text style={styles.textActionLabel}>{actionLabel}</Text>
          </Pressable>
        ) : null}
        {rightIcon ? (
          <Pressable
            onPress={onRightPress}
            disabled={!onRightPress}
            style={({ pressed }) => [styles.iconButton, !onRightPress ? styles.iconButtonDisabled : null, pressed ? styles.pressed : null]}
          >
            <Ionicons name={rightIcon} size={21} color={colors.ink} />
          </Pressable>
        ) : null}
        {showNotifications ? (
          <Pressable
            onPress={() => router.push("/notifications" as never)}
            style={({ pressed }) => [styles.iconButton, today ? styles.iconButtonToday : null, pressed ? styles.pressed : null]}
            accessibilityLabel="Notifications"
          >
            <Ionicons name="notifications-outline" size={today ? 25 : 22} color={colors.ink} />
            {unread > 0 ? <View style={[styles.unreadDot, today ? styles.unreadDotToday : null]} /> : null}
          </Pressable>
        ) : null}
        {showAvatar ? (
          <Pressable
            onPress={() => router.push("/account" as never)}
            hitSlop={8}
            style={({ pressed }) => [styles.avatarButton, today ? styles.avatarButtonToday : null, pressed ? styles.pressed : null]}
            accessibilityLabel="Open profile"
          >
            <Avatar
              avatar={user?.avatar}
              name={user?.name ?? "Profile"}
              size={today ? 40 : 34}
              accentSoft={theme.accentSoft}
              accentStrong={theme.accentStrong}
            />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function BottomNavigation({
  items,
  active,
  onChange,
}: {
  items: { key: string; label: string; icon: IconName }[];
  active: string;
  onChange: (key: string) => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bottomNav, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      {items.map((item) => {
        const selected = item.key === active;
        return (
          <Pressable
            key={item.key}
            onPress={() => onChange(item.key)}
            style={({ pressed }) => [styles.bottomItem, pressed ? styles.pressed : null]}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
          >
            <Ionicons name={item.icon} size={26} color={selected ? colors.primary : colors.inkFaint} />
            <Text style={[styles.bottomLabel, selected ? styles.bottomLabelActive : null]} numberOfLines={1}>
              {item.label}
            </Text>
            <View style={[styles.bottomIndicator, selected ? styles.bottomIndicatorActive : null]} />
          </Pressable>
        );
      })}
    </View>
  );
}

export function SectionHeader({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action ? (
        <Pressable onPress={onAction} disabled={!onAction} hitSlop={8}>
          <Text style={[styles.sectionAction, !onAction ? styles.disabledText : null]}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function StatusChip({ label, tone = "neutral", icon }: { label: string; tone?: Tone; icon?: IconName }) {
  const toneStyle = toneColor[tone];
  return (
    <View style={[styles.chip, { backgroundColor: toneStyle.bg, borderColor: toneStyle.border }]}>
      {icon ? <Ionicons name={icon} size={12} color={toneStyle.text} /> : null}
      <Text style={[styles.chipText, { color: toneStyle.text }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export function ProgressBar({
  value,
  color = colors.progress,
  height = 6,
  style,
}: {
  value: number | null | undefined;
  color?: string;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const pct = Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : 0;
  return (
    <View style={[styles.progressTrack, { height, borderRadius: height / 2 }, style]}>
      <View style={[styles.progressFill, { width: `${pct * 100}%`, backgroundColor: color, borderRadius: height / 2 }]} />
    </View>
  );
}

export function ProgressRing({
  value,
  label,
  sublabel,
  size = 64,
  color = colors.progress,
}: {
  value: number | null | undefined;
  label: string;
  sublabel?: string;
  size?: number;
  color?: string;
}) {
  const stroke = 7;
  const radiusValue = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radiusValue;
  const pct = Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : 0;
  const offset = circumference - pct * circumference;

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={[StyleSheet.absoluteFill, styles.ringSvg]}>
        <Circle cx={size / 2} cy={size / 2} r={radiusValue} stroke="#e6f2f0" strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radiusValue}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={offset}
        />
      </Svg>
      <Text style={styles.ringLabel}>{label}</Text>
      {sublabel ? <Text style={styles.ringSub}>{sublabel}</Text> : null}
    </View>
  );
}

export function AlertBanner({
  tone = "warning",
  title,
  body,
  action,
  onPress,
}: {
  tone?: "warning" | "danger" | "primary";
  title: string;
  body?: string;
  action?: string;
  onPress?: () => void;
}) {
  const color = tone === "danger" ? colors.bad : tone === "primary" ? colors.primary : colors.warn;
  const bg = tone === "danger" ? colors.badSoft : tone === "primary" ? colors.primarySoft : colors.warnSoft;
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={[styles.alert, { borderColor: color + "55", backgroundColor: bg }]}>
      <View style={[styles.alertIcon, { backgroundColor: color + "14" }]}>
        <Ionicons name={tone === "primary" ? "information-circle-outline" : "warning-outline"} size={22} color={color} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.alertTitle, { color }]}>{title}</Text>
        {body ? <Text style={styles.alertBody}>{body}</Text> : null}
      </View>
      {action ? <Text style={[styles.alertAction, { color }]}>{action}</Text> : null}
    </Pressable>
  );
}

export function EmptyState({ title, body, icon = "sparkles-outline" }: { title: string; body?: string; icon?: IconName }) {
  return (
    <AppCard style={styles.stateCard}>
      <View style={styles.stateIcon}>
        <Ionicons name={icon} size={24} color={colors.primary} />
      </View>
      <Text style={styles.stateTitle}>{title}</Text>
      {body ? <Text style={styles.stateBody}>{body}</Text> : null}
    </AppCard>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <AppCard style={styles.stateCard}>
      <View style={[styles.stateIcon, { backgroundColor: colors.badSoft }]}>
        <Ionicons name="cloud-offline-outline" size={24} color={colors.bad} />
      </View>
      <Text style={styles.stateTitle}>Could not load this view</Text>
      <Text style={styles.stateBody}>{message}</Text>
      <Pressable onPress={onRetry} style={styles.retryButton}>
        <Text style={styles.retryText}>Retry</Text>
      </Pressable>
    </AppCard>
  );
}

/**
 * Full-screen loads show gray placeholder shapes in the layout's rough shape
 * (feels faster than a spinner and avoids a jump when content arrives).
 * `variant="inline"` keeps a spinner + label for an action in progress
 * ("Analyzing meal...") where a spinner is the honest signal.
 */
export function LoadingState({ label = "Loading Fitora...", variant = "skeleton" }: { label?: string; variant?: "skeleton" | "inline" }) {
  if (variant === "inline") {
    return (
      <View style={styles.loadingState}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.loadingText}>{label}</Text>
      </View>
    );
  }
  return <SkeletonScreen label={label} />;
}

function SkeletonScreen({ label }: { label: string }) {
  const [pulse] = useState(() => new Animated.Value(1));
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (cancelled || reduce) return;
        loop = Animated.loop(
          Animated.sequence([
            Animated.timing(pulse, { toValue: 0.45, duration: 750, useNativeDriver: true }),
            Animated.timing(pulse, { toValue: 1, duration: 750, useNativeDriver: true }),
          ])
        );
        loop.start();
      });
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [pulse]);

  return (
    <Animated.View
      style={[styles.skeleton, { opacity: pulse }]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
    >
      <View style={styles.skeletonHeader}>
        <View style={{ flex: 1, gap: 8 }}>
          <View style={[styles.skeletonLine, { width: "38%", height: 12 }]} />
          <View style={[styles.skeletonLine, { width: "62%", height: 22 }]} />
        </View>
        <View style={styles.skeletonAvatar} />
      </View>
      {[0, 1, 2].map((row) => (
        <View key={row} style={styles.skeletonCard}>
          <View style={styles.skeletonIcon} />
          <View style={{ flex: 1, gap: 8 }}>
            <View style={[styles.skeletonLine, { width: row === 1 ? "48%" : "58%" }]} />
            <View style={[styles.skeletonLine, { width: row === 2 ? "70%" : "84%", height: 10 }]} />
          </View>
        </View>
      ))}
      <View style={[styles.skeletonCard, { height: 132, alignItems: "flex-start" }]}>
        <View style={{ flex: 1, gap: 10 }}>
          <View style={[styles.skeletonLine, { width: "40%" }]} />
          <View style={[styles.skeletonLine, { width: "92%", height: 10 }]} />
          <View style={[styles.skeletonLine, { width: "76%", height: 10 }]} />
        </View>
      </View>
    </Animated.View>
  );
}

/**
 * The one thing to do now on a screen. Every main screen opens with exactly
 * one hero (filled teal, white text, one clear action); everything below it is
 * a quieter AppCard. Text on the hero is >= 6:1 on primaryStrong.
 */
export function HeroCard({
  eyebrow,
  title,
  body,
  icon,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
  children,
  calm = false,
}: {
  eyebrow?: string;
  title: string;
  body?: string;
  icon?: IconName;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  children?: ReactNode;
  /** A softer tinted hero for "all done" / informational states. */
  calm?: boolean;
}) {
  const content = (
    <>
      <View style={styles.heroTop}>
        {icon ? (
          <View style={[styles.heroIcon, calm ? styles.heroIconCalm : null]}>
            <Ionicons name={icon} size={24} color={calm ? colors.primary : "#ffffff"} />
          </View>
        ) : null}
        <View style={styles.heroCopy}>
          {eyebrow ? <Text style={[styles.heroEyebrow, calm ? styles.heroEyebrowCalm : null]}>{eyebrow.toUpperCase()}</Text> : null}
          <Text style={[styles.heroTitle, calm ? styles.heroTitleCalm : null]}>{title}</Text>
          {body ? <Text style={[styles.heroBody, calm ? styles.heroBodyCalm : null]}>{body}</Text> : null}
        </View>
      </View>
      {children}
      {actionLabel && onAction ? (
        <View style={styles.heroActions}>
          <Pressable
            onPress={onAction}
            style={({ pressed }) => [styles.heroButton, calm ? styles.heroButtonCalm : null, pressed ? styles.pressed : null]}
            accessibilityRole="button"
          >
            <Text style={[styles.heroButtonText, calm ? styles.heroButtonTextCalm : null]} numberOfLines={1}>{actionLabel}</Text>
          </Pressable>
          {secondaryLabel && onSecondary ? (
            <Pressable onPress={onSecondary} hitSlop={8} accessibilityRole="button" style={({ pressed }) => [styles.heroSecondary, pressed ? styles.pressed : null]}>
              <Text style={[styles.heroSecondaryText, calm ? styles.heroSecondaryTextCalm : null]} numberOfLines={1}>{secondaryLabel}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </>
  );
  if (calm) {
    return (
      <View style={[styles.hero, styles.heroCalm]} accessibilityRole="summary">
        {content}
      </View>
    );
  }
  return (
    <LinearGradient colors={["#0f766e", "#0b4f4a", "#0a3a37"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero} accessibilityRole="summary">
      {/* Soft coral glow in the corner (Fitora "Glow" style). */}
      <View pointerEvents="none" style={styles.heroGlowOuter} />
      <View pointerEvents="none" style={styles.heroGlowInner} />
      {content}
    </LinearGradient>
  );
}

/** Gradient progress ring in a metric's own color. `value` is 0..1. */
export function MetricRing({ metric, value, size = 56, stroke = 7, children }: { metric: MetricKey; value: number | null; size?: number; stroke?: number; children?: ReactNode }) {
  const id = useId().replace(/:/g, "");
  const palette = metricColors[metric];
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value ?? 0));
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}>
        <Defs>
          <SvgGradient id={`ring-${id}`} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={palette.from} />
            <Stop offset="1" stopColor={palette.to} />
          </SvgGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={palette.track} strokeWidth={stroke} fill="none" />
        {pct > 0 ? (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={`url(#ring-${id})`}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${c * pct} ${c}`}
          />
        ) : null}
      </Svg>
      {children}
    </View>
  );
}

/** One metric tile: ring, label, value. Use three in a MetricRow. */
export function MetricTileRing({
  metric,
  label,
  value,
  progress,
  sub,
  onPress,
}: {
  metric: MetricKey;
  label: string;
  value: string;
  progress: number | null;
  sub?: string;
  onPress?: () => void;
}) {
  const palette = metricColors[metric];
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={`${label}: ${value}${sub ? `, ${sub}` : ""}`}
      style={({ pressed }) => [styles.metricRingTile, pressed ? styles.pressed : null]}
    >
      <MetricRing metric={metric} value={progress} />
      <Text style={styles.metricRingLabel} numberOfLines={1}>{label}</Text>
      <Text style={[styles.metricRingValue, { color: progress != null && progress > 0 ? palette.ink : colors.ink }]} numberOfLines={1}>{value}</Text>
      {sub ? <Text style={styles.metricRingSub} numberOfLines={1}>{sub}</Text> : null}
    </Pressable>
  );
}

export function MetricRow({ children }: { children: ReactNode }) {
  return <View style={styles.metricRow}>{children}</View>;
}

/**
 * The single header for every inner (pushed) screen: round back button,
 * large left-aligned title, optional subtitle and one right action.
 */
export function BackHeader({
  title,
  subtitle,
  onBack,
  actionLabel,
  onAction,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const router = useRouter();
  const back = onBack ?? (() => (router.canGoBack() ? router.back() : router.replace("/" as never)));
  return (
    <View style={styles.backHeader}>
      <Pressable onPress={back} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back" style={({ pressed }) => [styles.backButton, pressed ? styles.pressed : null]}>
        <Ionicons name="chevron-back" size={22} color={colors.ink} />
      </Pressable>
      <View style={styles.backHeaderText}>
        <Text style={styles.backHeaderTitle} numberOfLines={1} accessibilityRole="header">{title}</Text>
        {subtitle ? <Text style={styles.backHeaderSubtitle} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} hitSlop={10} accessibilityRole="button">
          <Text style={styles.backHeaderAction}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Quiet label that groups the cards under it ("TODAY", "AT A GLANCE"). */
export function SectionLabel({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.sectionLabelRow}>
      <Text style={styles.sectionLabel} accessibilityRole="header">{title.toUpperCase()}</Text>
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text style={styles.sectionLabelAction}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Shown above content when saved data is displayed but the refresh failed. */
export function StaleDataNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <Pressable onPress={onRetry} style={({ pressed }) => [styles.staleNotice, pressed ? styles.pressed : null]} accessibilityRole="button">
      <Ionicons name="cloud-offline-outline" size={16} color={colors.inkMuted} />
      <Text style={styles.staleText}>Showing saved data. Tap to refresh.</Text>
    </Pressable>
  );
}

export function IconTile({ icon, tone = "primary", size = 34 }: { icon: IconName; tone?: Tone; size?: number }) {
  const palette = toneColor[tone];
  return (
    <View style={[styles.iconTile, { width: size, height: size, borderRadius: Math.min(14, size / 3), backgroundColor: palette.bg }]}>
      <Ionicons name={icon} size={Math.round(size * 0.48)} color={palette.text} />
    </View>
  );
}

export function RowLink({
  icon,
  title,
  subtitle,
  value,
  chip,
  onPress,
  tone = "primary",
  progress,
  right,
}: {
  icon?: IconName;
  title: string;
  subtitle?: string;
  value?: string;
  chip?: ReactNode;
  onPress?: () => void;
  tone?: Tone;
  progress?: number | null;
  right?: ReactNode;
}) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.rowLink, pressed ? styles.pressed : null]}>
      {icon ? <IconTile icon={icon} tone={tone} /> : null}
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={styles.rowSubtitle} numberOfLines={1}>{subtitle}</Text> : null}
        {progress != null ? <ProgressBar value={progress} style={{ marginTop: 9 }} color={toneColor[tone].text} /> : null}
      </View>
      <View style={styles.rowRight}>
        {value ? <Text style={styles.rowValue} numberOfLines={1}>{value}</Text> : null}
        {chip}
        {right}
        {onPress ? <Ionicons name="chevron-forward" size={21} color={colors.ink} /> : null}
      </View>
    </Pressable>
  );
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; icon?: IconName }[];
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [styles.segment, active ? styles.segmentActive : null, pressed ? styles.pressed : null]}
          >
            {option.icon ? <Ionicons name={option.icon} size={15} color={active ? colors.primary : colors.inkMuted} /> : null}
            <Text style={[styles.segmentText, active ? styles.segmentTextActive : null]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ActionButton({
  label,
  icon,
  onPress,
  variant = "outline",
  style,
  textStyle,
  disabled,
}: {
  label: string;
  icon?: IconName;
  onPress?: () => void;
  variant?: "filled" | "outline";
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  disabled?: boolean;
}) {
  const filled = variant === "filled";
  const isDisabled = disabled || !onPress;
  const iconColor = isDisabled ? colors.inkFaint : filled ? "#fff" : colors.primary;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.actionButton,
        filled ? styles.actionButtonFilled : null,
        isDisabled ? styles.actionButtonDisabled : null,
        style,
        pressed ? styles.pressed : null,
      ]}
    >
      {icon ? <Ionicons name={icon} size={18} color={iconColor} /> : null}
      <Text style={[styles.actionButtonText, filled ? styles.actionButtonTextFilled : null, textStyle, isDisabled ? styles.disabledText : null]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export function MetricTile({
  icon,
  value,
  label,
  tone = "primary",
}: {
  icon: IconName;
  value: string;
  label: string;
  tone?: Tone;
}) {
  return (
    <View style={styles.metricTile}>
      <IconTile icon={icon} tone={tone} size={42} />
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel} numberOfLines={2}>{label}</Text>
    </View>
  );
}

export function VideoThumb({
  duration,
  compact,
  mini,
  title,
  category,
  imageSource,
}: {
  duration?: string | null;
  compact?: boolean;
  mini?: boolean;
  title?: string | null;
  category?: string | null;
  imageSource?: ImageSourcePropType | null;
}) {
  const resolvedImage = imageSource ?? fallbackVideoImage(title, category);
  return (
    <View style={[styles.videoThumb, compact ? styles.videoThumbCompact : null, mini ? styles.videoThumbMini : null]}>
      {resolvedImage ? (
        <Image source={resolvedImage} style={styles.videoImage} resizeMode="stretch" />
      ) : (
        <Ionicons name="play-circle" size={mini ? 30 : compact ? 34 : 46} color="#fff" />
      )}
      {!resolvedImage && duration ? (
        <View style={styles.durationBadge}>
          <Text style={styles.durationText}>{duration}</Text>
        </View>
      ) : null}
    </View>
  );
}

export function MiniLineChart({
  values,
  color = colors.progress,
  height = 92,
}: {
  values: (number | null | undefined)[];
  color?: string;
  height?: number;
}) {
  const points = useMemo(() => values.filter((v): v is number => Number.isFinite(Number(v))), [values]);
  if (points.length < 2) {
    return (
      <View style={[styles.emptyChart, { height }]}>
        <Text style={styles.emptyChartText}>More data needed</Text>
      </View>
    );
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = Math.max(1, max - min);
  const normalized = values.map((raw, index) => {
    if (!Number.isFinite(Number(raw))) return null;
    const x = 12 + (index / Math.max(1, values.length - 1)) * 156;
    const y = 78 - ((Number(raw) - min) / span) * 54;
    return `${x},${y}`;
  }).filter(Boolean) as string[];
  return (
    <Svg width="100%" height={height} viewBox="0 0 180 92">
      <Polyline points="12,78 168,78" stroke={colors.lineStrong} strokeWidth="1" fill="none" />
      <Polyline points={normalized.join(" ")} stroke={color} strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {normalized.map((point) => {
        const [cx, cy] = point.split(",").map(Number);
        return <Circle key={point} cx={cx} cy={cy} r="4" fill={color} />;
      })}
    </Svg>
  );
}

export function MiniBarChart({
  values,
  color = colors.progress,
  labels,
}: {
  values: (number | null | undefined)[];
  color?: string;
  labels?: string[];
}) {
  const max = Math.max(1, ...values.map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0)));
  return (
    <View style={styles.barChart}>
      {values.map((value, index) => {
        const height = Number.isFinite(Number(value)) ? Math.max(6, (Number(value) / max) * 82) : 6;
        return (
          <View key={`${index}-${value}`} style={styles.barSlot}>
            <View style={styles.barTrack}>
              <RectBar height={height} color={color} />
            </View>
            {labels?.[index] ? <Text style={styles.barLabel}>{labels[index]}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

function RectBar({ height, color }: { height: number; color: string }) {
  return <View style={[styles.bar, { height, backgroundColor: color }]} />;
}

export function SettingsRow({
  icon,
  label,
  value,
  danger,
  onPress,
}: {
  icon: IconName;
  label: string;
  value?: string;
  danger?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.settingsRow, pressed ? styles.pressed : null]}>
      <Ionicons name={icon} size={20} color={danger ? colors.bad : colors.ink} />
      <Text style={[styles.settingsLabel, danger ? { color: colors.bad } : null]}>{label}</Text>
      {value ? <Text style={styles.settingsValue} numberOfLines={1}>{value}</Text> : null}
      {onPress ? <Ionicons name="chevron-forward" size={20} color={colors.ink} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  shell: { flex: 1 },
  // 150 clears the floating Ask Agent FAB (56dp circle anchored at bottom:84,
  // so its top edge sits at 140dp) — without this, a screen with no bottom
  // nav bar can scroll its last control permanently behind the FAB with no
  // way to reveal it.
  content: { paddingHorizontal: layout.gutter, paddingTop: 4, paddingBottom: 150, gap: layout.sectionGap },
  contentWithNav: { paddingBottom: 98 },
  card: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: "#e1ece9",
    borderRadius: layout.cardRadius,
    padding: layout.cardPadding,
    gap: 10,
    shadowColor: "#0b3f3b",
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  appBar: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  appBarToday: { minHeight: 60, alignItems: "flex-start", paddingTop: 0, marginBottom: 2 },
  appBarText: { flex: 1, minWidth: 0 },
  greeting: { fontSize: 12, lineHeight: 16, color: colors.inkMuted, marginBottom: 1 },
  greetingToday: { fontSize: 14, lineHeight: 18, color: "#53647e", marginBottom: 1 },
  appTitle: { fontSize: 18, lineHeight: 23, color: colors.ink, fontWeight: "900", letterSpacing: 0 },
  appTitleToday: { fontSize: 24, lineHeight: 30, color: "#0a1614", fontWeight: "900" },
  appSubtitle: { fontSize: 12, lineHeight: 16, color: colors.inkMuted, marginTop: 1 },
  appSubtitleToday: { fontSize: 14, lineHeight: 18 },
  appActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  iconButton: { height: 32, width: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  iconButtonToday: { height: 40, width: 40, borderRadius: 20, marginTop: 4 },
  iconButtonDisabled: { opacity: 0.55 },
  avatarButton: { height: 34, width: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  avatarButtonToday: { height: 40, width: 40, borderRadius: 20, marginTop: 4 },
  unreadDot: { position: "absolute", right: 6, top: 4, height: 9, width: 9, borderRadius: 5, backgroundColor: colors.primary },
  unreadDotToday: { right: 7, top: 5, backgroundColor: colors.bad },
  textAction: { minHeight: 36, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  textActionLabel: { color: colors.primary, fontSize: 15, fontWeight: "800" },
  bottomNav: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: 82,
    paddingTop: 8,
    paddingHorizontal: 6,
    flexDirection: "row",
    backgroundColor: colors.surfaceRaised,
    borderTopWidth: 1,
    borderTopColor: sectionBorder,
    shadowColor: "#10201e",
    shadowOpacity: 0.035,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: -2 },
    elevation: 2,
  },
  bottomItem: { flex: 1, alignItems: "center", justifyContent: "flex-start", gap: 4 },
  bottomLabel: { fontSize: 12, lineHeight: 16, color: colors.inkMuted, fontWeight: "600" },
  bottomLabelActive: { color: colors.primary, fontWeight: "800" },
  bottomIndicator: { height: 4, width: 34, borderRadius: 2, backgroundColor: "transparent", marginBottom: 1 },
  bottomIndicatorActive: { backgroundColor: colors.primary },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 2 },
  sectionTitle: { color: colors.ink, fontSize: 16, fontWeight: "800", lineHeight: 22 },
  sectionAction: { color: colors.primary, fontSize: 12, fontWeight: "800" },
  chip: {
    minHeight: 21,
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
  },
  chipText: { fontSize: 12, lineHeight: 16, fontWeight: "800" },
  progressTrack: { width: "100%", backgroundColor: "#e6f2f0", overflow: "hidden" },
  progressFill: { height: "100%" },
  ringSvg: { transform: [{ rotate: "-90deg" }] },
  ringLabel: { fontSize: 20, lineHeight: 23, color: colors.ink, fontWeight: "900" },
  ringSub: { marginTop: 1, color: colors.inkMuted, fontSize: 12, fontWeight: "700" },
  alert: {
    borderWidth: 1,
    borderRadius: sectionRadius,
    padding: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  alertIcon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  alertTitle: { fontSize: 13, lineHeight: 17, fontWeight: "900" },
  alertBody: { marginTop: 1, fontSize: 12, lineHeight: 16, color: colors.ink },
  alertAction: { fontSize: 12, fontWeight: "900" },
  stateCard: { alignItems: "center", gap: 8, paddingVertical: 24 },
  stateIcon: { height: 48, width: 48, borderRadius: 15, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  stateTitle: { color: colors.ink, fontSize: 17, fontWeight: "900", textAlign: "center" },
  stateBody: { color: colors.inkMuted, fontSize: 14, lineHeight: 20, textAlign: "center" },
  retryButton: { marginTop: 8, minHeight: 42, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.primary, paddingHorizontal: 18, alignItems: "center", justifyContent: "center" },
  retryText: { color: colors.primary, fontSize: 15, fontWeight: "800" },
  loadingState: { flex: 1, minHeight: 420, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { color: colors.inkMuted, fontSize: 14, fontWeight: "700" },
  hero: {
    borderRadius: 20,
    padding: 18,
    gap: 14,
    overflow: "hidden",
    backgroundColor: colors.primaryStrong,
    shadowColor: colors.primaryStrong,
    shadowOpacity: 0.22,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  heroGlowOuter: { position: "absolute", width: 220, height: 220, borderRadius: 110, right: -90, top: -110, backgroundColor: colors.energy, opacity: 0.16 },
  heroGlowInner: { position: "absolute", width: 120, height: 120, borderRadius: 60, right: -40, top: -60, backgroundColor: colors.energy, opacity: 0.18 },
  metricRow: { flexDirection: "row", gap: 10 },
  metricRingTile: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    gap: 4,
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderRadius: layout.cardRadius,
    borderWidth: 1,
    borderColor: "#e1ece9",
    backgroundColor: colors.surfaceRaised,
    shadowColor: "#0b3f3b",
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  metricRingLabel: { color: colors.inkFaint, fontSize: 12, fontWeight: "700", marginTop: 4 },
  metricRingValue: { fontSize: 16, fontWeight: "900" },
  metricRingSub: { color: colors.inkFaint, fontSize: 12, fontWeight: "600" },
  backHeader: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingTop: 4 },
  backButton: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: "#e1ece9" },
  backHeaderText: { flex: 1, minWidth: 0 },
  backHeaderTitle: { color: colors.ink, fontSize: 22, lineHeight: 28, fontWeight: "900" },
  backHeaderSubtitle: { color: colors.inkMuted, fontSize: 13, lineHeight: 18, marginTop: 1 },
  backHeaderAction: { color: colors.primary, fontSize: 15, fontWeight: "800" },
  heroCalm: { backgroundColor: colors.primarySoft, shadowOpacity: 0, elevation: 0, borderWidth: 1, borderColor: "#c4e8e1" },
  heroTop: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  heroIcon: { width: 46, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.14)" },
  heroIconCalm: { backgroundColor: colors.surfaceRaised },
  heroCopy: { flex: 1, minWidth: 0, gap: 3 },
  heroEyebrow: { color: "#c9efe8", fontSize: 12, fontWeight: "800", letterSpacing: 0.8 },
  heroEyebrowCalm: { color: colors.primary },
  heroTitle: { color: "#ffffff", fontSize: 22, lineHeight: 27, fontWeight: "900" },
  heroTitleCalm: { color: colors.ink },
  heroBody: { color: "#e6f7f4", fontSize: 14, lineHeight: 20, fontWeight: "500" },
  heroBodyCalm: { color: colors.inkMuted },
  heroActions: { flexDirection: "row", alignItems: "center", gap: 14, flexWrap: "wrap" },
  heroButton: { flexGrow: 1, minHeight: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", paddingHorizontal: 18, backgroundColor: "#ffffff" },
  heroButtonCalm: { backgroundColor: colors.primary },
  heroButtonText: { color: colors.primaryStrong, fontSize: 16, fontWeight: "900" },
  heroButtonTextCalm: { color: "#ffffff" },
  heroSecondary: { minHeight: 48, justifyContent: "center", paddingHorizontal: 4 },
  heroSecondaryText: { color: "#e6f7f4", fontSize: 14, fontWeight: "800" },
  heroSecondaryTextCalm: { color: colors.primary },
  sectionLabelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10, marginBottom: -2, paddingHorizontal: 2 },
  sectionLabel: { color: colors.inkFaint, fontSize: 12, fontWeight: "800", letterSpacing: 1 },
  sectionLabelAction: { color: colors.primary, fontSize: 13, fontWeight: "800" },
  staleNotice: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.md, backgroundColor: colors.surfaceInset },
  staleText: { color: colors.inkMuted, fontSize: 13, fontWeight: "700" },
  skeleton: { gap: 10, paddingTop: 6 },
  skeletonHeader: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6, marginBottom: 4 },
  skeletonAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.line },
  skeletonCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surfaceRaised,
  },
  skeletonIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.surfaceInset },
  skeletonLine: { height: 14, borderRadius: 7, backgroundColor: colors.surfaceInset },
  iconTile: { alignItems: "center", justifyContent: "center" },
  rowLink: { minHeight: 38, flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 2 },
  rowMain: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 12, color: colors.ink, fontWeight: "900", lineHeight: 16 },
  rowSubtitle: { marginTop: 1, color: colors.inkMuted, fontSize: 12, lineHeight: 16 },
  rowRight: { flexDirection: "row", alignItems: "center", gap: 6, maxWidth: "48%" },
  rowValue: { color: colors.ink, fontSize: 12, fontWeight: "800" },
  segmented: { minHeight: 38, flexDirection: "row", padding: 3, borderRadius: sectionRadius, borderWidth: 1, borderColor: sectionBorder, backgroundColor: "#fdfffe" },
  segment: { flex: 1, borderRadius: 8, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 7 },
  segmentActive: { backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.primary },
  segmentText: { color: colors.ink, fontSize: 12, fontWeight: "700" },
  segmentTextActive: { color: colors.primary, fontWeight: "900" },
  actionButton: {
    minHeight: 34,
    flex: 1,
    borderRadius: sectionRadius,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 9,
  },
  actionButtonFilled: { backgroundColor: colors.primary, borderColor: colors.primary },
  actionButtonDisabled: { borderColor: colors.lineStrong, backgroundColor: colors.surfaceInset },
  actionButtonText: { color: colors.primary, fontSize: 12, lineHeight: 16, fontWeight: "900" },
  actionButtonTextFilled: { color: "#fff" },
  disabledText: { color: colors.inkFaint },
  metricTile: { flex: 1, alignItems: "center", gap: 5, paddingHorizontal: 3 },
  metricValue: { color: colors.ink, fontSize: 16, lineHeight: 20, fontWeight: "900" },
  metricLabel: { color: colors.inkMuted, fontSize: 12, lineHeight: 16, textAlign: "center" },
  videoThumb: {
    height: 106,
    borderRadius: sectionRadius,
    overflow: "hidden",
    backgroundColor: "#1b2e2b",
    alignItems: "center",
    justifyContent: "center",
  },
  videoThumbCompact: { width: 118, height: 72 },
  videoThumbMini: { width: 98, height: 60 },
  videoImage: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, width: "100%", height: "100%" },
  durationBadge: { position: "absolute", right: 8, bottom: 8, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3, backgroundColor: "rgba(15,23,42,0.82)" },
  durationText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  emptyChart: { alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceInset, borderRadius: sectionRadius },
  emptyChartText: { color: colors.inkMuted, fontSize: 13, fontWeight: "700" },
  barChart: { height: 118, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 8 },
  barSlot: { flex: 1, alignItems: "center", justifyContent: "flex-end", gap: 6 },
  barTrack: { height: 88, width: "100%", justifyContent: "flex-end", alignItems: "center" },
  bar: { width: 18, borderRadius: 9 },
  barLabel: { color: colors.inkMuted, fontSize: 12, fontWeight: "700" },
  settingsRow: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: colors.line },
  settingsLabel: { flex: 1, color: colors.ink, fontSize: 13, fontWeight: "700" },
  settingsValue: { maxWidth: 150, color: colors.inkMuted, fontSize: 12 },
  pressed: { opacity: 0.72 },
});
