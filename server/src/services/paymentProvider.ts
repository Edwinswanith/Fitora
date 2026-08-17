/**
 * Adapter for the subscription payment provider (Razorpay). Mirrors the
 * getPushDeliveryAdapter()/getWorkoutImageConverter() pattern: a real adapter
 * when RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET/RAZORPAY_WEBHOOK_SECRET are all
 * set, otherwise a mock adapter — so the full subscription lifecycle
 * (checkout, webhook, activation, cancellation) stays exercisable and tested
 * with no live merchant account configured. Callers only depend on the
 * PaymentProvider interface, so nothing else changes if the provider is ever
 * swapped.
 *
 * Razorpay facts this adapter relies on (verified against Razorpay's own API
 * docs): subscriptions are billed against a pre-created "Plan" (amount is in
 * the smallest currency unit, e.g. paise for INR); webhook payloads carry an
 * `event` string and an entity envelope under `payload.<entity>.entity`;
 * webhook authenticity is verified by computing an HMAC-SHA256 of the raw
 * request body with the dashboard-configured webhook secret and comparing it
 * (constant-time) against the `X-Razorpay-Signature` header — Razorpay does
 * not guarantee a stable per-delivery event id in the body, so the webhook
 * route falls back to hashing the raw body for idempotency (see
 * models/PaymentWebhookEvent.ts).
 */

import crypto from "crypto";
import { env } from "../config/env";

export type NormalizedPricingPlan = {
  id: string;
  name: string;
  monthlyPrice: number;
  currency: string;
  razorpayPlanId: string | null;
};

export type CreateCheckoutParams = {
  coachId: string;
  athleteId: string;
  pricingPlan: NormalizedPricingPlan;
};

export type CheckoutResult = {
  providerSubscriptionId: string;
  /** Only set when a new provider-side plan had to be created — caller persists this onto CoachPricingPlan.razorpayPlanId. */
  providerPlanId: string;
  /** Hosted checkout URL (or, for the mobile Razorpay SDK, the subscription id itself) the client uses to complete payment. */
  checkoutRef: string;
};

export type NormalizedPaymentEvent = {
  eventType: string;
  providerSubscriptionId: string | null;
  providerPaymentId: string | null;
  /** Major currency unit (e.g. rupees), never the provider's smallest-unit integer. */
  amount: number | null;
  currency: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  raw: unknown;
};

export interface PaymentProvider {
  createSubscriptionCheckout(params: CreateCheckoutParams): Promise<CheckoutResult>;
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean;
  parseWebhookEvent(rawBody: Buffer): NormalizedPaymentEvent;
  /** `atCycleEnd: true` (the default, matching AthleteCoachSubscription.cancelAtPeriodEnd) stops future billing but leaves the current period intact; `false` cancels immediately. */
  cancelSubscription(providerSubscriptionId: string, atCycleEnd?: boolean): Promise<void>;
}

// Razorpay requires a finite total_count of billing cycles for a monthly
// subscription; there is no "bill forever" option. 100 cycles (~8+ years)
// approximates an indefinite subscription — our own lifecycle status is what
// actually governs access, this only bounds how far Razorpay itself commits
// to rebilling before it would need to be recreated.
const RAZORPAY_MONTHLY_TOTAL_COUNT = 100;

function toSmallestUnit(amountMajor: number): number {
  return Math.round(amountMajor * 100);
}

function fromSmallestUnit(amountMinor: number): number {
  return amountMinor / 100;
}

/**
 * Shared envelope parser — both the real Razorpay adapter and the mock
 * adapter emit/consume the same `{event, payload}` shape (the mock
 * deliberately mirrors Razorpay's real shape so webhook-handling code is
 * exercised identically in tests as in production).
 */
function parseRazorpayEnvelope(rawBody: Buffer): NormalizedPaymentEvent {
  const parsed = JSON.parse(rawBody.toString("utf8")) as {
    event?: string;
    payload?: {
      subscription?: {
        entity?: { id?: string; current_start?: number; current_end?: number };
      };
      payment?: {
        entity?: { id?: string; amount?: number; currency?: string };
      };
    };
  };

  const subscriptionEntity = parsed.payload?.subscription?.entity;
  const paymentEntity = parsed.payload?.payment?.entity;

  return {
    eventType: parsed.event ?? "unknown",
    providerSubscriptionId: subscriptionEntity?.id ?? null,
    providerPaymentId: paymentEntity?.id ?? null,
    amount: typeof paymentEntity?.amount === "number" ? fromSmallestUnit(paymentEntity.amount) : null,
    currency: paymentEntity?.currency ?? null,
    periodStart:
      typeof subscriptionEntity?.current_start === "number"
        ? new Date(subscriptionEntity.current_start * 1000)
        : null,
    periodEnd:
      typeof subscriptionEntity?.current_end === "number" ? new Date(subscriptionEntity.current_end * 1000) : null,
    raw: parsed,
  };
}

function verifyHmacSignature(rawBody: Buffer, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader) return false;
  const expectedHex = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const expected = Buffer.from(expectedHex, "utf8");
  const actual = Buffer.from(signatureHeader, "utf8");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export class RazorpayPaymentProvider implements PaymentProvider {
  private readonly baseUrl = "https://api.razorpay.com/v1";

  constructor(
    private readonly keyId: string,
    private readonly keySecret: string,
    private readonly webhookSecret: string
  ) {}

  private authHeader(): string {
    return `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64")}`;
  }

  private async request<T>(path: string, init: { method: string; body?: unknown }): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: init.method,
      headers: {
        "Content-Type": "application/json",
        Authorization: this.authHeader(),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`razorpay_http_${res.status}: ${errBody.slice(0, 500)}`);
    }
    return (await res.json()) as T;
  }

  private async ensurePlan(pricingPlan: NormalizedPricingPlan): Promise<string> {
    if (pricingPlan.razorpayPlanId) return pricingPlan.razorpayPlanId;
    const created = await this.request<{ id: string }>("/plans", {
      method: "POST",
      body: {
        period: "monthly",
        interval: 1,
        item: {
          name: pricingPlan.name,
          amount: toSmallestUnit(pricingPlan.monthlyPrice),
          currency: pricingPlan.currency,
        },
      },
    });
    return created.id;
  }

  async createSubscriptionCheckout(params: CreateCheckoutParams): Promise<CheckoutResult> {
    const providerPlanId = await this.ensurePlan(params.pricingPlan);
    const subscription = await this.request<{ id: string; short_url: string }>("/subscriptions", {
      method: "POST",
      body: {
        plan_id: providerPlanId,
        total_count: RAZORPAY_MONTHLY_TOTAL_COUNT,
        quantity: 1,
        notes: { coachId: params.coachId, athleteId: params.athleteId },
      },
    });
    return {
      providerSubscriptionId: subscription.id,
      providerPlanId,
      checkoutRef: subscription.short_url || subscription.id,
    };
  }

  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    return verifyHmacSignature(rawBody, signatureHeader, this.webhookSecret);
  }

  parseWebhookEvent(rawBody: Buffer): NormalizedPaymentEvent {
    return parseRazorpayEnvelope(rawBody);
  }

  async cancelSubscription(providerSubscriptionId: string, atCycleEnd = true): Promise<void> {
    await this.request(`/subscriptions/${providerSubscriptionId}/cancel`, {
      method: "POST",
      body: { cancel_at_cycle_end: atCycleEnd ? 1 : 0 },
    });
  }
}

/**
 * Deterministic, fully offline provider for local dev and tests. Uses a
 * fixed mock webhook secret (never the real one — real credentials, if
 * present at all in a dev env, must never leak into a mode that logs/echoes
 * them) so tests can construct validly-signed webhook deliveries via
 * `signPayloadForTests` without any live Razorpay account.
 */
export class MockPaymentProvider implements PaymentProvider {
  static readonly MOCK_WEBHOOK_SECRET = "mock_webhook_secret_do_not_use_in_prod";
  private counter = 0;

  async createSubscriptionCheckout(params: CreateCheckoutParams): Promise<CheckoutResult> {
    this.counter += 1;
    const providerPlanId = params.pricingPlan.razorpayPlanId ?? `mock_plan_${params.pricingPlan.id}`;
    const providerSubscriptionId = `mock_sub_${params.athleteId}_${this.counter}_${crypto
      .randomBytes(4)
      .toString("hex")}`;
    return {
      providerSubscriptionId,
      providerPlanId,
      checkoutRef: providerSubscriptionId,
    };
  }

  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    return verifyHmacSignature(rawBody, signatureHeader, MockPaymentProvider.MOCK_WEBHOOK_SECRET);
  }

  parseWebhookEvent(rawBody: Buffer): NormalizedPaymentEvent {
    return parseRazorpayEnvelope(rawBody);
  }

  async cancelSubscription(_providerSubscriptionId: string, _atCycleEnd = true): Promise<void> {
    // No external state to mutate in mock mode.
  }

  /** Test-only helper: signs a mock webhook body the same way the mock's verifyWebhookSignature expects. */
  static signPayloadForTests(rawBody: Buffer): string {
    return crypto.createHmac("sha256", MockPaymentProvider.MOCK_WEBHOOK_SECRET).update(rawBody).digest("hex");
  }
}

let provider: PaymentProvider | null = null;

/** Single choke point for resolving the active payment provider. */
export function getPaymentProvider(): PaymentProvider {
  if (!provider) {
    const { keyId, keySecret, webhookSecret } = env.razorpay;
    if (keyId && keySecret && webhookSecret) {
      console.log("[payment] provider=razorpay");
      provider = new RazorpayPaymentProvider(keyId, keySecret, webhookSecret);
    } else {
      console.warn("[payment] provider=mock", {
        hasKeyId: Boolean(keyId),
        hasKeySecret: Boolean(keySecret),
        hasWebhookSecret: Boolean(webhookSecret),
      });
      provider = new MockPaymentProvider();
    }
  }
  return provider;
}

/** Test-only seam for injecting a fake provider. */
export function setPaymentProviderForTests(impl: PaymentProvider | null): void {
  provider = impl;
}
