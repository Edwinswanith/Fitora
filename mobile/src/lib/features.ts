// Product feature flags, read from build-time EXPO_PUBLIC_* env.
//
// In-app payments are off until a real payment flow ships. With the flag off,
// subscribe/switch/payout UI is hidden and athletes join a coach by having the
// coach add them by email (POST /api/coach/athletes/link).
export const PAYMENTS_ENABLED = process.env.EXPO_PUBLIC_PAYMENTS_ENABLED === "true";
