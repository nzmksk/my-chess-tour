import { supabaseAdmin } from "@/services/supabase/admin";
import { createClient } from "@/services/supabase/server";
import { getAuthClaims } from "@/services/supabase/permission";
import {
  sendCancellationReviewEmail,
  sendTournamentCancellationEmail,
} from "@/services/email/email";
import {
  PURGE_PROFILE,
  TOURNAMENTS_LIST_TAG,
  tournamentTag,
} from "@/lib/cache-tags";
import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Registration states that still represent an active spot in the tournament and
// therefore warrant a cancellation notice. Players whose registration already
// failed, expired, or was forfeited are intentionally excluded.
const NOTIFIABLE_STATUSES = ["confirmed", "pending_payment"];

interface RegistrationRecipient {
  user: { email: string | null; first_name: string | null } | null;
}

// Emails every player with an active registration that the tournament has been
// cancelled. Best-effort: a failure to load recipients or send an email is
// logged but never fails the cancellation, which has already been committed.
async function notifyRegisteredPlayers(
  tournamentId: string,
  tournamentName: string,
): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("registrations")
    .select("user:users(email, first_name)")
    .eq("tournament_id", tournamentId)
    .in("status", NOTIFIABLE_STATUSES);

  if (error) {
    console.error(
      `Failed to load registrations for cancelled tournament ${tournamentId}:`,
      error,
    );
    return;
  }

  const recipients = (data as unknown as RegistrationRecipient[])
    .map((r) => r.user)
    .filter((u): u is { email: string; first_name: string | null } =>
      Boolean(u?.email),
    );

  const results = await Promise.allSettled(
    recipients.map((u) =>
      sendTournamentCancellationEmail(u.email, {
        playerName: u.first_name ?? "Player",
        tournamentName,
      }),
    ),
  );

  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) {
    console.error(
      `Failed to send ${failed}/${recipients.length} cancellation email(s) for tournament ${tournamentId}`,
    );
  }
}

// Roles that grant access to cancel a tournament — the same owner/admin gate
// enforced when a cancellation request is filed (see authorizeTournamentManager).
// These members are the ones notified of the admin's review decision.
const CANCEL_REVIEWER_ROLES = ["owner", "admin"];

interface MembershipRecipient {
  user: { email: string | null; first_name: string | null } | null;
  roles: { name: string } | null;
}

// Emails the organization about the outcome of their cancellation request
// (approved or declined). Recipients are the owner/admin members who can cancel
// tournaments, plus the organization's own contact email (organizations.email) —
// deduplicated by address so a member who shares the org email isn't notified
// twice. Best-effort: any failure to load recipients or send an email is logged
// but never fails the review.
async function notifyCancellationReviewers(
  organizationId: string,
  params: {
    tournamentName: string;
    approved: boolean;
    rejectionReason?: string;
  },
): Promise<void> {
  const [membersRes, orgRes] = await Promise.all([
    supabaseAdmin
      .from("organization_memberships")
      .select("user:users(email, first_name), roles!inner(name)")
      .eq("organization_id", organizationId),
    supabaseAdmin
      .from("organizations")
      .select("name, email")
      .eq("id", organizationId)
      .single(),
  ]);

  if (membersRes.error) {
    console.error(
      `Failed to load members for cancellation review (org ${organizationId}):`,
      membersRes.error,
    );
    return;
  }

  // Deduplicate recipients by lowercased email. Owner/admin members are added
  // first (keyed by their name); the org contact email is added only if no
  // member already covers that address.
  const recipients = new Map<string, { email: string; name: string }>();

  for (const m of membersRes.data as unknown as MembershipRecipient[]) {
    if (!m.roles || !CANCEL_REVIEWER_ROLES.includes(m.roles.name)) continue;
    const email = m.user?.email;
    if (!email) continue;
    recipients.set(email.toLowerCase(), {
      email,
      name: m.user?.first_name ?? "there",
    });
  }

  const org = orgRes.data as { name: string | null; email: string | null } | null;
  if (org?.email && !recipients.has(org.email.toLowerCase())) {
    recipients.set(org.email.toLowerCase(), {
      email: org.email,
      name: org.name ?? "there",
    });
  }

  const results = await Promise.allSettled(
    [...recipients.values()].map((r) =>
      sendCancellationReviewEmail(r.email, {
        recipientName: r.name,
        tournamentName: params.tournamentName,
        approved: params.approved,
        rejectionReason: params.rejectionReason,
      }),
    ),
  );

  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) {
    console.error(
      `Failed to send ${failed}/${recipients.size} cancellation review email(s) for org ${organizationId}`,
    );
  }
}

async function checkAdminAccess(
  supabase: Awaited<ReturnType<typeof createClient>>,
) {
  const claims = await getAuthClaims();
  if (!claims) {
    return { user: null, isAdmin: false, error: null };
  }
  const { data: isAdmin, error } = await supabase.rpc("has_global_permission", {
    p_user_id: claims.id,
    p_permission: "platform.manage",
  });
  return { user: claims, isAdmin: !!isAdmin, error };
}

// Admin approves/rejects an organizer's tournament cancellation request.
// Approve flips the tournament to 'cancelled' atomically (via the RPC); refunds
// to registered players are initiated separately (wired up later).
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid request ID" } },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    user,
    isAdmin,
    error: permissionError,
  } = await checkAdminAccess(supabase);

  if (!user) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
      { status: 401 },
    );
  }

  if (permissionError) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: permissionError.message } },
      { status: 500 },
    );
  }

  if (!isAdmin) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Admin access required" } },
      { status: 403 },
    );
  }

  let body: { action?: string; rejection_reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid request body" } },
      { status: 400 },
    );
  }

  const { action, rejection_reason } = body;

  if (action !== "approve" && action !== "reject") {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "action must be 'approve' or 'reject'",
        },
      },
      { status: 400 },
    );
  }

  if (
    action === "reject" &&
    (typeof rejection_reason !== "string" || !rejection_reason.trim())
  ) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "rejection_reason must be a non-empty string when rejecting",
        },
      },
      { status: 400 },
    );
  }

  const { data, error } = await supabaseAdmin.rpc(
    "review_tournament_cancellation",
    {
      p_request_id: id,
      p_reviewer_id: user.id,
      p_action: action,
      p_rejection_reason: action === "reject" ? rejection_reason!.trim() : null,
    },
  );

  if (error) {
    if (error.code === "P0002") {
      return NextResponse.json(
        {
          error: {
            code: "NOT_FOUND",
            message: "Cancellation request not found",
          },
        },
        { status: 404 },
      );
    }
    if (error.code === "P0001") {
      return NextResponse.json(
        {
          error: {
            code: "CONFLICT",
            message: "This cancellation request has already been reviewed",
          },
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: error.message } },
      { status: 500 },
    );
  }

  const tournamentId = (data as { tournament_id: string }).tournament_id;
  const { data: t } = await supabaseAdmin
    .from("tournaments")
    .select("slug, name, organization_id")
    .eq("id", tournamentId)
    .single();
  const tournamentName = t?.name ?? "your tournament";

  // On approval the tournament left the public 'published' listing; drop it from
  // the caches so it disappears from the browse list and its detail page, and
  // notify registered players that their tournament is off.
  if (action === "approve") {
    revalidateTag(TOURNAMENTS_LIST_TAG, PURGE_PROFILE);
    if (t?.slug) revalidateTag(tournamentTag(t.slug), PURGE_PROFILE);

    await notifyRegisteredPlayers(tournamentId, tournamentName);
  }

  // Notify the organization members who can cancel tournaments of the review
  // outcome — for both approvals and rejections.
  if (t?.organization_id) {
    await notifyCancellationReviewers(t.organization_id, {
      tournamentName,
      approved: action === "approve",
      rejectionReason:
        action === "reject" ? rejection_reason!.trim() : undefined,
    });
  }

  return NextResponse.json({ data }, { status: 200 });
}
