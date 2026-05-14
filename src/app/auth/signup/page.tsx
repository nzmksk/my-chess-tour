import { redirect } from "next/navigation";
import { Suspense } from "react";
import NavBar from "@/components/NavBar";
import SignUpForm from "./_components/SignUpForm";
import AuthCardSkeleton from "./_components/AuthCardSkeleton";
import { createClient } from "@/services/supabase/server";

export const metadata = {
  title: "Create Account — MY Chess Tour",
  description:
    "Sign up for MY Chess Tour — Malaysia's premier competitive chess circuit.",
};

export default async function SignUpPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect("/tournaments");

  return (
    <div className="min-h-screen bg-bg-base">
      <NavBar />
      <Suspense fallback={<AuthCardSkeleton rows={4} />}>
        <SignUpForm />
      </Suspense>
    </div>
  );
}
