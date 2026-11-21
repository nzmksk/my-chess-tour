import { redis } from "@/services/redis/redis";

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
  return { count, ttl: ttl > 0 ? ttl : windowSeconds };
}

export async function hitWindow(
  key: string,
  max: number,
  windowSeconds: number,
): Promise<number> {
  const { count, ttl } = await countHit(key, windowSeconds);
  return count > max ? ttl : 0;
}

export async function peekCount(key: string): Promise<number> {
  return (await redis.get<number>(key)) ?? 0;
}

export async function resetCount(key: string): Promise<void> {
  await redis.del(key);
}
