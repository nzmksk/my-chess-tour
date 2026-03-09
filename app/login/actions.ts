"use server";

import { redirect } from "next/navigation";
import { validateLoginForm } from "@/lib/auth-validation";
import { createClient } from "@/lib/supabase/server";
import { redis } from "@/lib/redis";
import type { LoginState } from "./types";

const MAX_ATTEMPTS = 5;
const LOCK_DURATION_SECONDS = 15 * 60; // 15 minutes

export async function login(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = formData.get("email")?.toString().trim() ?? "";
  const password = formData.get("password")?.toString() ?? "";
  const keepSignedIn = formData.get("keepSignedIn") === "on";

  const { errors, isValid } = validateLoginForm({ email, password, keepSignedIn });

  if (!isValid) {
    const firstError = errors.email ?? errors.password ?? "Please fill in all required fields.";
    return { error: firstError, attemptsRemaining: null, locked: false, lockedSeconds: null };
  }

  const lockKey = `login:lock:${email.toLowerCase()}`;
  const attemptsKey = `login:attempts:${email.toLowerCase()}`;

  const isLocked = await redis.exists(lockKey);
  if (isLocked) {
    const ttl = await redis.ttl(lockKey);
    return { error: null, attemptsRemaining: 0, locked: true, lockedSeconds: ttl };
  }

  const supabase = await createClient();
  const { error: authError } = await supabase.auth.signInWithPassword({ email, password });

  if (authError) {
    const attempts = await redis.incr(attemptsKey);
    await redis.expire(attemptsKey, LOCK_DURATION_SECONDS);

    const remaining = Math.max(0, MAX_ATTEMPTS - attempts);

    if (remaining === 0) {
      await redis.set(lockKey, 1, { ex: LOCK_DURATION_SECONDS });
      await redis.del(attemptsKey);
      return {
        error: null,
        attemptsRemaining: 0,
        locked: true,
        lockedSeconds: LOCK_DURATION_SECONDS,
      };
    }

    return {
      error: "Incorrect email or password.",
      attemptsRemaining: remaining,
      locked: false,
      lockedSeconds: null,
    };
  }

  // Success — clear any failed-attempt tracking
  await redis.del(attemptsKey);
  await redis.del(lockKey);

  redirect("/tournaments");
}
