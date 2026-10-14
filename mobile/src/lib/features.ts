// Product feature flags, read from build-time EXPO_PUBLIC_* env.
//
// In-app payments are off until a real payment flow ships. With the flag off,
// subscribe/switch/payout UI is hidden and athletes join a coach by sending a
// request to join or by accepting a coach's email invite (services/coachInvite.ts).
export const PAYMENTS_ENABLED = process.env.EXPO_PUBLIC_PAYMENTS_ENABLED === "true";
