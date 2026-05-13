import type { TournamentFormat, TimeControl } from "@/app/tournaments/types";

export type RegistrationStatus =
  | "pending_payment"
  | "failed_payment"
  | "cancelled_payment"
  | "confirmed"
  | "forfeited";

export interface PlayerRegistration {
  id: string;
  tournament: {
    id: string;
    name: string;
    start_date: string;
    venue_name: string;
    venue_state: string;
    format: TournamentFormat;
    time_control: TimeControl;
    status: string;
  };
  fee_tier: string;
  entry_fee_cents: number | null;
  status: RegistrationStatus;
  registered_at: string;
  confirmed_at: string | null;
}
