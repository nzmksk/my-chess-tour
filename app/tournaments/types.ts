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

export interface EntryFees {
  standard: { amount_cents: number };
  additional?: Array<{
    type: string;
    amount_cents: number;
    valid_until?: string;
    age_min?: number;
    age_max?: number;
  }>;
}

export interface Tournament {
  id: string;
  name: string;
  venue_name: string;
  state: string;
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
  poster_url: string | null;
  status: string;
  organizer: {
    id: string;
    organization_name: string;
    links: unknown;
  } | null;
}
