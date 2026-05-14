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
const VERIFY_TTL_SECONDS = 15 * 60; // 10 minutes

export function verifyKey(email: string) {
  return `${VERIFY_PREFIX}${email.toLowerCase()}`;
}

export async function storeVerificationCode(email: string, code: string) {
  await redis.set(verifyKey(email), code, { ex: VERIFY_TTL_SECONDS });
}

export async function getVerificationCode(email: string) {
  return redis.get<string>(verifyKey(email));
}
