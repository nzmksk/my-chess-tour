import { redis } from "@/services/redis/redis";

/**
 * The one counting primitive behind every rate limit: a fixed window per key.
 *
 * INCR, EXPIRE NX and TTL run as one MULTI/EXEC transaction, so a counter can
 * never be left without an expiry (the old incr-then-expire pairs could, if the
 * second call failed, lock a key out for good) and it costs one round trip.
 * EXPIRE NX only starts the clock on the first hit, so the window is fixed: it
 * ends `windowSeconds` after the first attempt, however many follow.
 */
export async function countHit(
  key: string,
  windowSeconds: number,
): Promise<{ count: number; ttl: number }> {
  const [count, , ttl] = await redis
    .multi()
    .incr(key)
    .expire(key, windowSeconds, "nx")
    .ttl(key)
    .exec<[number, number, number]>();
  // TTL is -1/-2 only if the key changed under us; assume a full window.
  return { count, ttl: ttl > 0 ? ttl : windowSeconds };
}

/**
 * Count one attempt and return the seconds until the window resets when `max`
 * is exceeded, or 0 while the attempt is within the limit.
 */
export async function hitWindow(
  key: string,
  max: number,
  windowSeconds: number,
): Promise<number> {
  const { count, ttl } = await countHit(key, windowSeconds);
  return count > max ? ttl : 0;
}

/** The current count for a key, without counting an attempt. */
export async function peekCount(key: string): Promise<number> {
  return (await redis.get<number>(key)) ?? 0;
}

/** Drop a counter, e.g. after a successful login or verification. */
export async function resetCount(key: string): Promise<void> {
  await redis.del(key);
}
