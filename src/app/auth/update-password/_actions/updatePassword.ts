"use server";

import { redirect } from "next/navigation";
import { validateUpdatePasswordForm } from "@/services/auth/auth-validation";
import { createClient } from "@/services/supabase/server";
import {
  INTERNAL_ERROR_MESSAGE,
  logInternalError,
} from "@/lib/http/internal-error";
import type { UpdatePasswordState } from "../types";

export async function updatePassword(
  _prevState: UpdatePasswordState,
  formData: FormData,
): Promise<UpdatePasswordState> {
  const password = formData.get("password")?.toString() ?? "";
  const confirmPassword = formData.get("confirmPassword")?.toString() ?? "";
  const invited = formData.get("invited") === "1";

  const { errors, isValid } = validateUpdatePasswordForm(
    password,
    confirmPassword,
  );

  if (!isValid) {
    return { error: null, fieldErrors: errors };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    return { error: describeUpdateError(error), fieldErrors: {} };
  }

  // The recovery or invite link created an authenticated session. Clear it so
  // the user re-authenticates with their new password instead of landing on the
  // login page while silently still signed in.
  await supabase.auth.signOut();

  redirect(
    `/auth/login?message=${invited ? "account-ready" : "password-updated"}`,
  );
}

// The auth server's messages are not all written for end users (an unexpected
// failure can surface a database error), so only the cases a user can act on
// get their own text; everything else is logged and replaced.
function describeUpdateError(error: { code?: string; name?: string; message: string }): string {
  if (error.code === "same_password") {
    return "Your new password must be different from your current password.";
  }
  if (error.code === "weak_password") {
    // The auth server's own wording of the password policy that was not met.
    return error.message;
  }
  if (
    error.name === "AuthSessionMissingError" ||
    error.code === "session_not_found" ||
    error.code === "session_expired"
  ) {
    return "Your password reset link has expired. Please request a new one.";
  }
  logInternalError("Update password: updateUser failed", error);
  return INTERNAL_ERROR_MESSAGE;
}
