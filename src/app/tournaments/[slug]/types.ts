import type {
  EntryFees,
  TournamentFormat,
  TimeControl,
  ChessTitle,
} from "../types";

const enum NonMonetaryPrize {
  Trophy = "Trophy",
  Medal = "Medal",
  Certificate = "Certificate",
}

interface PrizeEntry {
  place: string;
  amount_cents: number;
  non_monetary_prize?: NonMonetaryPrize | null;
}

interface PrizeCategory {
  name: string;
  entries: PrizeEntry[];
}

interface PrizeSubCategory {
  name: string;
  entries: PrizeEntry[];
  conditions: unknown;
}
interface PrizesData {
  categories: PrizeCategory[];
  subcategories?: PrizeSubCategory[] | null;
}

export interface Restrictions {
  min_rating?: number | null;
  max_rating?: number | null;
  min_age?: number | null;
  max_age?: number | null;
  titles?: ChessTitle[] | null;
  gender?: string | null;
  nationality?: string | null;
}

interface OrganizerDetail {
  id: string;
  name: string;
  description?: string | null;
  links?: Array<{ url: string; label: string }> | unknown;
  email: string;
  phone?: string | null;
}

export interface StartingRankPlayer {
  rank: number;
  user_id: string;
  name: string;
  title: string | null;
  fide_id: number | null;
  fide_rating: number | null;
  national_rating: number | null;
  nationality: string | null;
  mcf_id: number | null;
  gender: "male" | "female" | null;
}

export interface TournamentDetail {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  venue: {
    name: string;
    state: string;
    address?: string | null;
  };
  start_date: string;
  end_date: string;
  registration_deadline: string;
  registration_closed_at?: string | null;
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
  organization: OrganizerDetail | null;
}
