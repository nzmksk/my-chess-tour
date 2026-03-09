"use server";

import { redirect } from "next/navigation";
import { validateUpdatePasswordForm } from "@/lib/auth-validation";
import { createClient } from "@/lib/supabase/server";
import type { UpdatePasswordState } from "./types";

export async function updatePassword(
  _prevState: UpdatePasswordState,
  formData: FormData,
): Promise<UpdatePasswordState> {
  const password = formData.get("password")?.toString() ?? "";
  const confirmPassword = formData.get("confirmPassword")?.toString() ?? "";

  const { errors, isValid } = validateUpdatePasswordForm(password, confirmPassword);

  if (!isValid) {
    return { error: null, fieldErrors: errors };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    return { error: error.message, fieldErrors: {} };
  }

  redirect("/login");
}
