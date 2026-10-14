import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "../../components/AppText";
import { DateField } from "../../components/DateTimeField";
import { ActionButton, AppCard, BackHeader, CountUpText, FadeIn, FormField, MetricRing, ProgressBar, ScreenContainer } from "../../components/fitora";
import { apiFetch, apiJson } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { todayLocalDate, yearsAgoLocalDate } from "../../lib/dateTimeValues";
import { celebrate, errorFeedback, selectionFeedback } from "../../lib/feedback";
import type { AthleteProfile, NutritionTarget } from "../../lib/fitoraData";
import { MIN_AGE, bodyBasicsError, markOnboardingSeen } from "../../lib/onboarding";
import { SPORT_OPTIONS, sportLabel } from "../../lib/sport";
import { colors, fonts, metricColors, radius } from "../../lib/theme";

// One-time setup right after sign-up: goal, body basics, activity, allergies,
// then the calorie target those answers produce. Every step saves on its own
// and can be skipped; whatever is skipped comes back on the Day 1 card.

type Step = "goal" | "body" | "activity" | "allergies" | "target";
const QUESTION_STEPS: Step[] = ["goal", "body", "activity", "allergies"];

const GOALS = [
  { value: "lose_weight", title: "Lose weight", sub: "Burn fat, keep strength", icon: "trending-down" },
  { value: "maintain_weight", title: "Stay where I am", sub: "Eat to fuel your training", icon: "remove" },
  { value: "gain_weight", title: "Gain weight", sub: "Build muscle and size", icon: "trending-up" },
] as const;

const PACES = [
  { value: "mild", label: "Steady" },
  { value: "moderate", label: "Moderate" },
  { value: "aggressive", label: "Fast" },
] as const;

const ACTIVITY = [
  { value: "sedentary", title: "Mostly sitting", sub: "Desk job, little exercise" },
  { value: "light", title: "Light", sub: "Train 1 to 2 days a week" },
  { value: "moderate", title: "Moderate", sub: "Train 3 to 5 days a week" },
  { value: "active", title: "Active", sub: "Train 6 to 7 days a week" },
  { value: "very_active", title: "Very active", sub: "Twice a day, or a physical job" },
] as const;

const ALLERGENS = ["Peanuts", "Tree nuts", "Milk", "Eggs", "Gluten", "Soy", "Fish", "Shellfish", "Sesame"] as const;
const OTHER = "Other";
const DOB_MIN_DATE = "1920-01-01";
const SAVE_ERROR = "Couldn't save that. Check your connection and try again.";

function splitList(text: string): string[] {
  return text.split(",").map((item) => item.trim()).filter(Boolean);
}

export default function AthleteOnboarding() {
  const router = useRouter();
  const { user } = useAuth();
  const [step, setStep] = useState<Step>("goal");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [goal, setGoal] = useState("");
  const [pace, setPace] = useState("moderate");
  const [weightKg, setWeightKg] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [dob, setDob] = useState("");
  const [sex, setSex] = useState("");
  const [activity, setActivity] = useState("");
  const [hasAllergies, setHasAllergies] = useState<boolean | null>(null);
  const [allergies, setAllergies] = useState<string[]>([]);
  const [otherAllergies, setOtherAllergies] = useState("");
  const [sport, setSport] = useState("");
  const [otherSport, setOtherSport] = useState("");
  const [dobBounds] = useState(() => ({ today: todayLocalDate(), latest: yearsAgoLocalDate(MIN_AGE), defaultDate: yearsAgoLocalDate(25) }));

  // Opening the flow counts as seeing it, so leaving half way never loops back here.
  useEffect(() => {
    if (user?.id) void markOnboardingSeen(user.id);
  }, [user?.id]);

  // Fill in anything already saved (e.g. coming back from the Day 1 card).
  useEffect(() => {
    let active = true;
    apiJson<{ athlete: AthleteProfile }>("/api/athlete/me")
      .then(({ athlete }) => {
        if (!active || !athlete) return;
        if (athlete.fitnessGoal) setGoal(athlete.fitnessGoal);
        if (athlete.goalIntensity) setPace(athlete.goalIntensity);
        if (athlete.weightKg) setWeightKg(String(athlete.weightKg));
        if (athlete.heightCm) setHeightCm(String(athlete.heightCm));
        if (athlete.dob) setDob(athlete.dob.slice(0, 10));
        if (athlete.biologicalSex) setSex(athlete.biologicalSex);
        if (athlete.activityLevel) setActivity(athlete.activityLevel);
        if (athlete.allergies?.length) {
          setHasAllergies(true);
          setAllergies(athlete.allergies.filter((item) => (ALLERGENS as readonly string[]).includes(item)));
          setOtherAllergies(athlete.allergies.filter((item) => !(ALLERGENS as readonly string[]).includes(item)).join(", "));
        }
        const savedSport = sportLabel(athlete.sport);
        if (savedSport) {
          if ((SPORT_OPTIONS as readonly string[]).includes(savedSport)) setSport(savedSport);
          else {
            setSport(OTHER);
            setOtherSport(savedSport);
          }
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const questionIndex = QUESTION_STEPS.indexOf(step);

  function go(next: Step) {
    setError(null);
    setStep(next);
  }

  function nextStep(): Step {
    return questionIndex >= 0 && questionIndex < QUESTION_STEPS.length - 1 ? QUESTION_STEPS[questionIndex + 1] : "target";
  }

  function back() {
    if (questionIndex > 0) go(QUESTION_STEPS[questionIndex - 1]);
    else if (step === "target") go("allergies");
    else finish();
  }

  function finish(section?: "coach") {
    router.replace((section ? `/athlete/dashboard?section=${section}` : "/athlete/dashboard") as never);
  }

  async function save(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/api/athlete/me", { method: "PATCH", body: JSON.stringify(body) });
      if (!res.ok) {
        errorFeedback();
        setError(SAVE_ERROR);
        return false;
      }
      return true;
    } catch {
      errorFeedback();
      setError(SAVE_ERROR);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveGoal() {
    if (!goal) return go(nextStep());
    const ok = await save({ fitnessGoal: goal, goalIntensity: goal === "maintain_weight" ? "moderate" : pace });
    if (ok) go(nextStep());
  }

  async function saveBody() {
    const problem = bodyBasicsError({ weightKg, heightCm, dob, sex, today: dobBounds.today });
    if (problem) {
      errorFeedback();
      setError(problem);
      return;
    }
    const ok = await save({ weightKg: Number(weightKg), heightCm: Number(heightCm), dob, biologicalSex: sex });
    if (ok) go(nextStep());
  }

  async function pickActivity(value: string) {
    selectionFeedback();
    setActivity(value);
    const ok = await save({ activityLevel: value });
    if (ok) go(nextStep());
  }

  async function saveAllergies() {
    const body: Record<string, unknown> = {};
    if (hasAllergies === false) body.allergies = [];
    if (hasAllergies === true) body.allergies = [...allergies, ...splitList(otherAllergies)];
    const chosenSport = sport === OTHER ? otherSport.trim() : sport;
    if (chosenSport.length >= 2) body.sport = chosenSport;
    if (Object.keys(body).length === 0) return go(nextStep());
    const ok = await save(body);
    if (ok) go(nextStep());
  }

  const title = step === "target" ? "Your daily target" : "Set up";
  const subtitle = step === "target" ? undefined : `Step ${questionIndex + 1} of ${QUESTION_STEPS.length}`;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
      <ScreenContainer contentStyle={styles.content}>
        <BackHeader
          title={title}
          subtitle={subtitle}
          onBack={back}
          actionLabel={step !== "target" ? "Skip" : undefined}
          onAction={step !== "target" ? () => go(nextStep()) : undefined}
        />
        {step !== "target" ? <ProgressBar value={(questionIndex + 1) / QUESTION_STEPS.length} height={6} /> : null}

        <FadeIn key={step} style={styles.step}>
          {step === "goal" ? (
            <>
              <Question title="What's your goal?" sub="This sets your daily calories and the coaches we show you." />
              <View style={styles.options}>
                {GOALS.map((option) => (
                  <OptionRow
                    key={option.value}
                    icon={option.icon}
                    title={option.title}
                    sub={option.sub}
                    selected={goal === option.value}
                    onPress={() => {
                      selectionFeedback();
                      setGoal(option.value);
                    }}
                  />
                ))}
              </View>
              {goal && goal !== "maintain_weight" ? (
                <View style={styles.group}>
                  <Text style={styles.groupLabel}>How fast?</Text>
                  <Chips options={PACES.map((p) => ({ value: p.value, label: p.label }))} selected={[pace]} onToggle={setPace} />
                </View>
              ) : null}
              <ActionButton style={styles.cta} label="Continue" variant="filled" onPress={saveGoal} busy={busy} disabled={!goal} />
            </>
          ) : null}

          {step === "body" ? (
            <>
              <Question title="About you" sub="Used only to work out your calories. Your coach can see it, nobody else." />
              <View style={styles.row}>
                <View style={styles.flex}>
                  <Text style={styles.groupLabel}>Weight (kg)</Text>
                  <FormField value={weightKg} onChangeText={(v) => { setWeightKg(v); setError(null); }} keyboardType="decimal-pad" placeholder="72" accessibilityLabel="Weight in kilograms" />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.groupLabel}>Height (cm)</Text>
                  <FormField value={heightCm} onChangeText={(v) => { setHeightCm(v); setError(null); }} keyboardType="number-pad" placeholder="170" accessibilityLabel="Height in centimetres" />
                </View>
              </View>
              <View style={styles.group}>
                <Text style={styles.groupLabel}>Birthday</Text>
                <DateField
                  value={dob}
                  onChange={(v) => { setDob(v); setError(null); }}
                  accessibilityLabel="Birthday"
                  placeholder="Pick your birthday"
                  minimumDate={DOB_MIN_DATE}
                  maximumDate={dobBounds.latest}
                  initialPickerDate={dobBounds.defaultDate}
                  snapToRange={false}
                />
              </View>
              <View style={styles.group}>
                <Text style={styles.groupLabel}>Sex (for the calorie formula)</Text>
                <Chips options={[{ value: "male", label: "Male" }, { value: "female", label: "Female" }]} selected={[sex]} onToggle={(v) => { setSex(v); setError(null); }} />
              </View>
              <ActionButton style={styles.cta} label="Continue" variant="filled" onPress={saveBody} busy={busy} />
            </>
          ) : null}

          {step === "activity" ? (
            <>
              <Question title="How active is a normal week?" sub="Count training and your job. Pick the closest one." />
              <View style={styles.options}>
                {ACTIVITY.map((option, index) => (
                  <OptionRow
                    key={option.value}
                    badge={String(index + 1)}
                    title={option.title}
                    sub={option.sub}
                    selected={activity === option.value}
                    disabled={busy}
                    onPress={() => void pickActivity(option.value)}
                  />
                ))}
              </View>
            </>
          ) : null}

          {step === "allergies" ? (
            <>
              <Question title="Any food allergies?" sub="Your coach's meal plans will never include these." />
              <Chips
                options={[{ value: "no", label: "No" }, { value: "yes", label: "Yes" }]}
                selected={hasAllergies === null ? [] : [hasAllergies ? "yes" : "no"]}
                onToggle={(v) => setHasAllergies(v === "yes")}
              />
              {hasAllergies ? (
                <View style={styles.group}>
                  <Chips
                    options={ALLERGENS.map((item) => ({ value: item, label: item }))}
                    selected={allergies}
                    onToggle={(v) => setAllergies((prev) => (prev.includes(v) ? prev.filter((item) => item !== v) : [...prev, v]))}
                  />
                  <FormField value={otherAllergies} onChangeText={setOtherAllergies} placeholder="Anything else? e.g. mustard" accessibilityLabel="Other allergies" containerStyle={styles.fixedField} />
                </View>
              ) : null}
              <View style={styles.group}>
                <Text style={styles.groupLabel}>Do you train for a sport? (optional)</Text>
                <Chips
                  options={[...SPORT_OPTIONS, OTHER].map((item) => ({ value: item, label: item }))}
                  selected={[sport]}
                  onToggle={(v) => setSport((prev) => (prev === v ? "" : v))}
                />
                {sport === OTHER ? <FormField value={otherSport} onChangeText={setOtherSport} placeholder="Your sport" accessibilityLabel="Your sport" containerStyle={styles.fixedField} /> : null}
              </View>
              <ActionButton style={styles.cta} label="Continue" variant="filled" onPress={saveAllergies} busy={busy} />
            </>
          ) : null}

          {step === "target" ? <TargetStep onStart={() => finish()} onFindCoach={() => finish("coach")} onAddDetails={() => go("goal")} /> : null}

          {error ? (
            <View style={styles.errorRow} accessibilityLiveRegion="polite">
              <Ionicons name="alert-circle" size={18} color={colors.bad} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
        </FadeIn>
      </ScreenContainer>
    </KeyboardAvoidingView>
  );
}

/** The payoff: the real target the server just worked out from these answers. */
function TargetStep({ onStart, onFindCoach, onAddDetails }: { onStart: () => void; onFindCoach: () => void; onAddDetails: () => void }) {
  const [state, setState] = useState<{ loading: boolean; target: NutritionTarget | null; failed: boolean }>({ loading: true, target: null, failed: false });

  useEffect(() => {
    let active = true;
    apiJson<{ target: NutritionTarget | null }>("/api/athlete/nutrition/target")
      .then(({ target }) => {
        if (!active) return;
        setState({ loading: false, target, failed: false });
        if (target) celebrate({ title: "Your daily target is ready" });
      })
      .catch(() => {
        if (active) setState({ loading: false, target: null, failed: true });
      });
    return () => {
      active = false;
    };
  }, []);

  const { target } = state;
  return (
    <>
      {state.loading ? (
        <AppCard style={styles.targetCard}>
          <Text style={styles.sub}>Working out your target...</Text>
        </AppCard>
      ) : target ? (
        <AppCard style={styles.targetCard}>
          <MetricRing metric="nutrition" value={1} size={176} stroke={14}>
            <CountUpText value={target.calories.toLocaleString()} style={styles.targetNumber} />
            <Text style={styles.targetUnit}>kcal a day</Text>
          </MetricRing>
          <View style={styles.macros}>
            <Macro label="Protein" grams={target.proteinG} />
            <Macro label="Carbs" grams={target.carbsG} />
            <Macro label="Fat" grams={target.fatG} />
          </View>
          <Text style={styles.sub}>Worked out from your goal, body and activity. See how on the Nutrition tab.</Text>
        </AppCard>
      ) : (
        <AppCard style={styles.targetCard}>
          <Text style={styles.cardTitle}>{state.failed ? "Couldn't load your target" : "Almost there"}</Text>
          <Text style={styles.sub}>
            {state.failed ? "It's saved. You'll see it on the Nutrition tab." : "Add your goal, body details and activity to get your daily calories."}
          </Text>
          {state.failed ? null : <ActionButton style={styles.cta} label="Add Details" onPress={onAddDetails} />}
        </AppCard>
      )}
      <ActionButton style={styles.cta} label="Start My First Day" variant="filled" onPress={onStart} />
      <Pressable onPress={onFindCoach} hitSlop={8} accessibilityRole="button" style={({ pressed }) => [styles.link, pressed ? styles.pressed : null]}>
        <Text style={styles.linkText}>Find a coach first</Text>
      </Pressable>
    </>
  );
}

function Macro({ label, grams }: { label: string; grams: number }) {
  return (
    <View style={styles.macro}>
      <CountUpText value={`${Math.round(grams)} g`} style={styles.macroValue} />
      <Text style={styles.macroLabel}>{label}</Text>
    </View>
  );
}

function Question({ title, sub }: { title: string; sub: string }) {
  return (
    <View style={styles.question}>
      <Text style={styles.questionTitle} accessibilityRole="header">{title}</Text>
      <Text style={styles.sub}>{sub}</Text>
    </View>
  );
}

function OptionRow({
  title,
  sub,
  icon,
  badge,
  selected,
  disabled,
  onPress,
}: {
  title: string;
  sub: string;
  icon?: keyof typeof Ionicons.glyphMap;
  badge?: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      style={({ pressed }) => [styles.option, selected ? styles.optionOn : null, pressed ? styles.pressed : null]}
    >
      <View style={[styles.optionIcon, selected ? styles.optionIconOn : null]}>
        {icon ? <Ionicons name={icon} size={18} color={selected ? colors.onPrimary : colors.inkMuted} /> : null}
        {badge ? <Text style={[styles.optionBadge, selected ? { color: colors.onPrimary } : null]}>{badge}</Text> : null}
      </View>
      <View style={styles.flex}>
        <Text style={styles.optionTitle}>{title}</Text>
        <Text style={styles.optionSub}>{sub}</Text>
      </View>
    </Pressable>
  );
}

function Chips({ options, selected, onToggle }: { options: { value: string; label: string }[]; selected: string[]; onToggle: (value: string) => void }) {
  return (
    <View style={styles.chips}>
      {options.map((option) => {
        const on = selected.includes(option.value);
        return (
          <Pressable
            key={option.value}
            onPress={() => {
              selectionFeedback();
              onToggle(option.value);
            }}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            style={({ pressed }) => [styles.chip, on ? styles.chipOn : null, pressed ? styles.pressed : null]}
          >
            <Text style={[styles.chipText, on ? styles.chipTextOn : null]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // ActionButton and FormField grow by default (made for rows); in this column they keep their own height.
  fixedField: { flexGrow: 0, flexShrink: 0, flexBasis: "auto" },
  cta: { flexGrow: 0, flexShrink: 0, flexBasis: "auto", minHeight: 50 },
  content: { gap: 14 },
  step: { gap: 16 },
  question: { gap: 6, marginTop: 4 },
  questionTitle: { color: colors.ink, fontFamily: fonts.display, textTransform: "uppercase", fontSize: 34, lineHeight: 34 },
  sub: { color: colors.inkMuted, fontSize: 14, lineHeight: 20, fontWeight: "600" },
  options: { gap: 10 },
  option: { flexDirection: "row", alignItems: "center", gap: 14, padding: 14, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surfaceRaised },
  optionOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  optionIcon: { width: 38, height: 38, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceInset },
  optionIconOn: { backgroundColor: colors.primary },
  optionBadge: { color: colors.inkMuted, fontSize: 15, fontWeight: "800" },
  optionTitle: { color: colors.ink, fontSize: 16, fontWeight: "800" },
  optionSub: { color: colors.inkMuted, fontSize: 13, fontWeight: "600", marginTop: 1 },
  group: { gap: 8 },
  groupLabel: { color: colors.inkMuted, fontSize: 13, fontWeight: "700", marginBottom: 6 },
  row: { flexDirection: "row", gap: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.lineStrong },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.inkMuted, fontSize: 14, fontWeight: "700" },
  chipTextOn: { color: colors.onPrimary },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  errorText: { flex: 1, color: colors.bad, fontSize: 14, fontWeight: "700" },
  targetCard: { alignItems: "center", gap: 16, paddingVertical: 22 },
  targetNumber: { color: colors.ink, fontFamily: fonts.display, fontSize: 44, lineHeight: 46 },
  targetUnit: { color: colors.inkMuted, fontSize: 13, fontWeight: "700" },
  macros: { flexDirection: "row", gap: 8, alignSelf: "stretch" },
  macro: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: radius.md, backgroundColor: colors.surfaceInset },
  macroValue: { color: metricColors.nutrition.ink, fontFamily: fonts.display, fontSize: 24, lineHeight: 26 },
  macroLabel: { color: colors.inkMuted, fontSize: 12, fontWeight: "700" },
  cardTitle: { color: colors.ink, fontSize: 17, fontWeight: "800" },
  link: { alignSelf: "center", paddingVertical: 6 },
  linkText: { color: colors.primary, fontSize: 15, fontWeight: "700" },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
});
