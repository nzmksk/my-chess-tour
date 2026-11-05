import { supabaseAdmin } from "@/services/supabase/admin";
import { describePayoutFailure } from "./failure-reason";
import {
  describeBlockReason,
  describeRecipientProblem,
} from "./recipient-problem";

// The admin payouts screen, shared by the page and GET /api/v1/admin/payouts. The
// caller gates on platform.manage: this reads through the service role.

export type PayoutStatus = "pending" | "processing" | "paid" | "failed";

export interface AdminPayout {
  id: string;
  kind: "automatic" | "early";
  status: PayoutStatus;
  approval: "pending" | "approved" | "rejected";
  amount_cents: number;
  failure_reason: string | null;
  receipt_url: string | null;
  awaiting_budget: boolean;
  requested_at: string;
  processed_at: string | null;
  tournament: { id: string; name: string } | null;
  organizer: { id: string; name: string } | null;
  recipient: { id: string; name: string } | null;
  is_beneficiary: boolean;
  /** Last 4 only. The full number never leaves this module. */
  bank: { name: string; account_last4: string; status: string } | null;
}

export interface AdminPayoutCandidate {
  tournament_id: string;
  tournament_name: string;
  end_date: string;
  organizer: string | null;
  recipient: string | null;
  is_beneficiary: boolean;
  available_cents: number;
  /** Why it can't be paid right now, in words; null when it can. */
  blocked: string | null;
}

export interface AdminPayoutQueue {
  candidates: AdminPayoutCandidate[];
  payouts: AdminPayout[];
}

interface Named {
  id: string;
  name: string;
}

interface RawBank {
  bank_name: string;
  account_number: string;
  status: string;
}

interface RawPayout {
  id: string;
  kind: AdminPayout["kind"];
  status: PayoutStatus;
  approval: AdminPayout["approval"];
  amount_cents: number;
  settled_amount_cents: number | null;
  failure_reason: string | null;
  chip_receipt_url: string | null;
  chip_send_limit_id: number | null;
  requested_at: string;
  processed_at: string | null;
  organization_id: string;
  recipient_organization_id: string;
  tournament: Named | Named[] | null;
  organizer: Named | Named[] | null;
  recipient: Named | Named[] | null;
  bank: RawBank | RawBank[] | null;
}

interface RawCandidate {
  tournament_id: string;
  tournament_name: string;
  end_date: string;
  organizing_organization: string | null;
  recipient_organization: string | null;
  is_beneficiary: boolean;
  available_cents: number;
  block_reason: string | null;
  recipient_problem: string | null;
}

// PostgREST embeds a single-FK relation as an object, but the untyped client widens
// it to `object | object[]`; collapse either shape to the first element.
function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

const QUEUE_SIZE = 200;

export async function loadAdminPayoutQueue(): Promise<
  { data: AdminPayoutQueue; error: null } | { data: null; error: string }
> {
  const [payoutsRes, candidatesRes] = await Promise.all([
    supabaseAdmin
      .from("payouts")
      .select(
        `id, kind, status, approval, amount_cents, settled_amount_cents, failure_reason,
         chip_receipt_url, chip_send_limit_id, requested_at, processed_at,
         organization_id, recipient_organization_id,
         tournament:tournaments(id, name),
         organizer:organizations!organization_id(id, name),
         recipient:organizations!recipient_organization_id(id, name),
         bank:organization_bank_accounts!bank_account_id(bank_name, account_number, status)`,
      )
      .order("requested_at", { ascending: false })
      .limit(QUEUE_SIZE),
    supabaseAdmin.rpc("list_admin_payout_candidates"),
  ]);

  const error = payoutsRes.error ?? candidatesRes.error;
  if (error) return { data: null, error: error.message };

  const payouts = ((payoutsRes.data ?? []) as unknown as RawPayout[]).map(
    (p): AdminPayout => {
      const bank = one(p.bank);
      return {
        id: p.id,
        kind: p.kind,
        status: p.status,
        approval: p.approval,
        amount_cents: p.settled_amount_cents ?? p.amount_cents,
        failure_reason:
          p.status === "failed" ? describePayoutFailure(p.failure_reason) : null,
        receipt_url: p.chip_receipt_url,
        awaiting_budget: p.status === "pending" && p.chip_send_limit_id !== null,
        requested_at: p.requested_at,
        processed_at: p.processed_at,
        tournament: one(p.tournament),
        organizer: one(p.organizer),
        recipient: one(p.recipient),
        is_beneficiary: p.recipient_organization_id !== p.organization_id,
        bank: bank
          ? {
              name: bank.bank_name,
              account_last4: bank.account_number.slice(-4),
              status: bank.status,
            }
          : null,
      };
    },
  );

  const candidates = ((candidatesRes.data ?? []) as RawCandidate[]).map(
    (c): AdminPayoutCandidate => ({
      tournament_id: c.tournament_id,
      tournament_name: c.tournament_name,
      end_date: c.end_date,
      organizer: c.organizing_organization,
      recipient: c.recipient_organization,
      is_beneficiary: c.is_beneficiary,
      available_cents: c.available_cents,
      blocked: c.block_reason
        ? describeBlockReason(c.block_reason)
        : c.recipient_problem
          ? describeRecipientProblem(c.recipient_problem)
          : null,
    }),
  );

  return { data: { candidates, payouts }, error: null };
}
