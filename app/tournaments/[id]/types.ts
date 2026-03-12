import type { EntryFees, TournamentFormat, TimeControl } from "../types";

const enum NonMonetaryPrize {
  Trophy = "Trophy",
  Medal = "Medal",
  Certificate = "Certificate",
}

export interface PrizeEntry {
  place: string;
  amount_cents: number;
  non_monetary_prize?: NonMonetaryPrize | null;
}

export interface PrizeCategory {
  name: string;
  entries: PrizeEntry[];
}

export interface PrizeSubCategory {
  name: string;
  entries: PrizeEntry[];
  conditions: unknown;
}
export interface PrizesData {
  categories: PrizeCategory[];
  subcategories?: PrizeSubCategory[] | null;
}

export interface Restrictions {
  min_rating?: number | null;
  max_rating?: number | null;
  min_age?: number | null;
  max_age?: number | null;
}

export interface OrganizerDetail {
  id: string;
  organization_name: string;
  description?: string | null;
  links?: Array<{ url: string; label: string }> | unknown;
  email: string;
  phone?: string | null;
}

export interface TournamentDetail {
  id: string;
  name: string;
  description?: string | null;
  venue_name: string;
  state: string;
  venue_address?: string | null;
  start_date: string;
  end_date: string;
  registration_deadline: string;
  format: TournamentFormat;
  time_control?: TimeControl;
  is_fide_rated: boolean;
  is_mcf_rated: boolean;
  entry_fees: EntryFees;
  prizes?: PrizesData | null;
  restrictions?: Restrictions | null;
  max_participants: number;
  current_participants: number;
  status: string;
  organizer: OrganizerDetail | null;
}
