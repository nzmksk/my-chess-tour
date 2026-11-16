import type { TournamentFormat, TimeControl } from "@/app/tournaments/types";
import type { RefundState } from "@/lib/refunds/state";

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
    slug: string;
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
  /** The live refund on this registration, if one has been issued. */
  refund: {
    state: RefundState;
    amount_cents: number;
    requested_at: string;
    /** When the refund cleared; set exactly when state is "refunded". */
    processed_at: string | null;
  } | null;
}
