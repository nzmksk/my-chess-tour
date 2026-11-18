import { NextResponse } from "next/server";
import { listAdminAwards } from "@/services/prizes/awards";
import { internalErrorResponse } from "@/lib/http/internal-error";
import { authorizePlatformAdmin } from "./authorize";

/** The admin prize queue (#523): awards to review, in flight, and recently settled. */
export async function GET(): Promise<NextResponse> {
  const auth = await authorizePlatformAdmin("Admin prize awards");
  if (!auth.ok) return auth.response;

  const result = await listAdminAwards();
  if (!result.ok) {
    return internalErrorResponse("Admin prize awards: failed to list awards", result.error);
  }
  return NextResponse.json({ data: result.awards });
}
