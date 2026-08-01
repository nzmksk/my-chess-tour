export interface TournamentFormat {
  type: string;
  system: string;
  rounds: number;
}

export interface TimeControl {
  base_minutes: number;
  increment_seconds: number;
  delay_seconds: number;
}

export type ChessTitle =
  | "GM"
  | "WGM"
  | "IM"
  | "WIM"
  | "FM"
  | "WFM"
  | "CM"
  | "WCM";

export interface EntryFees {
  standard: { amount_cents: number };
  additional?: Array<{
    type: string;
    amount_cents: number;
    valid_until?: string;
    age_min?: number;
    age_max?: number;
    // Judged against the rating list matching the tournament's format — see
    // resolvePlayerRating / checkRatingEligibility in ../utils.
    rating_min?: number;
    rating_max?: number;
    gender?: "female";
    oku?: boolean;
    titles?: ChessTitle[];
  }>;
}

export interface Tournament {
  id: string;
  slug: string;
  name: string;
  venue: {
    name: string;
    state: string;
  };
  /** IANA timezone of the venue — the zone the dates below are read in. */
  timezone: string;
  start_date: string;
  end_date: string;
  registration_deadline: string;
  format: TournamentFormat;
  time_control?: TimeControl;
  is_fide_rated: boolean;
  is_mcf_rated: boolean;
  entry_fees: EntryFees;
  max_participants: number;
  current_participants: number;
  status: string;
  organizer: {
    id: string;
    organization_name: string;
    links: unknown;
  } | null;
}
