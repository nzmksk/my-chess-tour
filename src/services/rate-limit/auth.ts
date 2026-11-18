import { redis, VERIFY_TTL_SECONDS } from "@/services/redis/redis";
import { countHit, peekCount, resetCount } from "./window";

// The per-email auth counters. They live apart from the per-route RATE_LIMITS
// because each one drives its own UX (attempts remaining, a lockout timer, a
// silent resend cooldown) rather than a plain 429, but they count with the same
// fixed-window primitive.

// ── Signup verification code ────────────────────────────────────────────────

// Wrong codes allowed before verification is locked until the code window ends.
export const MAX_VERIFY_ATTEMPTS = 5;

// Mirrors the client-side resend cooldown in VerifyForm so UI and server agree.
const RESEND_COOLDOWN_SECONDS = 15 * 60;

function resendCooldownKey(email: string) {
  return `resend-cooldown:${email.toLowerCase()}`;
}

function verifyAttemptsKey(email: string) {
  return `verify-attempts:${email.toLowerCase()}`;
}

/**
 * Start the resend cooldown: one send per window. Returns the seconds remaining
 * when the caller is still within an active cooldown (request should be
 * rejected), or 0 when the cooldown was freshly started (request may proceed).
 * The count is atomic, so concurrent requests can't both pass.
 */
export async function startResendCooldown(email: string): Promise<number> {
  const { count, ttl } = await countHit(
    resendCooldownKey(email),
    RESEND_COOLDOWN_SECONDS,
  );
  return count > 1 ? ttl : 0;
}

// Release the cooldown — used to roll back when a resend fails before the email
// is actually sent, so the user isn't locked out over a failed attempt.
export async function clearResendCooldown(email: string): Promise<void> {
  await resetCount(resendCooldownKey(email));
}

// Count a failed verification attempt and return the new total. The counter
// expires with the code window so a fresh code starts from a clean slate.
export async function recordVerifyAttempt(email: string): Promise<number> {
  return (await countHit(verifyAttemptsKey(email), VERIFY_TTL_SECONDS)).count;
}

export async function getVerifyAttempts(email: string): Promise<number> {
  return peekCount(verifyAttemptsKey(email));
}

export async function resetVerifyAttempts(email: string): Promise<void> {
  await resetCount(verifyAttemptsKey(email));
}

// ── Login lockout ───────────────────────────────────────────────────────────

// Wrong passwords allowed per email within the window before a lockout.
export const MAX_LOGIN_ATTEMPTS = 5;
export const LOGIN_LOCK_SECONDS = 15 * 60;

function loginAttemptsKey(email: string) {
  return `login:attempts:${email.toLowerCase()}`;
}

function loginLockKey(email: string) {
  return `login:lock:${email.toLowerCase()}`;
}

/** Seconds left on the email's login lockout, or 0 when it isn't locked. */
export async function getLoginLock(email: string): Promise<number> {
  const ttl = await redis.ttl(loginLockKey(email));
  // -2: no lock. -1: a lock with no expiry, which set() below never writes;
  // treat it as a full lockout rather than none.
  if (ttl === -1) return LOGIN_LOCK_SECONDS;
  return Math.max(0, ttl);
}

/**
 * Count a wrong password. Returns the attempts left before a lockout, and
 * locks the email for LOGIN_LOCK_SECONDS when that reaches 0.
 */
export async function recordLoginFailure(email: string): Promise<number> {
  const { count } = await countHit(loginAttemptsKey(email), LOGIN_LOCK_SECONDS);
  const remaining = Math.max(0, MAX_LOGIN_ATTEMPTS - count);
  if (remaining === 0) {
    await redis.set(loginLockKey(email), 1, { ex: LOGIN_LOCK_SECONDS });
    await resetCount(loginAttemptsKey(email));
  }
  return remaining;
}

/** Drop failed-attempt tracking once the password has been proven. */
export async function clearLoginAttempts(email: string): Promise<void> {
  await redis.del(loginAttemptsKey(email), loginLockKey(email));
}
