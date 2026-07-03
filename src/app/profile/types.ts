export type ChessTitle =
  | "GM"
  | "WGM"
  | "IM"
  | "WIM"
  | "FM"
  | "WFM"
  | "CM"
  | "WCM";
export type Gender = "male" | "female";
export type OkuStatus = "none" | "pending" | "verified" | "rejected";

export type FideRating = {
  standard?: number | null;
  rapid?: number | null;
  blitz?: number | null;
};

export type PlayerProfile = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  date_of_birth: string | null;
  gender: Gender | null;
  nationality: string | null;
  oku_status: OkuStatus;
  oku_rejection_reason: string | null;
  fide_id: number | null;
  fide_rating: FideRating | null;
  // When fide_rating/title were last fetched from FIDE (null = never synced).
  fide_rating_synced_at: string | null;
  // Whether the stored name matched the FIDE profile at last sync (null = unchecked).
  fide_name_verified: boolean | null;
  // Raw name FIDE reported ("Last, First"), shown to admins on a mismatch.
  fide_verified_name: string | null;
  title: ChessTitle | null;
  mcf_id: number | null;
  national_rating: number | null;
  // Banking / payout details. The full account number is never sent to the
  // client; only the last 4 digits are exposed for display.
  bank_name: string | null;
  bank_account_holder: string | null;
  bank_account_number_last4: string | null;
};

// Public-facing subset of a player's profile. Excludes private fields
// (email, date_of_birth) that must never be exposed publicly. Age is a computed
// integer (never the raw date_of_birth). `is_oku` is a computed boolean that is
// true only when the player's OKU status is verified. Age and OKU status are
// always public. Gender is always public.
export type PublicPlayerProfile = {
  id: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  gender: Gender | null;
  nationality: string | null;
  age: number | null;
  is_oku: boolean;
  fide_id: number | null;
  fide_rating: FideRating | null;
  title: ChessTitle | null;
  mcf_id: number | null;
  national_rating: number | null;
  tournaments_joined: number;
};

export type UpdateProfilePayload = {
  date_of_birth?: string | null;
  gender?: Gender | null;
  nationality?: string | null;
  fide_id?: number | null;
  title?: ChessTitle | null;
  mcf_id?: number | null;
  national_rating?: number | null;
};

// Write shape for the banking sub-route. Unlike the read shape, this carries the
// full account number (only ever travels client -> server on save).
export type UpdateBankingPayload = {
  bank_name: string | null;
  bank_account_holder: string | null;
  bank_account_number: string | null;
};
