// Where the floating Ask Agent button stays out of the way. On these screens
// the user is filling a form, editing, or chatting, and the button sat on top
// of inputs and primary actions ("Complete Set", "Archive template", the send
// box). It still appears there while a voice conversation is in progress, so
// an assistant action that opens one of these screens is never cut off.

const HIDDEN_ROUTE_PREFIXES = [
  "/athlete/check-in",
  "/athlete/rpe",
  "/athlete/log-meal",
  "/athlete/meal-scan",
  "/athlete/book-session",
  "/athlete/active-workout",
  "/coach/plan/workout-template",
  "/coach/plan/meal-plan",
  "/coach/messages",
  "/coach/athletes/new",
  "/coach/announcements",
  "/account",
];

export function isAskAgentHiddenOn(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  return HIDDEN_ROUTE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
