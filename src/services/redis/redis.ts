import { Redis } from "@upstash/redis";

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const VERIFY_PREFIX = "verify:";
const VERIFY_TTL_SECONDS = 10 * 60; // 10 minutes

export function verifyKey(email: string) {
  return `${VERIFY_PREFIX}${email.toLowerCase()}`;
}

export async function storeVerificationCode(email: string, code: string) {
  await redis.set(verifyKey(email), code, { ex: VERIFY_TTL_SECONDS });
}

export async function getVerificationCode(email: string) {
  return redis.get<string>(verifyKey(email));
}
