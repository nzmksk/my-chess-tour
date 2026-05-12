import type { ChessTitle } from "@/app/tournaments/types";

export interface PlayerProfile {
  gender: "male" | "female" | null;
  is_oku: boolean;
  date_of_birth: string | null;
  title: ChessTitle | null;
}

export interface RegistrationRequest {
  fee_tier: string;
}

type RegistrationStatus =
  | "pending_payment"
  | "failed_payment"
  | "cancelled_payment"
  | "confirmed"
  | "forfeited";

export interface RegistrationRow {
  id: string;
  user_id: string;
  tournament_id: string;
  fee_tier: string;
  status: RegistrationStatus;
  registered_at: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
}
