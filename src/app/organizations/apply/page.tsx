import type { Metadata } from "next";
import { redirect } from "next/navigation";
import NavBar from "@/components/NavBar";
import { createClient } from "@/services/supabase/server";
import ApplyForm from "./_components/ApplyForm";

export const metadata: Metadata = {
  title: "Apply as Organizer | MY Chess Tour",
};

export const dynamic = "force-dynamic";

export default async function OrganizerApplyPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login?next=/organizations/applications");
  }

  return (
    <div className="min-h-screen bg-bg-base">
      <NavBar />
      <main className="max-w-2xl mx-auto px-6 md:px-10 py-10">
        <ApplyForm />
      </main>
    </div>
  );
}
