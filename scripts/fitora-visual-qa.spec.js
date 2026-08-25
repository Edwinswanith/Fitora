const fs = require("fs");
const path = require("path");

const baseUrl = process.env.FITORA_WEB_URL || "http://localhost:8082";
const outDir = path.resolve("qa-artifacts", "fitora");
fs.mkdirSync(outDir, { recursive: true });

const today = process.env.FITORA_QA_DATE || "2026-08-14";
const tomorrow = "2026-08-15";

const athleteUser = {
  id: "athlete-user-1",
  name: "Edwin Swanith",
  email: "edwin@email.com",
  role: "athlete",
  avatar: { kind: "default", defaultId: "male-1" },
};

const coachUser = {
  id: "coach1",
  name: "Alex Johnson",
  email: "coach.kumar@acme.test",
  role: "coach",
  avatar: { kind: "default", defaultId: "coach-1" },
};

const workoutSummary = {
  id: "workout-1",
  templateId: "template-1",
  name: "Upper Body Strength",
  scheduledDate: today,
  slot: "AM",
  status: "in_progress",
  exerciseCount: 6,
  completedCount: 4,
  progressPercent: 67,
};

const workoutDetail = {
  ...workoutSummary,
  exercises: [
    { title: "Bench Press", type: "strength", sets: 4, reps: "8", durationSec: null, restSec: 90, instructions: "Controlled tempo with a stable shoulder position.", mediaId: "media-1", notes: null, order: 1 },
    { title: "Lat Pulldown", type: "strength", sets: 3, reps: "10", durationSec: null, restSec: 75, instructions: "Pull elbows down and keep ribs stacked.", mediaId: "media-2", notes: null, order: 2 },
    { title: "Shoulder Press", type: "strength", sets: 3, reps: "12", durationSec: null, restSec: 75, instructions: "Stay light today and keep range smooth.", mediaId: "media-3", notes: null, order: 3 },
  ],
  progress: [
    { exerciseIndex: 0, status: "completed", setsCompleted: [{ setNumber: 1, reps: 8, weightKg: 50, durationSec: null }], notes: null, completedAt: "2026-08-17T07:00:00.000Z" },
    { exerciseIndex: 1, status: "in_progress", setsCompleted: [{ setNumber: 1, reps: 10, weightKg: 40, durationSec: null }, { setNumber: 2, reps: 10, weightKg: 40, durationSec: null }], notes: null, completedAt: null },
  ],
};

const athleteDashboard = {
  athlete: {
    name: "Edwin Swanith",
    email: "edwin@email.com",
    createdAt: "2026-01-01T00:00:00.000Z",
    sport: "General Fitness",
    position: null,
    dob: "1997-04-10T00:00:00.000Z",
    heightCm: 178,
    weightKg: 78.4,
    timezone: "Asia/Kolkata",
    hydrationGoalMl: 2500,
    fitnessGoal: "weight_loss",
    goalIntensity: "moderate",
    activityLevel: "moderate",
    dietaryPreferences: ["Non-Vegetarian"],
    allergies: [],
    cuisinePreferences: ["South Indian"],
  },
  daily: {
    athleteId: "athlete-1",
    name: "Edwin Swanith",
    sport: "General Fitness",
    position: null,
    date: today,
    attendance: { status: "present" },
    sessions: {
      AM: { status: "in_progress", type: "workout", durationMin: 45, workoutType: "Upper Body Strength" },
      PM: { status: "planned", type: "Progress Review", durationMin: 30, workoutType: null },
    },
    readinessScore: 76,
    sleep: { hours: 7.5, quality: 4 },
    soreness: 2,
    fatigue: 3,
    recovery: { status: "good", score: 78, restingHr: 58, hrv: 67 },
    injury: { active: false, bodyPart: null },
    rpe: { calculatedTrainingLoad: 360, riskFlag: "amber", rpe: 7, readinessScore: 76 },
  },
  workoutAssignments: [workoutSummary],
};

const athletePayloads = {
  profile: { athlete: athleteDashboard.athlete },
  target: { target: { id: "target-1", calories: 2100, proteinG: 150, carbsG: 220, fatG: 65, fitnessGoal: "weight_loss", goalIntensity: "moderate", effectiveFrom: today } },
  meals: {
    meals: [
      { id: "meal-1", date: today, mealType: "breakfast", source: "manual", name: "Oats + Eggs", foods: [{ name: "Oats + Eggs", calories: 480, proteinG: 28, carbsG: 52, fatG: 15 }] },
    ],
    totals: { calories: 1680, proteinG: 120, carbsG: 180, fatG: 48 },
  },
  plannedMeals: {
    plannedMeals: [
      { id: "planned-1", date: today, mealType: "breakfast", source: "coach", name: "Oats + Banana + Eggs", foods: [{ name: "Breakfast", calories: 450, proteinG: 30, carbsG: 52, fatG: 12 }] },
      { id: "planned-2", date: today, mealType: "lunch", source: "coach", name: "Chicken Rice Bowl", foods: [{ name: "Lunch", calories: 650, proteinG: 45, carbsG: 74, fatG: 15 }] },
      { id: "planned-3", date: today, mealType: "snack", source: "coach", name: "Protein Shake", foods: [{ name: "Snack", calories: 220, proteinG: 32, carbsG: 8, fatG: 4 }] },
      { id: "planned-4", date: today, mealType: "dinner", source: "coach", name: "Grilled Chicken + Vegetables", foods: [{ name: "Dinner", calories: 580, proteinG: 52, carbsG: 36, fatG: 20 }] },
    ],
  },
  water: { date: today, goalMl: 2500, totalMl: 1800, entries: [{ id: "water-1", amountMl: 500, loggedAt: "2026-08-17T08:00:00.000Z" }] },
  coaches: { coaches: [{ coachId: "coach1", name: "Alex Johnson", avatar: { kind: "default", defaultId: "coach-1" } }] },
  subscription: {
    subscription: {
      id: "sub-1",
      athleteId: "athlete-1",
      coachId: "coach1",
      status: "active",
      currentPeriodStart: "2026-08-01T00:00:00.000Z",
      currentPeriodEnd: "2026-09-15T00:00:00.000Z",
      pricingPlanSnapshot: { name: "Premium Coaching", monthlyPrice: 3999, currency: "INR", includedServices: ["2 live sessions", "Workout planning", "Nutrition support"], liveSessionsPerCycle: 2, nutritionIncluded: true, workoutPlanningIncluded: true, messagingIncluded: true },
    },
  },
  sessions: {
    sessions: [
      { id: "session-1", coachId: "coach1", athleteId: "athlete-1", coachName: "Alex Johnson", type: "progress_review", status: "confirmed", scheduledStart: `${today}T12:30:00.000Z`, scheduledEnd: `${today}T13:00:00.000Z` },
    ],
  },
  trends: { series: [
    { date: "2026-07-20", readiness: 60, load: 300, recoveryScore: 70 },
    { date: "2026-07-27", readiness: 76, load: 360, recoveryScore: 74 },
    { date: "2026-08-03", readiness: 78, load: 390, recoveryScore: 76 },
    { date: "2026-08-10", readiness: 64, load: 340, recoveryScore: 72 },
    { date: today, readiness: 72, load: 355, recoveryScore: 78 },
  ] },
  comments: { comments: [{ _id: "comment-1", body: "Keep your shoulder press lighter today.", date: today, createdAt: "2026-08-17T08:00:00.000Z", coachId: "coach1" }] },
  videos: { videos: [
    { id: "video-1", coachId: "coach1", title: "How to Improve Your Squat", description: null, category: "exercise", visibility: "subscribers", selectedClientIds: [], durationSec: 522, createdAt: "2026-08-16T08:00:00.000Z", updatedAt: "2026-08-16T08:00:00.000Z" },
    { id: "video-2", coachId: "coach1", title: "Shoulder Mobility", description: null, category: "recovery", visibility: "selected_clients", selectedClientIds: ["athlete-1"], durationSec: 370, createdAt: "2026-08-15T08:00:00.000Z", updatedAt: "2026-08-15T08:00:00.000Z" },
    { id: "video-3", coachId: "coach1", title: "Nutrition for Training", description: null, category: "nutrition", visibility: "public_preview", selectedClientIds: [], durationSec: 684, createdAt: "2026-08-14T08:00:00.000Z", updatedAt: "2026-08-14T08:00:00.000Z" },
  ] },
};

const coachProfile = {
  profile: {
    id: "coach1",
    name: "Alex Johnson",
    email: "coach.kumar@acme.test",
    bio: "Strength and conditioning coach.",
    philosophy: "Clear training guidance and consistent habits.",
    yearsExperience: 8,
    certifications: ["CSCS", "Precision Nutrition", "Mobility Specialist"],
    specializations: ["Strength", "Weight Loss", "Sports Performance"],
    languages: ["English", "Hindi"],
    coachingTypes: ["Strength", "Fat Loss", "Sports Performance"],
    nutritionSupport: true,
    verifiedStatus: "verified",
    avgRating: 4.8,
    reviewCount: 126,
    active: true,
  },
};

const coachCards = [
  { ...athleteDashboard.daily, athleteId: "athlete-1", name: "Edwin Swanith", readinessScore: 62, rpe: { calculatedTrainingLoad: 540, riskFlag: "red", rpe: 9, readinessScore: 62 } },
  { ...athleteDashboard.daily, athleteId: "athlete-2", name: "Meera", readinessScore: 84, rpe: { calculatedTrainingLoad: 250, riskFlag: "green", rpe: 5, readinessScore: 84 }, sessions: { AM: { status: "completed", type: "workout", durationMin: 45, workoutType: "Upper Body" } } },
  { ...athleteDashboard.daily, athleteId: "athlete-3", name: "Rahul", readinessScore: 67, rpe: { calculatedTrainingLoad: 300, riskFlag: "amber", rpe: 6, readinessScore: 67 }, sessions: { AM: { status: "skipped", type: "workout", durationMin: 45, workoutType: "Lower Body" } } },
  { ...athleteDashboard.daily, athleteId: "athlete-4", name: "Kiran", readinessScore: 58, rpe: { calculatedTrainingLoad: 380, riskFlag: "red", rpe: 8, readinessScore: 58 } },
];

const coachPayloads = {
  dashboard: { cards: coachCards },
  roster: { athletes: [
    { athleteId: "athlete-1", userId: "u1", name: "Edwin Swanith", email: "edwin@email.com", sport: "Weight Loss", position: null, avatar: { kind: "default", defaultId: "male-1" } },
    { athleteId: "athlete-2", userId: "u2", name: "Meera", email: "meera@email.com", sport: "Build Muscle", position: null, avatar: { kind: "default", defaultId: "female-1" } },
    { athleteId: "athlete-3", userId: "u3", name: "Rahul", email: "rahul@email.com", sport: "General Fitness", position: null, avatar: { kind: "default", defaultId: "male-1" } },
    { athleteId: "athlete-4", userId: "u4", name: "Kiran", email: "kiran@email.com", sport: "Maintain Fitness", position: null, avatar: { kind: "default", defaultId: "male-2" } },
  ] },
  sessions: { sessions: [
    { id: "session-1", coachId: "coach1", athleteId: "athlete-1", athleteName: "Edwin Swanith", type: "progress_review", status: "confirmed", scheduledStart: `${today}T12:30:00.000Z`, scheduledEnd: `${today}T13:00:00.000Z` },
    { id: "session-2", coachId: "coach1", athleteId: "athlete-2", athleteName: "Meera", type: "check_in", status: "confirmed", scheduledStart: `${today}T04:30:00.000Z`, scheduledEnd: `${today}T05:00:00.000Z` },
    { id: "session-3", coachId: "coach1", athleteId: "athlete-3", athleteName: "Rahul", type: "form_review", status: "confirmed", scheduledStart: `${today}T05:30:00.000Z`, scheduledEnd: `${today}T06:00:00.000Z` },
    { id: "session-4", coachId: "coach1", athleteId: "athlete-4", athleteName: "Kiran", type: "progress_review", status: "confirmed", scheduledStart: `${today}T06:30:00.000Z`, scheduledEnd: `${today}T07:00:00.000Z` },
    { id: "session-5", coachId: "coach1", athleteId: "athlete-5", athleteName: "Priya", type: "nutrition_review", status: "confirmed", scheduledStart: `${today}T08:30:00.000Z`, scheduledEnd: `${today}T09:00:00.000Z` },
    { id: "session-6", coachId: "coach1", athleteId: "athlete-6", athleteName: "Aman", type: "progress_review", status: "confirmed", scheduledStart: `${today}T09:30:00.000Z`, scheduledEnd: `${today}T10:00:00.000Z` },
  ] },
  squad: { series: [
    { date: "2026-08-11", avgReadiness: 72, attendanceRate: 78, avgLoad: 300, redFlags: 1, athleteCount: 4 },
    { date: "2026-08-12", avgReadiness: 78, attendanceRate: 82, avgLoad: 320, redFlags: 1, athleteCount: 4 },
    { date: "2026-08-13", avgReadiness: 82, attendanceRate: 88, avgLoad: 310, redFlags: 0, athleteCount: 4 },
    { date: today, avgReadiness: 74, attendanceRate: 84, avgLoad: 350, redFlags: 3, athleteCount: 4 },
  ] },
  notes: { openCount: 1, notes: [{ noteId: "note-1", athleteId: "athlete-1", athleteName: "Edwin", body: "Shoulder felt tight.", date: today, needsReply: true }] },
  templates: { templates: [
    { id: "template-1", name: "Upper Body Strength", exercises: [{}, {}, {}, {}, {}, {}], estimatedDurationMin: 45, version: 1 },
    { id: "template-2", name: "Lower Body Strength", exercises: [{}, {}, {}, {}, {}, {}, {}], estimatedDurationMin: 55, version: 1 },
    { id: "template-3", name: "Recovery Mobility", exercises: [{}, {}, {}, {}, {}], estimatedDurationMin: 20, version: 1 },
  ] },
  mealPlans: { mealPlans: [{ id: "meal-plan-1", name: "High Protein 2,100 kcal", durationDays: 7, days: [{}, {}, {}, {}, {}, {}, {}], status: "active" }] },
  pricingPlans: { pricingPlans: [
    { id: "price-1", name: "Basic", monthlyPrice: 2499, currency: "INR", includedServices: ["Workout planning", "Messaging"], liveSessionsPerCycle: 0, nutritionIncluded: false, workoutPlanningIncluded: true, messagingIncluded: true, active: true },
    { id: "price-2", name: "Pro", monthlyPrice: 3999, currency: "INR", includedServices: ["Workout", "Nutrition", "2 calls"], liveSessionsPerCycle: 2, nutritionIncluded: true, workoutPlanningIncluded: true, messagingIncluded: true, active: true },
    { id: "price-3", name: "Premium", monthlyPrice: 5999, currency: "INR", includedServices: ["Weekly session", "Priority support"], liveSessionsPerCycle: 4, nutritionIncluded: true, workoutPlanningIncluded: true, messagingIncluded: true, active: true },
  ] },
  availability: { rules: [
    { id: "a1", dayOfWeek: 1, startMinute: 540, endMinute: 780, timezone: "Asia/Kolkata", sessionDurationMin: 30, bufferMin: 0 },
    { id: "a2", dayOfWeek: 1, startMinute: 960, endMinute: 1200, timezone: "Asia/Kolkata", sessionDurationMin: 30, bufferMin: 0 },
    { id: "a3", dayOfWeek: 3, startMinute: 600, endMinute: 1080, timezone: "Asia/Kolkata", sessionDurationMin: 30, bufferMin: 0 },
    { id: "a4", dayOfWeek: 5, startMinute: 600, endMinute: 1080, timezone: "Asia/Kolkata", sessionDurationMin: 30, bufferMin: 0 },
  ] },
  reviews: { reviews: [{ id: "review-1", athleteName: "Rohan S.", overallRating: 5, body: "Very clear training guidance and quick responses.", createdAt: "2026-08-15T00:00:00.000Z" }] },
};

function payloadFor(url, role) {
  const u = new URL(url);
  const p = u.pathname;
  if (p === "/api/auth/me") return { user: role === "coach" ? coachUser : athleteUser };
  if (p === "/api/notifications/unread-count") return { unreadCount: 1 };

  if (role === "athlete") {
    if (p === "/api/athlete/me") return athletePayloads.profile;
    if (p === "/api/athlete/daily") return { card: athleteDashboard.daily, workoutAssignments: [workoutSummary] };
    if (p === "/api/athlete/nutrition/target") return athletePayloads.target;
    if (p === "/api/athlete/nutrition/meals") return athletePayloads.meals;
    if (p === "/api/athlete/nutrition/planned-meals") return athletePayloads.plannedMeals;
    if (p === "/api/athlete/water") return athletePayloads.water;
    if (p === "/api/athlete/coaches") return athletePayloads.coaches;
    if (p === "/api/athlete/coach-subscriptions/current") return athletePayloads.subscription;
    if (p === "/api/athlete/sessions") return athletePayloads.sessions;
    if (p === "/api/athlete/trends") return athletePayloads.trends;
    if (p === "/api/athlete/coach-comments") return athletePayloads.comments;
    if (p === "/api/athlete/coach-videos") return athletePayloads.videos;
    if (p === "/api/athlete/workout-assignments/workout-1") return { assignment: workoutDetail };
    if (p === "/api/athlete/workout-assignments") {
      if (u.searchParams.get("date")) return { assignments: [workoutSummary] };
      if ((u.searchParams.get("from") || "") > today) {
        return { assignments: [
          { ...workoutSummary, id: "upcoming-1", name: "Lower Body", scheduledDate: tomorrow, completedCount: 0, progressPercent: 0 },
          { ...workoutSummary, id: "upcoming-2", name: "Recovery + Mobility", scheduledDate: "2026-08-19", exerciseCount: 5, completedCount: 0, progressPercent: 0 },
        ] };
      }
      return { assignments: [{ ...workoutSummary, id: "recent-1", status: "completed", completedCount: 6, progressPercent: 100 }] };
    }
    if (p === "/api/marketplace/coaches/coach1") {
      return { profile: { coachId: "coach1", avatar: { kind: "default", defaultId: "coach-1" }, ...coachProfile.profile, pricingPlans: coachPayloads.pricingPlans.pricingPlans } };
    }
    if (p === "/api/marketplace/coaches") {
      return { coaches: [{ coachId: "coach1", avatar: { kind: "default", defaultId: "coach-1" }, ...coachProfile.profile, startingPrice: { amount: 2499, currency: "INR" } }] };
    }
  }

  if (role === "coach") {
    if (p === "/api/coach/dashboard") return coachPayloads.dashboard;
    if (p === "/api/coach/athletes") return coachPayloads.roster;
    if (p === "/api/coach/sessions") return coachPayloads.sessions;
    if (p === "/api/coach/analytics/squad") return coachPayloads.squad;
    if (p === "/api/coach/notes-inbox") return coachPayloads.notes;
    if (p === "/api/workout-templates") return coachPayloads.templates;
    if (p === "/api/coach/meal-plans") return coachPayloads.mealPlans;
    if (p === "/api/coach/videos") return athletePayloads.videos;
    if (p === "/api/coach/profile") return coachProfile;
    if (p === "/api/coach/pricing-plans") return coachPayloads.pricingPlans;
    if (p === "/api/coach/availability") return coachPayloads.availability;
    if (p === "/api/marketplace/coaches/coach1/reviews") return coachPayloads.reviews;
  }

  return {};
}

async function makePage(browser, role) {
  const context = await browser.newContext({
    viewport: { width: 430, height: 932 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript(({ role, athleteUser, coachUser }) => {
    const user = role === "coach" ? coachUser : athleteUser;
    window.localStorage.setItem("scp.accessToken", `mock-${role}-access`);
    window.localStorage.setItem("scp.refreshToken", `mock-${role}-refresh`);
    window.localStorage.setItem("scp.user", JSON.stringify(user));
  }, { role, athleteUser, coachUser });
  await context.route("**/api/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payloadFor(route.request().url(), role)),
    });
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));
  return { page, context, consoleErrors };
}

async function shot(page, name) {
  await page.waitForTimeout(900);
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`captured ${name}`);
  return file;
}

async function openState(page, route, expectedText, name) {
  console.log(`opening ${name}`);
  await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page
    .waitForFunction((text) => document.body.innerText.includes(text), expectedText, { timeout: 6000 })
    .catch(() => console.warn(`expected text not found on ${name}: ${expectedText}`));
}

async function main() {
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  const results = [];

  const athlete = await makePage(browser, "athlete");
  const athleteRoutes = [
    ["athlete-today", "/athlete/dashboard", "Today's Plan"],
    ["athlete-workouts", "/athlete/dashboard?section=workouts", "Exercise Preview"],
    ["athlete-nutrition", "/athlete/dashboard?section=nutrition", "Coach Meal Plan"],
    ["athlete-coach", "/athlete/dashboard?section=coach", "My Coach"],
    ["athlete-progress", "/athlete/dashboard?section=progress", "Goal Progress"],
    ["athlete-profile", "/account", "Your Goal"],
  ];
  for (const [name, route, text] of athleteRoutes) {
    await openState(athlete.page, route, text, name);
    results.push({ name, file: await shot(athlete.page, name) });
  }
  const athleteErrors = athlete.consoleErrors;
  await athlete.context.close();

  const coach = await makePage(browser, "coach");
  const coachRoutes = [
    ["coach-home", "/coach/dashboard", "Needs Attention"],
    ["coach-clients", "/coach/athletes", "Search clients"],
    ["coach-plan", "/coach/plan", "Assignments"],
    ["coach-content", "/coach/content", "Video Library"],
    ["coach-profile", "/coach/profile", "Coaching Plans"],
    ["coach-account", "/account", "Coaching"],
  ];
  for (const [name, route, text] of coachRoutes) {
    await openState(coach.page, route, text, name);
    results.push({ name, file: await shot(coach.page, name) });
  }
  const coachErrors = coach.consoleErrors;
  await coach.context.close();

  await browser.close();
  const report = {
    baseUrl,
    viewport: { width: 430, height: 932, deviceScaleFactor: 2 },
    screenshots: results,
    consoleErrors: { athlete: athleteErrors, coach: coachErrors },
  };
  const reportPath = path.join(outDir, "capture-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

module.exports = {
  payloadFor,
  athleteUser,
  coachUser,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
