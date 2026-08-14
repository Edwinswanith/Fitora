import { Types } from "mongoose";
import { NotificationPreference, type NotificationCategoryKey } from "../models/NotificationPreference";
import { NotificationDecision } from "../models/NotificationDecision";
import { DeviceToken } from "../models/DeviceToken";
import { createNotification } from "./notifications";
import { getPushDeliveryAdapter } from "./fcmDelivery";
import { minuteOfDayInZone } from "./timezone";
import { env } from "../config/env";

export type NotificationCandidate = {
  userId: Types.ObjectId;
  type: string;
  category: NotificationCategoryKey;
  priorityTier: 1 | 2 | 3 | 5 | 6;
  dedupKey: string;
  title: string;
  body: string;
  link: string | null;
  academyId?: Types.ObjectId | null;
  entityRef?: { collection: string; id: Types.ObjectId } | null;
  /** Timezone to evaluate quiet-hours/reminder-time gates in (see services/timezone.ts). */
  timezone: string;
  /** Safety-critical override (severe injury_alert only) — bypasses quiet-hours/cap/min-interval/presence. */
  override?: boolean;
  /** Re-checked right before sending; true = permanently suppress ("already_completed"). */
  isActionAlreadyCompleted?: () => Promise<boolean>;
};

export type SendBudget = { dailyCount: number; lastSentAt: Date | null };

export type DispatchOutcome = "sent" | "suppressed" | "skipped";

function pushLogPayload(candidate: NotificationCandidate, extra?: Record<string, unknown>) {
  return {
    type: candidate.type,
    category: candidate.category,
    dedupKey: candidate.dedupKey,
    userId: candidate.userId.toString(),
    ...(extra ?? {}),
  };
}

/**
 * Which throttling gates a candidate skips.
 * - `messages` category (message/announcement/coach_feedback — user-initiated
 *   communication): skip cap/min-interval/presence, but STILL respect quiet-hours.
 * - `override` (severe injury_alert only): skip all four — a safety alert
 *   shouldn't wait for quiet hours to end or get lost behind a full daily cap.
 * Both still require `enabled` + category-enabled + an active token, always.
 */
function resolveGateSkips(candidate: NotificationCandidate) {
  if (candidate.override) {
    return { quietHours: true, cap: true, minInterval: true, presence: true };
  }
  if (candidate.category === "messages") {
    return { quietHours: false, cap: true, minInterval: true, presence: true };
  }
  return { quietHours: false, cap: false, minInterval: false, presence: false };
}

async function getOrCreatePreference(userId: Types.ObjectId) {
  return NotificationPreference.findOneAndUpdate(
    { userId },
    { $setOnInsert: { userId } },
    { upsert: true, new: true }
  );
}

function inQuietHours(minuteOfDay: number, startMinute: number, endMinute: number): boolean {
  if (startMinute === endMinute) return false; // zero-width window = never in quiet hours
  if (startMinute < endMinute) return minuteOfDay >= startMinute && minuteOfDay < endMinute;
  return minuteOfDay >= startMinute || minuteOfDay < endMinute; // wraps past midnight
}

/** Seeds a {dailyCount, lastSentAt} budget for one user, shared across a batch of candidates. */
export async function loadSendBudget(userId: Types.ObjectId, localDayStart: Date): Promise<SendBudget> {
  const [dailyCount, last] = await Promise.all([
    NotificationDecision.countDocuments({ userId, status: "sent", sentTime: { $gte: localDayStart } }),
    NotificationDecision.findOne({ userId, status: "sent" }).sort({ sentTime: -1 }).select("sentTime").lean(),
  ]);
  return { dailyCount, lastSentAt: (last?.sentTime as Date | undefined) ?? null };
}

async function writeSuppressed(candidate: NotificationCandidate, reason: string, now: Date): Promise<void> {
  try {
    await NotificationDecision.create({
      userId: candidate.userId,
      category: candidate.category,
      type: candidate.type,
      priorityTier: candidate.priorityTier,
      dedupKey: candidate.dedupKey,
      status: "suppressed",
      suppressReason: reason,
      sentTime: now,
      link: candidate.link,
      entityRef: candidate.entityRef ?? null,
      academyId: candidate.academyId ?? null,
    });
  } catch {
    // Duplicate key — another run already recorded a decision for this key. Fine.
  }
}

/**
 * The decision engine's single entry point. Runs every gate (cheapest/most-
 * likely-to-reject first), then — ONLY at the very last step — atomically
 * claims the dedup key via an upsert, which is what actually prevents a
 * double-send across concurrent/paged sweep runs. A transient rejection
 * (quiet hours, cap, min-interval, presence, no active token) writes NOTHING,
 * so the same dedupKey stays fully eligible next tick; only a permanent
 * rejection (already-completed, disabled, category-disabled, or a dedup key
 * that's already been decided) writes a "suppressed" row.
 */
export async function evaluateAndDispatch(
  candidate: NotificationCandidate,
  opts: { createInAppNotification?: boolean; budget?: SendBudget; now?: Date } = {}
): Promise<DispatchOutcome> {
  const now = opts.now ?? new Date();
  const createInApp = opts.createInAppNotification ?? true;

  if (await NotificationDecision.exists({ dedupKey: candidate.dedupKey })) {
    return "skipped"; // already decided (sent or suppressed) — nothing more to do
  }

  if (candidate.isActionAlreadyCompleted && (await candidate.isActionAlreadyCompleted())) {
    await writeSuppressed(candidate, "already_completed", now);
    return "suppressed";
  }

  const pref = await getOrCreatePreference(candidate.userId);
  if (!pref.enabled) {
    await writeSuppressed(candidate, "user_disabled", now);
    return "suppressed";
  }
  // Nested subdocuments always populate their schema defaults on a doc that
  // came from getOrCreatePreference's upsert — InferSchemaType just can't
  // express "always present" for a plain nested object the way it can for a
  // top-level required field.
  const categories = pref.categories!;
  const quietHours = pref.quietHours!;

  if (!categories[candidate.category]) {
    await writeSuppressed(candidate, "category_disabled", now);
    return "suppressed";
  }

  const skip = resolveGateSkips(candidate);

  const hasToken = await DeviceToken.exists({ userId: candidate.userId, disabledAt: null });
  if (!hasToken) {
    console.warn("[push] skipped_no_active_token", pushLogPayload(candidate));
    return "skipped"; // transient — a device may register a token later today
  }

  if (!skip.quietHours && quietHours.enabled) {
    const minute = minuteOfDayInZone(now, candidate.timezone);
    if (inQuietHours(minute, quietHours.startMinute!, quietHours.endMinute!)) {
      return "skipped";
    }
  }

  if (!skip.cap || !skip.minInterval) {
    const cap = pref.dailyCap ?? env.notification.dailyCap;
    const minIntervalMinutes = pref.minIntervalMinutes ?? env.notification.minIntervalMinutes;
    let budget = opts.budget;
    if (!budget) {
      const localDayStart = new Date(now);
      localDayStart.setUTCHours(0, 0, 0, 0);
      budget = await loadSendBudget(candidate.userId, localDayStart);
    }
    if (!skip.cap && budget.dailyCount >= cap) return "skipped";
    if (
      !skip.minInterval &&
      budget.lastSentAt &&
      now.getTime() - budget.lastSentAt.getTime() < minIntervalMinutes * 60_000
    ) {
      return "skipped";
    }
  }

  if (!skip.presence && pref.lastActiveAt) {
    const idleMs = now.getTime() - (pref.lastActiveAt as Date).getTime();
    if (idleMs < env.notification.presenceSuppressWindowMin * 60_000) {
      return "skipped"; // user's app was just foregrounded — they'll see it via the in-app poll
    }
  }

  // Atomic claim — the ONE place two concurrent evaluations of the same
  // dedupKey can race. upsertedCount tells us whether THIS call gets to send.
  let claimed = false;
  try {
    const result = await NotificationDecision.updateOne(
      { dedupKey: candidate.dedupKey },
      {
        $setOnInsert: {
          userId: candidate.userId,
          category: candidate.category,
          type: candidate.type,
          priorityTier: candidate.priorityTier,
          dedupKey: candidate.dedupKey,
          status: "sent",
          sentTime: now,
          link: candidate.link,
          entityRef: candidate.entityRef ?? null,
          academyId: candidate.academyId ?? null,
        },
      },
      { upsert: true }
    );
    claimed = result.upsertedCount === 1;
  } catch {
    claimed = false; // duplicate-key race lost to a concurrent run
  }
  if (!claimed) return "skipped";

  if (createInApp) {
    await createNotification({
      recipientUserId: candidate.userId,
      type: candidate.type,
      title: candidate.title,
      body: candidate.body,
      priority: candidate.priorityTier === 1 ? "high" : candidate.priorityTier <= 3 ? "medium" : "low",
      link: candidate.link,
      academyId: candidate.academyId ?? null,
    });
  }

  const tokens = await DeviceToken.find({ userId: candidate.userId, disabledAt: null }).lean();
  const adapter = getPushDeliveryAdapter();
  console.log("[push] send_attempt", pushLogPayload(candidate, { tokenCount: tokens.length }));
  const results = await adapter.send({
    tokens: tokens.map((t) => ({
      token: t.token as string,
      platform: t.platform as "android" | "ios" | "web",
    })),
    data: {
      type: candidate.type,
      title: candidate.title,
      body: candidate.body,
      link: candidate.link ?? "",
    },
  });
  const errors = results.filter((r) => !r.ok).map((r) => r.error ?? "unknown_error");
  const resultPayload = pushLogPayload(candidate, {
    tokenCount: results.length,
    okCount: results.filter((r) => r.ok).length,
    errorCount: errors.length,
    invalidTokenCount: results.filter((r) => r.invalidToken).length,
    errors: [...new Set(errors)].slice(0, 5),
  });
  if (errors.length > 0) {
    console.warn("[push] send_result", resultPayload);
  } else {
    console.log("[push] send_result", resultPayload);
  }

  const invalidTokens = results.filter((r) => r.invalidToken).map((r) => r.token);
  if (invalidTokens.length > 0) {
    await DeviceToken.updateMany(
      { token: { $in: invalidTokens } },
      { $set: { disabledAt: now } }
    );
  }

  await NotificationDecision.updateOne(
    { dedupKey: candidate.dedupKey },
    {
      $set: {
        "deliveryResult.attempted": true,
        "deliveryResult.providerMessageIds": results
          .filter((r) => r.ok && r.messageId)
          .map((r) => r.messageId as string),
        "deliveryResult.errors": results.filter((r) => !r.ok).map((r) => r.error ?? "unknown_error"),
      },
    }
  );

  if (opts.budget) {
    opts.budget.dailyCount += 1;
    opts.budget.lastSentAt = now;
  }

  return "sent";
}
