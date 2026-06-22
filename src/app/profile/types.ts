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
};

// Public-facing subset of a player's profile. Excludes private fields
// (email, date_of_birth, gender, is_oku) that must never be exposed publicly.
export type PublicPlayerProfile = {
  id: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  nationality: string | null;
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
};
