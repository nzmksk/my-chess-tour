import { redirect } from "next/navigation";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import { createClient } from "@/services/supabase/server";
import PublicProfile from "./_components/PublicProfile";
import { getPublicProfile } from "./_data/getPublicProfile";

export const metadata: Metadata = {
  title: "My Profile",
  description: "Your public chess player profile.",
};

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const profile = await getPublicProfile(user.id);

  if (!profile) {
    redirect("/auth/login");
  }

  return (
    <div className="bg-bg-base min-h-screen">
      <NavBar />
      <PublicProfile profile={profile} isOwner={true} />
    </div>
  );
}
