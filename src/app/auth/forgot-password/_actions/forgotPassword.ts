"use server";

import { validateForgotPasswordForm } from "@/services/auth/auth-validation";
import { supabaseAdmin } from "@/services/supabase/admin";
import { sendPasswordResetEmail } from "@/services/email/email";
import { ForgotPasswordState } from "../types";

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

  const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL}/api/v1/auth/callback?next=/auth/update-password`;
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo },
  });

  // Always succeed to prevent email enumeration attacks. A failure to send
  // (e.g. Resend outage) must not surface a different response than success,
  // so swallow the error here and log it for observability.
  if (!error && data.properties.action_link) {
    try {
      await sendPasswordResetEmail(email, data.properties.action_link);
    } catch (sendError) {
      console.error("Failed to send password reset email:", sendError);
    }
  }

  return { error: null, submitted: true };
}
