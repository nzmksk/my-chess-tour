import { redirect } from "next/navigation";
import NavBar from "@/components/NavBar";
import LoginForm from "./_components/LoginForm";
import { createClient } from "@/services/supabase/server";

export const metadata = {
  title: "Sign In — MY Chess Tour",
  description: "Sign in to your MY Chess Tour account.",
};

export default async function LoginPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect("/tournaments");

  return (
    <div className="min-h-screen bg-bg-base">
      <NavBar />
      <LoginForm />
    </div>
  );
}
