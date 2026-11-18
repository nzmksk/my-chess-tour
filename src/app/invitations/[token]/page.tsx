import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import { getAuthClaims } from "@/services/supabase/permission";
import {
  getInvitationByToken,
  type InvitationView,
} from "@/services/organizations/invitations";
import InvitationClient from "./_components/InvitationClient";

export const metadata: Metadata = {
  title: "Organization Invitation",
  description: "Accept or decline an invitation to join an organization.",
  // The URL is a bearer link; keep it out of search results and referrers.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

// Public on purpose (not under a protected prefix): the person may not have an
// account yet, and declining needs none. Accepting requires signing in as the
// invited address, which the accept route enforces.
export default async function InvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let invitation: InvitationView | null = null;
  let loadFailed = false;
  try {
    invitation = await getInvitationByToken(token);
  } catch (err) {
    console.error("Invitation page: lookup failed", err);
    loadFailed = true;
  }

  const claims = await getAuthClaims();

  return (
    <div className="bg-bg-base flex-1">
      <NavBar />
      <InvitationClient
        token={token}
        invitation={invitation}
        loadFailed={loadFailed}
        viewerEmail={claims?.email ?? null}
      />
    </div>
  );
}
