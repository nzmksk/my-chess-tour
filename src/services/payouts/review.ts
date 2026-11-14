import { supabaseAdmin } from "@/services/supabase/admin";
import { ORGANIZER_AGREEMENT_VERSION } from "@/lib/legal";
import { describePayoutFailure } from "./failure-reason";
import { describeEarlyPayoutProblem } from "./recipient-problem";
import { canResend } from "./resend";

// Everything the admin payout review page shows, assembled server-side. The caller
// gates on platform.manage: this reads through the service role. Account numbers
// are masked here, so the full number never reaches the browser.

/**
 * How long a reviewer's document links stay live. Matches the application review
 * page: these are identity documents, and a signed URL that outlives the review is
 * a credential sitting in a browser history.
 */
export const DOCUMENT_URL_TTL_SECONDS = 300;

/** The arithmetic behind the cap (early_payout_cap), so the ceiling is explained. */
export interface EarlyPayoutCap {
  net_revenue_cents: number;
  paid_payouts_cents: number;
  live_refund_cents: number;
  max_pct: number;
  ceiling_cents: number;
  early_committed_cents: number;
  available_cents: number;
  cap_cents: number;
}

export interface PayoutReviewBankAccount {
  bank_name: string;
  account_holder: string;
  account_number_last4: string;
  status: "pending" | "verified" | "rejected";
  is_active: boolean;
}

export interface PayoutReviewDocument {
  id: string;
  doc_type: string;
  original_filename: string | null;
  /** Short-lived signed URL. Null if it couldn't be minted. */
  url: string | null;
}

export interface PayoutReview {
  id: string;
  kind: "automatic" | "early";
  approval: "pending" | "approved" | "rejected";
  status: "pending" | "processing" | "paid" | "failed";
  amount_cents: number;
  settled_amount_cents: number | null;
  request_seq: number | null;
  reason: string | null;
  rejection_reason: string | null;
  failure_reason: string | null;
  requested_at: string;
  reviewed_at: string | null;
  requested_by: { name: string; email: string } | null;
  reviewed_by: { name: string } | null;
  tournament: {
    id: string;
    name: string;
    status: string;
    start_date: string;
    end_date: string;
    registration_closed_at: string | null;
  };
  organization: {
    id: string;
    name: string;
    approval_status: string;
    entity_type: string | null;
    registration_number: string | null;
    agreement_version: string | null;
    agreement_accepted_at: string | null;
    /** Whether agreement_version is the one payouts currently require. */
    agreement_current: boolean;
  };
  /**
   * Where the money goes: the current active account while the request is
   * pending (approval re-snapshots it), the one recorded on the payout after.
   */
  bank_account: PayoutReviewBankAccount | null;
  documents: PayoutReviewDocument[];
  /** Figures excluding this request's own reservation: the most it could be. */
  cap: EarlyPayoutCap;
  /** Why approving would be refused right now, in words; null if it wouldn't. */
  approval_blocked: string | null;
  /** Approved but not out with CHIP, so an admin can re-run the send. */
  can_resend: boolean;
}

interface RawUser {
  first_name: string | null;
  last_name: string | null;
  email?: string | null;
}

interface RawBank {
  bank_name: string;
  account_holder: string;
  account_number: string;
  status: PayoutReviewBankAccount["status"];
  is_active: boolean;
}

// PostgREST embeds a single-FK relation as an object, but the untyped client widens
// it to `object | object[]`; collapse either shape to the first element.
function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function mask(bank: RawBank | null): PayoutReviewBankAccount | null {
  if (!bank) return null;
  return {
    bank_name: bank.bank_name,
    account_holder: bank.account_holder,
    account_number_last4: bank.account_number.slice(-4),
    status: bank.status,
    is_active: bank.is_active,
  };
}

const fullName = (u: RawUser) =>
  [u.first_name, u.last_name].filter(Boolean).join(" ") || "Unknown";

const BANK_COLUMNS = "bank_name, account_holder, account_number, status, is_active";

/**
 * Loads one payout for review. `data` is null when the payout doesn't exist;
 * `error` is set when something failed to load.
 */
export async function loadPayoutReview(
  payoutId: string,
): Promise<{ data: PayoutReview | null; error: string | null }> {
  const { data: row, error } = await supabaseAdmin
    .from("payouts")
    .select(
      `id, kind, approval, status, amount_cents, settled_amount_cents, request_seq,
       reason, rejection_reason, failure_reason, requested_at, reviewed_at,
       processed_at, chip_send_instruction_id, tournament_id, recipient_organization_id,
       requester:users!requested_by(first_name, last_name, email),
       reviewer:users!reviewed_by(first_name, last_name),
       tournament:tournaments(id, name, status, start_date, end_date, registration_closed_at),
       recipient:organizations!recipient_organization_id(
         id, name, approval_status, entity_type, registration_number,
         agreement_version, agreement_accepted_at
       ),
       bank:organization_bank_accounts!bank_account_id(${BANK_COLUMNS})`,
    )
    .eq("id", payoutId)
    .maybeSingle();

  if (error) return { data: null, error: error.message };
  if (!row) return { data: null, error: null };

  const p = row as unknown as {
    id: string;
    kind: PayoutReview["kind"];
    approval: PayoutReview["approval"];
    status: PayoutReview["status"];
    amount_cents: number;
    settled_amount_cents: number | null;
    request_seq: number | null;
    reason: string | null;
    rejection_reason: string | null;
    failure_reason: string | null;
    requested_at: string;
    reviewed_at: string | null;
    processed_at: string | null;
    chip_send_instruction_id: number | null;
    tournament_id: string;
    recipient_organization_id: string;
    requester: RawUser | RawUser[] | null;
    reviewer: RawUser | RawUser[] | null;
    tournament: PayoutReview["tournament"] | PayoutReview["tournament"][] | null;
    recipient:
      | Omit<PayoutReview["organization"], "agreement_current">
      | Omit<PayoutReview["organization"], "agreement_current">[]
      | null;
    bank: RawBank | RawBank[] | null;
  };

  const tournament = one(p.tournament);
  const recipient = one(p.recipient);
  if (!tournament || !recipient) {
    return { data: null, error: "payout is missing its tournament or recipient" };
  }

  const pending = p.approval === "pending";

  const [capRes, problemRes, activeBankRes, documentsRes] = await Promise.all([
    supabaseAdmin.rpc("early_payout_cap", {
      p_tournament_id: p.tournament_id,
      p_exclude_payout_id: p.id,
    }),
    pending
      ? supabaseAdmin.rpc("early_payout_problem", {
          p_tournament_id: p.tournament_id,
          p_exclude_payout_id: p.id,
        })
      : Promise.resolve({ data: null, error: null }),
    pending
      ? supabaseAdmin
          .from("organization_bank_accounts")
          .select(BANK_COLUMNS)
          .eq("organization_id", p.recipient_organization_id)
          .eq("is_active", true)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabaseAdmin
      .from("organization_documents")
      .select("id, doc_type, storage_path, original_filename")
      .eq("organization_id", p.recipient_organization_id)
      .order("created_at", { ascending: true }),
  ]);

  const loadError =
    capRes.error ?? problemRes.error ?? activeBankRes.error ?? documentsRes.error;
  if (loadError) return { data: null, error: loadError.message };

  const cap = one(capRes.data as EarlyPayoutCap | EarlyPayoutCap[] | null);
  if (!cap) return { data: null, error: "early_payout_cap returned nothing" };

  // The bucket is private, so a path is not a link. Each URL is signed here and
  // expires with the review session.
  const documents = await Promise.all(
    ((documentsRes.data ?? []) as {
      id: string;
      doc_type: string;
      storage_path: string;
      original_filename: string | null;
    }[]).map(async (doc) => {
      const { data: signed } = await supabaseAdmin.storage
        .from("organization-documents")
        .createSignedUrl(doc.storage_path, DOCUMENT_URL_TTL_SECONDS);
      return {
        id: doc.id,
        doc_type: doc.doc_type,
        original_filename: doc.original_filename,
        url: signed?.signedUrl ?? null,
      };
    }),
  );

  const requester = one(p.requester);
  const reviewer = one(p.reviewer);
  const problem = problemRes.data as string | null;

  return {
    data: {
      id: p.id,
      kind: p.kind,
      approval: p.approval,
      status: p.status,
      amount_cents: p.amount_cents,
      settled_amount_cents: p.settled_amount_cents,
      request_seq: p.request_seq,
      reason: p.reason,
      rejection_reason: p.rejection_reason,
      failure_reason: p.status === "failed" ? describePayoutFailure(p.failure_reason) : null,
      requested_at: p.requested_at,
      reviewed_at: p.reviewed_at,
      requested_by: requester
        ? { name: fullName(requester), email: requester.email ?? "" }
        : null,
      reviewed_by: reviewer ? { name: fullName(reviewer) } : null,
      tournament,
      organization: {
        ...recipient,
        agreement_current: recipient.agreement_version === ORGANIZER_AGREEMENT_VERSION,
      },
      bank_account: mask(pending ? (activeBankRes.data as RawBank | null) : one(p.bank)),
      documents,
      cap: {
        net_revenue_cents: Number(cap.net_revenue_cents),
        paid_payouts_cents: Number(cap.paid_payouts_cents),
        live_refund_cents: Number(cap.live_refund_cents),
        max_pct: Number(cap.max_pct),
        ceiling_cents: Number(cap.ceiling_cents),
        early_committed_cents: Number(cap.early_committed_cents),
        available_cents: Number(cap.available_cents),
        cap_cents: Number(cap.cap_cents),
      },
      approval_blocked: problem
        ? describeEarlyPayoutProblem(problem)
        : pending && p.amount_cents > Number(cap.cap_cents)
          ? "The request is for more than can be paid early now."
          : null,
      can_resend: canResend(p),
    },
    error: null,
  };
}
