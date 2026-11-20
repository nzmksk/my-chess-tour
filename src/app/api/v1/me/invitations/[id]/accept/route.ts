import { respondToOwnInvitation } from "@/app/api/v1/me/invitations/_lib/respond";
import { NextRequest, NextResponse } from "next/server";
import { withAuditContext } from "@/services/supabase/audit-context";

// Answering emails the inviter, and email templates are read from disk.
export const runtime = "nodejs";

/** Accept one of the signed-in user's own invitations (see respondToOwnInvitation). */
async function handlePost(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return respondToOwnInvitation(id, true);
}

export const POST = withAuditContext("invitation.accept", handlePost);
