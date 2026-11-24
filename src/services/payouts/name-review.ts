import { supabaseAdmin } from "@/services/supabase/admin";
import type { BankAccountOwner, BankAccountStatus } from "./bank-account";
import { expectedPlayerHolderName } from "./player-holder";

export interface BankNameReview {
  id: string;
  owner: BankAccountOwner;
  owner_id: string;
  owner_name: string;
  expected_name: string;
  expected_is_registered_name: boolean;
  account_holder: string;
  bank_holder_name: string | null;
  bank_name: string;
  account_number_last4: string;
  status: BankAccountStatus;
  is_active: boolean;
  created_at: string;
  name_reviewed_at: string | null;
  name_review_note: string | null;
}

export interface BankNameReviews {
  pending: BankNameReview[];
  decided: BankNameReview[];
}

const LIMIT = 100;
const DECIDED_SHOWN = 20;

const COMMON = `id, bank_name, account_holder, account_number, bank_holder_name, status,
  is_active, created_at, name_reviewed_at, name_review_note`;

const ACTIVE_IN_REVIEW_OR_DECIDED =
  "and(status.eq.name_mismatch,is_active.is.true),name_reviewed_at.not.is.null";

type CommonRow = Omit<
  BankNameReview,
  | "owner"
  | "owner_id"
  | "owner_name"
  | "expected_name"
  | "expected_is_registered_name"
  | "account_number_last4"
> & { account_number: string };

interface OrgRow extends CommonRow {
  organization_id: string;
  organization: { name: string | null } | { name: string | null }[] | null;
}

interface PlayerRow extends CommonRow {
  user_id: string;
  entered_by: string | null;
  user:
    | { first_name: string | null; last_name: string | null }
    | { first_name: string | null; last_name: string | null }[]
    | null;
}

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function base({ account_number, ...row }: CommonRow) {
  return { ...row, account_number_last4: account_number.slice(-4) };
}

export async function loadBankNameReviews(): Promise<{
  data: BankNameReviews | null;
  error: string | null;
}> {
  const [orgRes, playerRes] = await Promise.all([
    supabaseAdmin
      .from("organization_bank_accounts")
      .select(`${COMMON}, organization_id, organization:organizations(name)`)
      .or(ACTIVE_IN_REVIEW_OR_DECIDED)
      .order("created_at", { ascending: false })
      .limit(LIMIT),
    supabaseAdmin
      .from("player_bank_accounts")
      .select(
        `${COMMON}, user_id, entered_by, user:users!user_id(first_name, last_name)`,
      )
      .or(ACTIVE_IN_REVIEW_OR_DECIDED)
      .order("created_at", { ascending: false })
      .limit(LIMIT),
  ]);
  const error = orgRes.error ?? playerRes.error;
  if (error) return { data: null, error: error.message };

  const orgRows = (orgRes.data ?? []) as unknown as OrgRow[];
  const playerRows = (playerRes.data ?? []) as unknown as PlayerRow[];

  const registered = new Map<string, string>();
  const orgIds = [...new Set(orgRows.map((r) => r.organization_id))];
  if (orgIds.length > 0) {
    const { data, error: namesError } = await supabaseAdmin
      .from("organization_registered_names")
      .select("organization_id, registered_name")
      .in("organization_id", orgIds);
    if (namesError) return { data: null, error: namesError.message };
    for (const r of (data ?? []) as {
      organization_id: string;
      registered_name: string;
    }[]) {
      registered.set(r.organization_id, r.registered_name);
    }
  }

  const reviews: BankNameReview[] = [
    ...orgRows.map(({ organization_id, organization, ...row }) => {
      const registeredName = registered.get(organization_id);
      return {
        ...base(row),
        owner: "organization" as const,
        owner_id: organization_id,
        owner_name: one(organization)?.name ?? "Deleted organization",
        expected_name: registeredName ?? row.account_holder,
        expected_is_registered_name: registeredName !== undefined,
      };
    }),
    ...playerRows.map(({ user_id, user, entered_by, ...row }) => {
      const u = one(user);
      const ownerName =
        [u?.first_name, u?.last_name].filter(Boolean).join(" ") ||
        "Deleted account";
      return {
        ...base(row),
        owner: "player" as const,
        owner_id: user_id,
        owner_name: ownerName,
        expected_name:
          expectedPlayerHolderName({ ...row, entered_by }, u) ?? ownerName,
        expected_is_registered_name: false,
      };
    }),
  ];

  return {
    data: {
      pending: reviews
        .filter((r) => r.status === "name_mismatch" && r.is_active)
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
      decided: reviews
        .filter((r) => r.name_reviewed_at !== null)
        .sort((a, b) => b.name_reviewed_at!.localeCompare(a.name_reviewed_at!))
        .slice(0, DECIDED_SHOWN),
    },
    error: null,
  };
}
