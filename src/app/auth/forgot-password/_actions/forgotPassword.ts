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

  // Generate only the recovery token (no email is sent by Supabase). We build
  // our own callback link from `hashed_token` and verify it server-side with
  // `verifyOtp`, which — unlike the PKCE `code` flow — does not depend on a
  // `code_verifier` cookie that an admin-generated link never sets.
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "recovery",
    email,
  });

  // Always succeed to prevent email enumeration attacks. A failure to send
  // (e.g. Resend outage) must not surface a different response than success,
  // so swallow the error here and log it for observability.
  if (!error && data.properties?.hashed_token) {
    const params = new URLSearchParams({
      token_hash: data.properties.hashed_token,
      type: "recovery",
      next: "/auth/update-password",
    });
    const resetLink = `${process.env.NEXT_PUBLIC_SITE_URL}/api/v1/auth/callback?${params.toString()}`;
    try {
      await sendPasswordResetEmail(email, resetLink);
    } catch (sendError) {
      console.error("Failed to send password reset email:", sendError);
    }
  }

  return { error: null, submitted: true };
}
