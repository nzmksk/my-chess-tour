export type ChessTitle = "GM" | "WGM" | "IM" | "WIM" | "FM" | "WFM" | "CM" | "WCM";
export type Gender = "male" | "female";

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
  is_oku: boolean;
  fide_id: number | null;
  fide_rating: FideRating | null;
  title: ChessTitle | null;
  mcf_id: number | null;
  national_rating: number | null;
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
