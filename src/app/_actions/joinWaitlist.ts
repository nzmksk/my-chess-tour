"use server";

import { createClient } from "@/services/supabase/server";

export async function joinWaitlist(
  _prevState: { error: string | null; submitted: boolean },
  formData: FormData,
): Promise<{ error: string | null; submitted: boolean }> {
  const email = formData.get("email")?.toString().trim();

  if (!email)
    return { error: "Please enter your email address.", submitted: false };

  const supabase = await createClient();
  const { error } = await supabase.from("waitlist").insert({ email });

  if (error) {
    if (error.code === "23505") {
      // Email already on the waitlist — the desired state is achieved, so return
      // success to keep this action idempotent.
      return { error: null, submitted: true };
    }
    console.error(error);
    return {
      error:
        "Something went wrong. Please contact us at mychesstour@gmail.com for support.",
      submitted: false,
    };
  }

  return { error: null, submitted: true };
}
