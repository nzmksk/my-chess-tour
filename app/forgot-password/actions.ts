"use server";

import { validateForgotPasswordForm } from "@/lib/auth-validation";
import { createClient } from "@/lib/supabase/server";
import { ForgotPasswordState } from "./types";

export async function forgotPassword(
  _prevState: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const email = formData.get("email")?.toString().trim() ?? "";

  const { errors, isValid } = validateForgotPasswordForm(email);

  if (!isValid) {
    const firstError = errors.email ?? "Please enter a valid email address.";
    return { error: firstError, submitted: false };
  }

  const supabase = await createClient();

  // Always succeed to prevent email enumeration attacks
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?type=recovery`,
  });

  return { error: null, submitted: true };
}
