import { supabaseAdmin } from "@/services/supabase/admin";
import { createClient } from "@/services/supabase/server";
import { getAuthClaims } from "@/services/supabase/permission";
import { chipRefundOutcome, refundChipPurchase } from "@/services/chip/chip";
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

// A pending refund queued by review_tournament_cancellation, joined to the CHIP
// purchase id the refund is issued against (list_pending_cancellation_refunds).
interface PendingRefund {
  refund_id: string;
  registration_id: string;
  amount_cents: number;
  original_chip_purchase_id: string | null;
}

// How many CHIP refund calls to have in flight at once. Bounds the fan-out for a
// large tournament so we don't open hundreds of concurrent connections in a
// single request; settlement is idempotent so a re-run is always safe.
const REFUND_CONCURRENCY = 5;

// Issues the CHIP refund for one queued refund and settles it. Best-effort: any
// failure leaves the refund row pending (durable for retry) and is logged, never
// thrown — the tournament is already cancelled.
async function processCancellationRefund(refund: PendingRefund): Promise<void> {
  if (!refund.original_chip_purchase_id) {
    console.error(
      `Refund ${refund.refund_id}: registration payment has no CHIP purchase id; left pending`,
    );
    return;
  }

  let result;
  try {
    // No amount → full refund of what the player paid.
    result = await refundChipPurchase(refund.original_chip_purchase_id);
  } catch (err) {
    console.error(
      `Refund ${refund.refund_id}: CHIP refund call failed; left pending`,
      err,
    );
    return;
  }

  const outcome = chipRefundOutcome(result.status);
  if (outcome === "refunded") {
    // Cleared synchronously — settle now. The later payment.refunded webhook is an
    // idempotent no-op.
    const { error } = await supabaseAdmin.rpc("settle_refund", {
      p_refund_id: refund.refund_id,
      p_chip_refund_id: result.id,
      p_paid: true,
      p_payment_method: null,
    });
    if (error) {
      console.error(`Refund ${refund.refund_id}: settle_refund failed`, error);
    }
  } else if (outcome === "failed") {
    console.error(
      `Refund ${refund.refund_id}: CHIP reported failure synchronously; left pending`,
    );
  } else {
    // pending_refund — the webhook will settle it. Stamp the CHIP refund id for
    // traceability (webhook correlation itself goes via related_to, not this).
    const { error } = await supabaseAdmin
      .from("refunds")
      .update({ chip_refund_id: result.id })
      .eq("id", refund.refund_id);
    if (error) {
      console.error(
        `Refund ${refund.refund_id}: failed to record CHIP refund id`,
        error,
      );
    }
  }
}

// Fires the CHIP refund for every pending refund queued when the cancellation was
// approved. Best-effort and concurrency-capped: one player's failure never blocks
// the others or fails the (already-committed) cancellation. Settlement is
// idempotent, so re-running this is safe.
async function initiateCancellationRefunds(tournamentId: string): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc(
    "list_pending_cancellation_refunds",
    { p_tournament_id: tournamentId },
  );

  if (error) {
    console.error(
      `Failed to load pending refunds for cancelled tournament ${tournamentId}:`,
      error,
    );
    return;
  }

  const refunds = (data as PendingRefund[] | null) ?? [];
  for (let i = 0; i < refunds.length; i += REFUND_CONCURRENCY) {
    const batch = refunds.slice(i, i + REFUND_CONCURRENCY);
    await Promise.allSettled(batch.map(processCancellationRefund));
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
// Approve flips the tournament to 'cancelled' and queues a pending refund for
// every confirmed player atomically (via the RPC); we then fire those refunds
// through CHIP best-effort (initiateCancellationRefunds) — the webhook and
// settle_refund RPC finalise them.
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

    await initiateCancellationRefunds(tournamentId);
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
