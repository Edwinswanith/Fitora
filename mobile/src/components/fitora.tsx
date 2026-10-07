import { ReactNode, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
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
import Svg, { Circle, Polyline } from "react-native-svg";
import { Text } from "./AppText";
import { Avatar } from "./Avatar";
import { apiJson } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ROLE_THEMES, colors, radius } from "../lib/theme";

export type IconName = keyof typeof Ionicons.glyphMap;
export type Tone = "neutral" | "primary" | "success" | "warning" | "danger";

const toneColor: Record<Tone, { text: string; bg: string; border: string }> = {
  neutral: { text: colors.inkMuted, bg: colors.surfaceInset, border: colors.line },
  primary: { text: colors.primary, bg: colors.primarySoft, border: "#c7d7ff" },
  success: { text: colors.ok, bg: colors.okSoft, border: "#bfe8c9" },
  warning: { text: colors.warn, bg: colors.warnSoft, border: "#fedb99" },
  danger: { text: colors.bad, bg: colors.badSoft, border: "#fecaca" },
};

const sectionRadius = 10;
const sectionBorder = "#e8edf5";

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
  color = colors.primary,
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
  color = colors.primary,
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
        <Circle cx={size / 2} cy={size / 2} r={radiusValue} stroke="#e6eaf2" strokeWidth={stroke} fill="none" />
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

export function LoadingState({ label = "Loading Fitora..." }: { label?: string }) {
  return (
    <View style={styles.loadingState}>
      <ActivityIndicator color={colors.primary} />
      <Text style={styles.loadingText}>{label}</Text>
    </View>
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
  color = colors.primary,
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
  color = colors.primary,
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
  content: { paddingHorizontal: 15, paddingTop: 1, paddingBottom: 150, gap: 7 },
  contentWithNav: { paddingBottom: 98 },
  card: {
    backgroundColor: "#fdfeff",
    borderWidth: 1,
    borderColor: sectionBorder,
    borderRadius: sectionRadius,
    padding: 8,
    shadowColor: "#0f172a",
    shadowOpacity: 0.014,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  appBar: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  appBarToday: { minHeight: 60, alignItems: "flex-start", paddingTop: 0, marginBottom: 2 },
  appBarText: { flex: 1, minWidth: 0 },
  greeting: { fontSize: 12, lineHeight: 16, color: colors.inkMuted, marginBottom: 1 },
  greetingToday: { fontSize: 14, lineHeight: 18, color: "#53647e", marginBottom: 1 },
  appTitle: { fontSize: 18, lineHeight: 23, color: colors.ink, fontWeight: "900", letterSpacing: 0 },
  appTitleToday: { fontSize: 24, lineHeight: 30, color: "#060b21", fontWeight: "900" },
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
    shadowColor: "#0f172a",
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
  sectionTitle: { color: colors.ink, fontSize: 15, fontWeight: "900", lineHeight: 20 },
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
  chipText: { fontSize: 10, lineHeight: 13, fontWeight: "800" },
  progressTrack: { width: "100%", backgroundColor: "#e6eaf2", overflow: "hidden" },
  progressFill: { height: "100%" },
  ringSvg: { transform: [{ rotate: "-90deg" }] },
  ringLabel: { fontSize: 20, lineHeight: 23, color: colors.ink, fontWeight: "900" },
  ringSub: { marginTop: 1, color: colors.inkMuted, fontSize: 11, fontWeight: "700" },
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
  iconTile: { alignItems: "center", justifyContent: "center" },
  rowLink: { minHeight: 38, flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 2 },
  rowMain: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 12, color: colors.ink, fontWeight: "900", lineHeight: 16 },
  rowSubtitle: { marginTop: 1, color: colors.inkMuted, fontSize: 10, lineHeight: 14 },
  rowRight: { flexDirection: "row", alignItems: "center", gap: 6, maxWidth: "48%" },
  rowValue: { color: colors.ink, fontSize: 11, fontWeight: "800" },
  segmented: { minHeight: 38, flexDirection: "row", padding: 3, borderRadius: sectionRadius, borderWidth: 1, borderColor: sectionBorder, backgroundColor: "#fdfeff" },
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
  actionButtonText: { color: colors.primary, fontSize: 11, lineHeight: 15, fontWeight: "900" },
  actionButtonTextFilled: { color: "#fff" },
  disabledText: { color: colors.inkFaint },
  metricTile: { flex: 1, alignItems: "center", gap: 5, paddingHorizontal: 3 },
  metricValue: { color: colors.ink, fontSize: 16, lineHeight: 20, fontWeight: "900" },
  metricLabel: { color: colors.inkMuted, fontSize: 10, lineHeight: 14, textAlign: "center" },
  videoThumb: {
    height: 106,
    borderRadius: sectionRadius,
    overflow: "hidden",
    backgroundColor: "#1e293b",
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
  barLabel: { color: colors.inkMuted, fontSize: 11, fontWeight: "700" },
  settingsRow: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: colors.line },
  settingsLabel: { flex: 1, color: colors.ink, fontSize: 13, fontWeight: "700" },
  settingsValue: { maxWidth: 150, color: colors.inkMuted, fontSize: 12 },
  pressed: { opacity: 0.72 },
});
