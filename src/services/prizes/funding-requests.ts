import { revalidateTag } from "next/cache";
import { supabaseAdmin } from "@/services/supabase/admin";
import { cancelChipPurchase, createChipPurchase } from "@/services/chip/chip";
import {
  sendPrizeFundingRequestEmail,
  sendTournamentListedEmail,
} from "@/services/email/email";
import { sendToAll } from "@/services/email/recipients";
import { loadOrganizationRecipients } from "@/services/payouts/recipients";
import { afterResponse } from "@/lib/http/after-response";
import {
  PURGE_PROFILE,
  TOURNAMENTS_LIST_TAG,
  tournamentTag,
} from "@/lib/tournaments/cache-tags";
import { funderKey, type PrizesJson } from "@/lib/tournaments/prize-funding";
import { loadPrizePoolPosition } from "./pool";
import { prizeLabel } from "./notify";

type DbError = { code?: string; message: string };

export interface SyncPrizeFundingResult {
  error: DbError | null;
  released: boolean;
  linked: number;
  unlinked: number;
  missingContacts: string[];
}

interface ReconcileResult {
  created: string[];
  cancelled: { id: string; chip_transaction_id: string | null }[];
  missing_contacts: string[];
  released: boolean;
}

export async function syncPrizeFundingRequests(
  tournamentId: string,
  actorId: string | null,
): Promise<SyncPrizeFundingResult> {
  const { data, error } = await supabaseAdmin.rpc("reconcile_prize_funding_requests", {
    p_tournament_id: tournamentId,
    p_actor: actorId,
  });
  if (error) {
    return {
      error: { code: error.code, message: error.message },
      released: false,
      linked: 0,
      unlinked: 0,
      missingContacts: [],
    };
  }
  const result = data as ReconcileResult;

  await cancelPurchases(result.cancelled);
  const links = await createMissingFundingLinks({ tournamentId });

  if (result.missing_contacts.length > 0) {
    console.warn(
      `Prize funding for tournament ${tournamentId}: no address for ${result.missing_contacts.join(", ")}, so no link was sent`,
    );
  }
  if (result.released) await onTournamentListed(tournamentId);

  return {
    error: null,
    released: result.released,
    linked: links.linked,
    unlinked: links.failed,
    missingContacts: result.missing_contacts,
  };
}

async function cancelPurchases(
  cancelled: { id: string; chip_transaction_id: string | null }[],
): Promise<void> {
  const results = await Promise.allSettled(
    cancelled
      .filter((c) => c.chip_transaction_id)
      .map((c) => cancelChipPurchase(c.chip_transaction_id!)),
  );
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      console.error(
        `Prize funding ${cancelled[i].id}: failed to cancel its CHIP purchase`,
        r.reason instanceof Error ? r.reason.message : r.reason,
      );
    }
  });
}

interface UnlinkedRow {
  id: string;
  tournament_id: string;
  funder_name: string;
  funder_email: string;
  amount_cents: number;
}

interface RequestTournament {
  name: string;
  prizes: PrizesJson | null;
  organization: { name: string | null } | null;
}

export function prizesFundedBy(prizes: PrizesJson | null, funderName: string): string {
  const key = funderKey(funderName);
  const labels: string[] = [];
  for (const cat of prizes?.categories ?? []) {
    if (!cat.funding?.funder_name || funderKey(cat.funding.funder_name) !== key) continue;
    for (const e of cat.entries ?? []) {
      if ((e.amount_cents ?? 0) > 0) labels.push(prizeLabel(cat.name ?? "", e.place ?? ""));
    }
  }
  for (const sp of prizes?.special ?? []) {
    if (!sp.funding?.funder_name || funderKey(sp.funding.funder_name) !== key) continue;
    if ((sp.amount_cents ?? 0) > 0) labels.push(sp.name ?? "");
  }
  return labels.join(", ");
}

export async function createMissingFundingLinks({
  tournamentId,
}: { tournamentId?: string } = {}): Promise<{ linked: number; failed: number }> {
  let query = supabaseAdmin
    .from("prize_fundings")
    .select("id, tournament_id, funder_name, funder_email, amount_cents")
    .eq("status", "pending")
    .is("cancelled_at", null)
    .is("checkout_url", null)
    .order("created_at", { ascending: true });
  if (tournamentId) query = query.eq("tournament_id", tournamentId);

  const { data, error } = await query;
  if (error) {
    console.error("Prize funding: failed to list requests without a link", error.message);
    return { linked: 0, failed: 0 };
  }
  const rows = (data ?? []) as UnlinkedRow[];
  if (rows.length === 0) return { linked: 0, failed: 0 };

  const tournaments = new Map<string, RequestTournament | null>();
  for (const id of new Set(rows.map((r) => r.tournament_id))) {
    const { data: t, error: tErr } = await supabaseAdmin
      .from("tournaments")
      .select("name, prizes, organization:organizations(name)")
      .eq("id", id)
      .maybeSingle();
    if (tErr) console.error(`Prize funding: failed to load tournament ${id}`, tErr.message);
    tournaments.set(id, (t as unknown as RequestTournament | null) ?? null);
  }

  let linked = 0;
  let failed = 0;
  for (const row of rows) {
    const tournament = tournaments.get(row.tournament_id);
    if (!tournament) {
      failed++;
      continue;
    }
    const checkoutUrl = await createLink(row, tournament.name);
    if (!checkoutUrl) {
      failed++;
      continue;
    }
    linked++;
    afterResponse(() =>
      sendPrizeFundingRequestEmail(row.funder_email, {
        funderName: row.funder_name,
        organizerName: tournament.organization?.name ?? "The organizer",
        tournamentName: tournament.name,
        amountCents: row.amount_cents,
        prizeList: prizesFundedBy(tournament.prizes, row.funder_name),
        checkoutUrl,
      }).catch((err) =>
        console.error(
          `Prize funding ${row.id}: failed to email the funder`,
          err instanceof Error ? err.message : err,
        ),
      ),
    );
  }
  return { linked, failed };
}

async function createLink(row: UnlinkedRow, tournamentName: string): Promise<string | null> {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  let purchase: { id: string; checkout_url: string };
  try {
    purchase = await createChipPurchase({
      purchase: {
        currency: "MYR",
        products: [{ name: `Prize fund — ${tournamentName}`, price: row.amount_cents, quantity: "1" }],
      },
      client: { email: row.funder_email, full_name: row.funder_name },
      reference: row.id,
      success_redirect: `${siteUrl}/prize-funding/thank-you`,
      failure_redirect: `${siteUrl}/prize-funding/thank-you?status=failed`,
      send_receipt: true,
    });
  } catch (err) {
    console.error(
      `Prize funding ${row.id}: CHIP purchase creation failed; retried on the next sync`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }

  const { data, error } = await supabaseAdmin
    .from("prize_fundings")
    .update({ chip_transaction_id: purchase.id, checkout_url: purchase.checkout_url })
    .eq("id", row.id)
    .eq("status", "pending")
    .is("cancelled_at", null)
    .is("checkout_url", null)
    .select("id");
  if (error || !data || data.length === 0) {
    if (error) {
      console.error(`Prize funding ${row.id}: failed to record CHIP purchase ${purchase.id}`, error.message);
    }
    try {
      await cancelChipPurchase(purchase.id);
    } catch (err) {
      console.error(
        `Prize funding ${row.id}: failed to cancel unrecorded CHIP purchase ${purchase.id}`,
        err instanceof Error ? err.message : err,
      );
    }
    return null;
  }
  return purchase.checkout_url;
}

export async function onTournamentListed(tournamentId: string): Promise<void> {
  afterResponse(() => notifyTournamentListed(tournamentId));
  revalidateTag(TOURNAMENTS_LIST_TAG, PURGE_PROFILE);
  const { data, error } = await supabaseAdmin
    .from("tournaments")
    .select("slug")
    .eq("id", tournamentId)
    .maybeSingle();
  if (error) {
    console.error(`Tournament ${tournamentId}: failed to load its slug to refresh its page`, error.message);
    return;
  }
  const slug = (data as { slug: string | null } | null)?.slug;
  if (slug) revalidateTag(tournamentTag(slug), PURGE_PROFILE);
}

async function notifyTournamentListed(tournamentId: string): Promise<void> {
  try {
    const { data, error } = await supabaseAdmin
      .from("tournaments")
      .select("name, slug, organization_id, organization:organizations(name)")
      .eq("id", tournamentId)
      .maybeSingle();
    if (error || !data) {
      console.error(`Tournament ${tournamentId}: failed to load listed email data`, error?.message);
      return;
    }
    const t = data as unknown as {
      name: string;
      slug: string | null;
      organization_id: string | null;
      organization: { name: string | null } | null;
    };
    if (!t.organization_id) return;

    const pool = await loadPrizePoolPosition(tournamentId);
    const fundedCents = pool.ok ? pool.position.funded_cents : 0;
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    const recipients = await loadOrganizationRecipients([t.organization_id]);

    await sendToAll(
      recipients,
      (r) =>
        sendTournamentListedEmail(r.email, {
          recipientName: r.name,
          orgName: t.organization?.name ?? "your organization",
          tournamentName: t.name,
          tournamentUrl: t.slug ? `${siteUrl}/tournaments/${t.slug}` : null,
          fundedCents,
        }),
      `tournament listed (${tournamentId})`,
    );
  } catch (err) {
    console.error(
      `Tournament ${tournamentId}: failed to send the listed email`,
      err instanceof Error ? err.message : err,
    );
  }
}

export interface FundingSweepStats {
  tournaments: number;
  linked: number;
  unlinked: number;
  released: number;
}

export async function sweepPrizeFundingRequests(): Promise<FundingSweepStats> {
  const { data, error } = await supabaseAdmin
    .from("tournaments")
    .select("id")
    .eq("status", "pending_funding");
  if (error) throw new Error(`failed to list tournaments pending funding: ${error.message}`);

  const stats: FundingSweepStats = { tournaments: 0, linked: 0, unlinked: 0, released: 0 };
  for (const { id } of (data ?? []) as { id: string }[]) {
    const result = await syncPrizeFundingRequests(id, null);
    if (result.error) {
      console.error(`Funding sweep: tournament ${id} failed to reconcile`, result.error.message);
      continue;
    }
    stats.tournaments++;
    stats.linked += result.linked;
    stats.unlinked += result.unlinked;
    if (result.released) stats.released++;
  }

  const rest = await createMissingFundingLinks();
  stats.linked += rest.linked;
  stats.unlinked += rest.failed;
  return stats;
}
