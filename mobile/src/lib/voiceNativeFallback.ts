export function shouldRetryWithDeepgram(reason?: string): boolean {
  return reason !== "not-allowed" && reason !== "permission-denied";
}
