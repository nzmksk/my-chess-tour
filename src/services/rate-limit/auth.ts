import { redis, VERIFY_TTL_SECONDS } from "@/services/redis/redis";
import { countHit, peekCount, resetCount } from "./window";

export const MAX_VERIFY_ATTEMPTS = 5;

const RESEND_COOLDOWN_SECONDS = 15 * 60;

function resendCooldownKey(email: string) {
  return `resend-cooldown:${email.toLowerCase()}`;
}

function verifyAttemptsKey(email: string) {
  return `verify-attempts:${email.toLowerCase()}`;
}

export async function startResendCooldown(email: string): Promise<number> {
  const { count, ttl } = await countHit(
    resendCooldownKey(email),
    RESEND_COOLDOWN_SECONDS,
  );
  return count > 1 ? ttl : 0;
}

export async function clearResendCooldown(email: string): Promise<void> {
  await resetCount(resendCooldownKey(email));
}

export async function recordVerifyAttempt(email: string): Promise<number> {
  return (await countHit(verifyAttemptsKey(email), VERIFY_TTL_SECONDS)).count;
}

export async function getVerifyAttempts(email: string): Promise<number> {
  return peekCount(verifyAttemptsKey(email));
}

export async function resetVerifyAttempts(email: string): Promise<void> {
  await resetCount(verifyAttemptsKey(email));
}

export const MAX_LOGIN_ATTEMPTS = 5;
export const LOGIN_LOCK_SECONDS = 15 * 60;

function loginAttemptsKey(email: string) {
  return `login:attempts:${email.toLowerCase()}`;
}

function loginLockKey(email: string) {
  return `login:lock:${email.toLowerCase()}`;
}

export async function getLoginLock(email: string): Promise<number> {
  const ttl = await redis.ttl(loginLockKey(email));
  if (ttl === -1) return LOGIN_LOCK_SECONDS;
  return Math.max(0, ttl);
}

export async function recordLoginFailure(email: string): Promise<number> {
  const { count } = await countHit(loginAttemptsKey(email), LOGIN_LOCK_SECONDS);
  const remaining = Math.max(0, MAX_LOGIN_ATTEMPTS - count);
  if (remaining === 0) {
    await redis.set(loginLockKey(email), 1, { ex: LOGIN_LOCK_SECONDS });
    await resetCount(loginAttemptsKey(email));
  }
  return remaining;
}

export async function clearLoginAttempts(email: string): Promise<void> {
  await redis.del(loginAttemptsKey(email), loginLockKey(email));
}
