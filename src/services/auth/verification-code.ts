import { storeVerificationCode } from "@/services/redis/redis";
import {
  startResendCooldown,
  clearResendCooldown,
} from "@/services/rate-limit/auth";
import { sendVerificationEmail } from "@/services/email/email";

export function generateCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

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
