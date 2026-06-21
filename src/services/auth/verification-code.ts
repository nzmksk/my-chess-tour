import {
  storeVerificationCode,
  startResendCooldown,
  clearResendCooldown,
} from "@/services/redis/redis";
import { sendVerificationEmail } from "@/services/email/email";

export function generateCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

// Send a fresh signup verification code, respecting the per-email resend
// cooldown so this can't be used to spam an address. No-op while on cooldown
// (the recently-sent code is still valid). Rolls the cooldown back and rethrows
// if storing or sending fails.
export async function sendSignupVerificationCode(email: string): Promise<void> {
  const cooldown = await startResendCooldown(email);
  if (cooldown > 0) return;

  const code = generateCode();
  try {
    await storeVerificationCode(email, code);
    await sendVerificationEmail(email, code);
  } catch (err) {
    await clearResendCooldown(email);
    throw err;
  }
}
