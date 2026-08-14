import crypto from "crypto";

// Unambiguous alphabet — no 0/O/1/I/l so a coach can read the temp password
// aloud or write it down without confusion.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

/**
 * Generate a readable one-time temp password for a coach-created account.
 * Uses crypto random bytes (no external dependency). The plaintext is returned
 * to the coach exactly once; only its bcrypt hash is ever stored.
 */
export function generateTempPassword(length = 10): string {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}
