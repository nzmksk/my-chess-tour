type ChessTitle =
  | "GM"
  | "WGM"
  | "IM"
  | "WIM"
  | "FM"
  | "WFM"
  | "CM"
  | "WCM";
export type Gender = "male" | "female";

type FideRating = {
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
  is_oku: boolean;
  fide_id: number | null;
  fide_rating: FideRating | null;
  title: ChessTitle | null;
  mcf_id: number | null;
  national_rating: number | null;
  show_age: boolean;
  show_oku: boolean;
};

// Public-facing subset of a player's profile. Excludes private fields
// (email, date_of_birth) that must never be exposed publicly. Age is a
// computed integer (never the raw date_of_birth) and is_oku is gated behind the
// owner's visibility toggles — both are null/false unless the owner opted in.
// Gender is always public.
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
  is_oku?: boolean;
  fide_id?: number | null;
  title?: ChessTitle | null;
  mcf_id?: number | null;
  national_rating?: number | null;
  show_age?: boolean;
  show_oku?: boolean;
};
