import { Types } from "mongoose";
import { AthleteProfile } from "../models/AthleteProfile";
import { Academy } from "../models/Academy";
import type { UserRole } from "../models/User";

/**
 * `AthleteProfile.timezone`/`Academy.timezone` are free-text, unvalidated IANA
 * strings that no other code path in this app reads (dashboard.ts's `dayRange`
 * is always UTC) — production data may already contain garbage ("EST", "",
 * typos). This is the single choke point that guards against that: falls back
 * to UTC and logs, rather than letting an invalid string throw deep inside a
 * date computation.
 */
export function isValidTimeZone(tz: string): boolean {
  try {
    // eslint-disable-next-line no-new
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function safeTimezone(tz: string | null | undefined): string {
  if (!tz) return "UTC";
  if (isValidTimeZone(tz)) return tz;
  console.warn(`[notifications] invalid timezone "${tz}" — falling back to UTC`);
  return "UTC";
}

/**
 * Resolves the timezone to evaluate quiet-hours/reminder-times in for a given
 * user: athletes have their own `AthleteProfile.timezone`; coaches/guardians
 * have no per-user timezone field, so we use their academy's; everyone else
 * (no academy) falls back to UTC.
 */
export async function resolveTimezoneForUser(params: {
  userId: Types.ObjectId;
  role: UserRole;
  academyId?: Types.ObjectId | null;
}): Promise<string> {
  if (params.role === "athlete") {
    const profile = await AthleteProfile.findOne({ userId: params.userId })
      .select("timezone")
      .lean();
    return safeTimezone(profile?.timezone as string | undefined);
  }
  if (params.academyId) {
    const academy = await Academy.findById(params.academyId).select("timezone").lean();
    return safeTimezone(academy?.timezone as string | undefined);
  }
  return "UTC";
}

function partsInZone(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  // Some ICU builds render midnight as hour "24" under hour12:false; normalize to 0.
  const hourRaw = get("hour");
  const hour = hourRaw === "24" ? "00" : hourRaw;
  return { y: get("year"), mo: get("month"), d: get("day"), h: hour, mi: get("minute") };
}

/** `YYYY-MM-DD` for `date` as seen in `timeZone` — en-CA conveniently gives ISO order. */
export function localDateStringInZone(date: Date, timeZone: string): string {
  const { y, mo, d } = partsInZone(date, timeZone);
  return `${y}-${mo}-${d}`;
}

/** Minute-of-day (0–1439) for `date` as seen in `timeZone`. */
export function minuteOfDayInZone(date: Date, timeZone: string): number {
  const { h, mi } = partsInZone(date, timeZone);
  return Number(h) * 60 + Number(mi);
}
