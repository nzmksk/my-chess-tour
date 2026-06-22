import type { Metadata } from "next";
import { redirect } from "next/navigation";
import NavBar from "@/components/NavBar";
import { getAuthClaims } from "@/services/supabase/permission";
import ApplyForm from "./_components/ApplyForm";

export const metadata: Metadata = {
  title: "Apply as Organizer | MY Chess Tour",
};

export const dynamic = "force-dynamic";

export default async function OrganizerApplyPage() {
  const claims = await getAuthClaims();

  if (!claims) {
    redirect("/auth/login?next=/organizations/apply");
  }

  return (
    <div className="bg-bg-base min-h-screen">
      <NavBar />
      <main className="mx-auto max-w-2xl px-6 py-10 md:px-10">
        <ApplyForm />
      </main>
    </div>
  );
}
