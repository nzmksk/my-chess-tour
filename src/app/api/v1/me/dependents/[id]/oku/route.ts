import { NextRequest, NextResponse } from "next/server";
import { removeOkuDocument, submitOkuDocument } from "@/services/oku/document";
import { resolveDependentForCaller } from "@/services/guardianship/resolve-dependent";
import { withAuditContext } from "@/services/supabase/audit-context";

type RouteContext = { params: Promise<{ id: string }> };

async function handlePost(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const { id } = await context.params;
  const route = "POST /api/v1/me/dependents/[id]/oku";
  const resolved = await resolveDependentForCaller(id, route);
  if (!resolved.ok) return resolved.response;
  return submitOkuDocument(request, {
    actorId: resolved.guardianId,
    subjectId: resolved.dependent.id,
    route,
  });
}

async function handleDelete(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const { id } = await context.params;
  const route = "DELETE /api/v1/me/dependents/[id]/oku";
  const resolved = await resolveDependentForCaller(id, route);
  if (!resolved.ok) return resolved.response;
  return removeOkuDocument({
    actorId: resolved.guardianId,
    subjectId: resolved.dependent.id,
    route,
  });
}

export const POST = withAuditContext("dependent.oku.submit", handlePost);
export const DELETE = withAuditContext("dependent.oku.remove", handleDelete);
