import { respondToOwnInvitation } from "@/app/api/v1/me/invitations/_lib/respond";
import { NextRequest, NextResponse } from "next/server";

// Answering emails the inviter, and email templates are read from disk.
export const runtime = "nodejs";

/** Accept one of the signed-in user's own invitations (see respondToOwnInvitation). */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  return respondToOwnInvitation(id, true);
}
