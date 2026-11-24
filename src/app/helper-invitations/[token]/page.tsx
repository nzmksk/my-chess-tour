import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import { getAuthClaims } from "@/services/supabase/permission";
import {
  getHelperInvitationByToken,
  type HelperInvitationView,
} from "@/services/guardianship/helpers";
import HelperInvitationClient from "./_components/HelperInvitationClient";

export const metadata: Metadata = {
  title: "Helper Invitation",
  description: "Accept or decline an invitation to help a player.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function HelperInvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let invitation: HelperInvitationView | null = null;
  let loadFailed = false;
  try {
    invitation = await getHelperInvitationByToken(token);
  } catch (err) {
    console.error("Helper invitation page: lookup failed", err);
    loadFailed = true;
  }

  const claims = await getAuthClaims();

  return (
    <div className="bg-bg-base flex-1">
      <NavBar />
      <HelperInvitationClient
        token={token}
        invitation={invitation}
        loadFailed={loadFailed}
        signedIn={claims !== null}
        viewerEmail={claims?.email ?? null}
      />
    </div>
  );
}
