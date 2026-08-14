import type { SessionSlot } from "./sessions";

export type AthleteDashboardSectionParam =
  | "today"
  | "progress"
  | "log"
  | "coach"
  | "messages"
  | "water"
  | "trends"
  | "achievements"
  | "chat";

export type AthleteNavigationCommand =
  | { kind: "notifications"; requested: string }
  | { kind: "calendar"; requested: string }
  | { kind: "dashboard"; requested: string; section: AthleteDashboardSectionParam; slot?: SessionSlot };

const NAV_PREFIX =
  /^(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?)?(?:open|show(?:\s+me)?|go(?:\s+to)?|navigate(?:\s+to)?|move(?:\s+to)?|switch(?:\s+to)?|change(?:\s+to)?|edit|update|take\s+me(?:\s+to)?|bring\s+me(?:\s+to)?)\s+(?:the\s+|my\s+)?(.+?)\.?$/i;

function normalizeTarget(text: string): string {
  return text
    .toLowerCase()
    .replace(/\ba\.?\s*m\.?\b/g, "am")
    .replace(/\bp\.?\s*m\.?\b/g, "pm")
    .replace(/\b(?:kisan|kishan|section)\b/g, "session")
    .trim();
}

function parseSlot(text: string): SessionSlot | null {
  const lower = normalizeTarget(text);
  if (/\b(am|morning|strength)\b/.test(lower)) return "AM";
  if (/\b(aft|afternoon|after\s*noon|conditioning)\b/.test(lower) || /\bafter\b(?=.*\b(session|training)\b)/.test(lower)) return "AFT";
  if (/\b(pm|evening|night|skill)\b/.test(lower)) return "PM";
  return null;
}

function isSessionNavigationTarget(text: string): boolean {
  const lower = normalizeTarget(text);
  return /\b(logs?|sessions?|training|workout|rpm|rpe|recovery)\b/.test(lower);
}

function isSessionHistoryTarget(text: string): boolean {
  const lower = normalizeTarget(text);
  return /\b(every|past|previous|history|did|done|last|month|week|report|reports|list)\b/.test(lower);
}

function isShortSlotCommand(text: string): boolean {
  return /^(?:the\s+)?(?:am|morning|aft|afternoon|after\s*noon|pm|evening|night)\s+(?:session|section|kisan|kishan)\s*\.?$/i.test(
    text.trim()
  );
}

function dashboard(section: AthleteDashboardSectionParam, requested: string, slot?: SessionSlot): AthleteNavigationCommand {
  return { kind: "dashboard", requested, section, ...(slot ? { slot } : {}) };
}

export function parseAthleteNavigationCommand(command: string): AthleteNavigationCommand | null {
  const trimmed = command.trim();
  if (!trimmed) return null;

  if (isShortSlotCommand(trimmed)) {
    const slot = parseSlot(trimmed);
    return slot ? dashboard("log", trimmed, slot) : null;
  }

  const navMatch = trimmed.match(NAV_PREFIX);
  if (!navMatch?.[1]) return null;

  const requested = navMatch[1].trim();
  const lower = normalizeTarget(requested);
  const slot = parseSlot(lower);
  if (slot && (isSessionNavigationTarget(lower) || /^(?:am|morning|aft|afternoon|after\s*noon|pm|evening|night)$/.test(lower))) {
    return dashboard("log", requested, slot);
  }
  if (isSessionNavigationTarget(lower) && isSessionHistoryTarget(lower)) return null;

  if (/\b(notification|notifications|bell|alerts?)\b/.test(lower)) return { kind: "notifications", requested };
  if (/\b(calendar|calender|date picker|pick date)\b/.test(lower)) return { kind: "calendar", requested };
  if (/\b(message|messages|chat|inbox|dm|direct)\b/.test(lower)) return dashboard("messages", requested);
  if (/\b(water|hydrat|drink)\b/.test(lower)) return dashboard("water", requested);
  if (/\b(trend|trends)\b/.test(lower)) return dashboard("trends", requested);
  if (/\b(goal|goals|achievement|achievements)\b/.test(lower)) return dashboard("achievements", requested);
  if (/\b(progress|report|reports)\b/.test(lower)) return dashboard("progress", requested);
  if (isSessionNavigationTarget(lower) && !isSessionHistoryTarget(lower)) return dashboard("log", requested);
  if (/\b(coach|feedback|comments?)\b/.test(lower)) return dashboard("coach", requested);
  if (/\b(today|status|readiness|home|dashboard)\b/.test(lower)) return dashboard("today", requested);

  return null;
}

export function athleteNavigationReply(command: AthleteNavigationCommand): string {
  if (command.kind === "notifications") return "Opening notifications.";
  if (command.kind === "calendar") return "Opening calendar.";
  if (command.slot) {
    const label = command.slot === "AFT" ? "Afternoon" : command.slot;
    return `Opening ${label} log.`;
  }
  if (command.section === "messages" || command.section === "chat") return "Opening messages.";
  if (command.section === "water") return "Opening water.";
  if (command.section === "trends") return "Opening trends.";
  if (command.section === "achievements") return "Opening achievements.";
  if (command.section === "progress") return "Opening progress.";
  if (command.section === "log") return "Opening training log.";
  if (command.section === "coach") return "Opening coach.";
  return "Opening today.";
}
