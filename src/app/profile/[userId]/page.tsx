import { notFound } from "next/navigation";
import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import { createClient } from "@/services/supabase/server";
import PublicProfile from "../_components/PublicProfile";
import { getPublicProfile } from "../_data/getPublicProfile";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ userId: string }>;
}): Promise<Metadata> {
  const { userId } = await params;
  const profile = await getPublicProfile(userId);

  if (!profile) {
    return { title: "Player Not Found" };
  }

  const fullName = [profile.first_name, profile.last_name]
    .filter(Boolean)
    .join(" ");

  return {
    title: `${fullName} — Player Profile`,
    description: `View ${fullName}'s chess player profile and stats.`,
  };
}

export default async function PlayerProfilePage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const profile = await getPublicProfile(userId);

  if (!profile) {
    notFound();
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isOwner = user?.id === userId;

  return (
    <div className="bg-bg-base min-h-screen">
      <NavBar />
      <PublicProfile profile={profile} isOwner={isOwner} />
    </div>
  );
}
