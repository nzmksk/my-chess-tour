"use server";

import { validateForgotPasswordForm } from "@/lib/auth-validation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendPasswordResetEmail } from "@/lib/email";
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

  const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?next=/auth/update-password`;
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo },
  });

  // Always succeed to prevent email enumeration attacks
  if (!error && data.properties.action_link) {
    await sendPasswordResetEmail(email, data.properties.action_link);
  }

  return { error: null, submitted: true };
}
