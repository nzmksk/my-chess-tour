import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/services/supabase/server";
import { supabaseAdmin } from "@/services/supabase/admin";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  const supabase = await createClient();

  // Preferred flow: a server-generated link carries `token_hash` + `type`,
  // verified with `verifyOtp`. The `code` branch remains as a fallback for any
  // PKCE-style links still in flight.
  if (tokenHash && type) {
    const { data, error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      if (type === "invite" && data.user) {
        await markInvitedUserVerified(data.user.id);
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(
    `${origin}/auth/forgot-password?error=invalid_link`,
  );
}

// An organization invite is only ever sent to the invited address, so opening
// its link proves the member owns that address. Record that, or their first
// sign-in would stop them for the signup verification code as well. A failure
// costs only that extra step, so it is logged rather than failing the link.
async function markInvitedUserVerified(authUserId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("users")
    .update({ is_verified: true, verified_at: new Date().toISOString() })
    .eq("auth_user_id", authUserId)
    .eq("is_verified", false);
  if (error) {
    console.error("Failed to mark invited user verified:", authUserId, error);
  }
}
