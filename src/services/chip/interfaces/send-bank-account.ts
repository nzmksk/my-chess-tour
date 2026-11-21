export interface ChipBankAccountRequest {
  account_number: string;
  bank_code: string;
  name: string;
  reference: string;
}

export type ChipBankAccountStatus = "pending" | "verified" | "rejected";

export interface ChipBankAccount {
  id: number;
  status: ChipBankAccountStatus;
  account_number: string;
  bank_code: string;
  group_id: number | null;
  name: string;
  reference: string | null;
  created_at: string;
  is_debiting_account: boolean;
  is_crediting_account: boolean;
  updated_at: string;
  deleted_at: string | null;
  rejection_reason: string | null;
}
