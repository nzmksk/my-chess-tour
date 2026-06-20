import { Redis } from "@upstash/redis";

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!url || !token) {
  throw new Error(
    "Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN environment variable",
  );
}

export const redis = new Redis({ url, token });

const VERIFY_PREFIX = "verify:";
const VERIFY_TTL_SECONDS = 15 * 60; // 15 minutes

export function verifyKey(email: string) {
  return `${VERIFY_PREFIX}${email.toLowerCase()}`;
}

export async function storeVerificationCode(email: string, code: string) {
  await redis.set(verifyKey(email), code, { ex: VERIFY_TTL_SECONDS });
}

export async function getVerificationCode(email: string) {
  return redis.get<string>(verifyKey(email));
}

// ── Rate limiting ───────────────────────────────────────────────────────────

const RESEND_COOLDOWN_PREFIX = "resend-cooldown:";
// Mirrors the client-side resend cooldown in VerifyForm so UI and server agree.
const RESEND_COOLDOWN_SECONDS = 15 * 60; // 15 minutes

const VERIFY_ATTEMPTS_PREFIX = "verify-attempts:";
// Wrong codes allowed before verification is locked until the code window ends.
export const MAX_VERIFY_ATTEMPTS = 5;

function resendCooldownKey(email: string) {
  return `${RESEND_COOLDOWN_PREFIX}${email.toLowerCase()}`;
}

function verifyAttemptsKey(email: string) {
  return `${VERIFY_ATTEMPTS_PREFIX}${email.toLowerCase()}`;
}

// Atomically start the resend cooldown. Returns the seconds remaining when the
// caller is still within an active cooldown (request should be rejected), or 0
// when the cooldown was freshly started (request may proceed). Uses SET NX so
// concurrent requests can't both pass the check.
export async function startResendCooldown(email: string): Promise<number> {
  const key = resendCooldownKey(email);
  const set = await redis.set(key, "1", {
    ex: RESEND_COOLDOWN_SECONDS,
    nx: true,
  });
  if (set === null) {
    const ttl = await redis.ttl(key);
    return ttl > 0 ? ttl : RESEND_COOLDOWN_SECONDS;
  }
  return 0;
}

// Release the cooldown — used to roll back when a resend fails before the email
// is actually sent, so the user isn't locked out over a failed attempt.
export async function clearResendCooldown(email: string): Promise<void> {
  await redis.del(resendCooldownKey(email));
}

// Count a failed verification attempt and return the new total. The counter
// expires with the code window so a fresh code starts from a clean slate.
export async function recordVerifyAttempt(email: string): Promise<number> {
  const key = verifyAttemptsKey(email);
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, VERIFY_TTL_SECONDS);
  }
  return count;
}

export async function getVerifyAttempts(email: string): Promise<number> {
  const count = await redis.get<number>(verifyAttemptsKey(email));
  return count ?? 0;
}

export async function resetVerifyAttempts(email: string): Promise<void> {
  await redis.del(verifyAttemptsKey(email));
}
