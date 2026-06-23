"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { validateLoginForm } from "@/services/auth/auth-validation";
import { createClient } from "@/services/supabase/server";
import { supabaseAdmin } from "@/services/supabase/admin";
import { redis } from "@/services/redis/redis";
import { sendSignupVerificationCode } from "@/services/auth/verification-code";
import { SIGNUP_STEP_COOKIE, SIGNUP_STEP_MAX_AGE } from "@/lib/signup-cookie";
import { SESSION_ONLY_COOKIE } from "@/lib/session-cookie";
import type { LoginState } from "../types";

const MAX_ATTEMPTS = 5;
const LOCK_DURATION_SECONDS = 15 * 60; // 15 minutes

export async function login(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = formData.get("email")?.toString().trim() ?? "";
  const password = formData.get("password")?.toString() ?? "";
  const keepSignedIn = formData.get("keepSignedIn") === "on";
  const rawRedirectTo = formData.get("redirectTo")?.toString() ?? "";
  const safeRedirectTo =
    rawRedirectTo.startsWith("/") && !rawRedirectTo.startsWith("//")
      ? rawRedirectTo
      : "/tournaments";

  const { errors, isValid } = validateLoginForm({
    email,
    password,
    keepSignedIn,
  });

  if (!isValid) {
    const firstError =
      errors.email ?? errors.password ?? "Please fill in all required fields.";
    return {
      error: firstError,
      attemptsRemaining: null,
      locked: false,
      lockedSeconds: null,
    };
  }

  const lockKey = `login:lock:${email.toLowerCase()}`;
  const attemptsKey = `login:attempts:${email.toLowerCase()}`;

  const isLocked = await redis.exists(lockKey);
  if (isLocked) {
    const ttl = await redis.ttl(lockKey);
    return {
      error: null,
      attemptsRemaining: 0,
      locked: true,
      lockedSeconds: ttl,
    };
  }

  // When the user does not keep signed in, write the auth cookies as
  // session-only so they clear when the browser closes.
  const supabase = await createClient({ sessionOnly: !keepSignedIn });
  const { error: authError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

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

  // Check that the account has been verified
  const { data: userRecord } = await supabaseAdmin
    .from("users")
    .select("is_verified")
    .eq("email", email.toLowerCase().trim())
    .maybeSingle();

  if (!userRecord?.is_verified) {
    // Correct password — drop any failed-attempt tracking before routing on.
    await redis.del(attemptsKey);
    await redis.del(lockKey);

    // Don't dead-end on an error message. Sign them out (this device only),
    // send a fresh code, and signal the client to carry them into the
    // verification step.
    await supabase.auth.signOut({ scope: "local" });

    try {
      await sendSignupVerificationCode(email.toLowerCase().trim());
    } catch (err) {
      console.error("Failed to send verification code during login:", err);
    }

    // Allow the verify route (the proxy gates it on this step cookie).
    const cookieStore = await cookies();
    cookieStore.set(SIGNUP_STEP_COOKIE, "verify", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: SIGNUP_STEP_MAX_AGE,
    });

    return {
      error: null,
      attemptsRemaining: null,
      locked: false,
      lockedSeconds: null,
      needsVerification: true,
    };
  }

  // Success — clear any failed-attempt tracking
  await redis.del(attemptsKey);
  await redis.del(lockKey);

  // Record the persistence choice so middleware keeps the session session-only
  // on subsequent token refreshes. The marker is itself a session cookie.
  const cookieStore = await cookies();
  if (keepSignedIn) {
    cookieStore.delete(SESSION_ONLY_COOKIE);
  } else {
    cookieStore.set(SESSION_ONLY_COOKIE, "1", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
  }

  redirect(safeRedirectTo);
}
