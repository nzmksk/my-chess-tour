import type { Metadata } from "next";
import NavBar from "@/components/NavBar";
import { getAccountClaimByToken } from "@/services/guardianship/account-claims";
import ClaimClient, { type ClaimSummary } from "./_components/ClaimClient";

export const metadata: Metadata = {
  title: "Set Up Your Account",
  description: "Take over the player record someone set up for you.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function AccountClaimPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let claim: ClaimSummary | null = null;
  let loadFailed = false;
  try {
    const view = await getAccountClaimByToken(token);
    claim = view
      ? {
          state: view.state,
          email: view.email,
          playerFirstName: view.playerFirstName,
          guardianName: view.guardianName,
        }
      : null;
  } catch (err) {
    console.error("Account claim page: lookup failed", err);
    loadFailed = true;
  }

  return (
    <div className="bg-bg-base flex-1">
      <NavBar />
      <ClaimClient token={token} claim={claim} loadFailed={loadFailed} />
    </div>
  );
}
