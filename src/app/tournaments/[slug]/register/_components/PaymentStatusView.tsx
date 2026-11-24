import Link from "next/link";
import type { PaymentState } from "../_lib/resolvePaymentState";
import type { RegistrationRow } from "../types";
import RegistrationPending from "./RegistrationPending";

interface Props {
  state: PaymentState;
  registration: RegistrationRow | null;
  tournamentSlug: string;
  participant?: { id: string; firstName: string } | null;
}

/**
 * Renders the post-payment status card based on the *resolved* payment state,
 * shared by the success and failure return pages.
 */
export default function PaymentStatusView({
  state,
  registration,
  tournamentSlug,
  participant = null,
}: Props) {
  const retryQuery = participant
    ? `?participant=${encodeURIComponent(participant.id)}`
    : "";
  if (state === "confirmed") {
    return (
      <div className="mx-auto max-w-lg">
        <div className="card card--featured flex flex-col p-8 text-center">
          <div className="confirm-icon">✓</div>
          <h2 className="confirm-title">Payment Successful</h2>
          <p className="confirm-body">
            {participant
              ? `Your payment has been confirmed. ${participant.firstName}'s registration is now active. We look forward to seeing them at the tournament.`
              : "Your payment has been confirmed. Your registration is now active. We look forward to seeing you at the tournament."}
          </p>
          <Link
            href={`/tournaments/${tournamentSlug}`}
            className="btn-secondary mt-2 rounded-md text-center"
          >
            Back to Tournament
          </Link>
        </div>
      </div>
    );
  }

  if (state === "pending" && registration) {
    return (
      <RegistrationPending
        registration={registration}
        tournamentSlug={tournamentSlug}
      />
    );
  }

  if (state === "failed") {
    return (
      <div className="mx-auto max-w-lg">
        <div className="card card--featured flex flex-col p-8 text-center">
          <div className="confirm-icon confirm-icon--danger">✗</div>
          <h2 className="confirm-title">Payment Not Completed</h2>
          <p className="confirm-body">
            {participant
              ? `Your payment was not completed, so ${participant.firstName}'s registration is not yet confirmed. Please try again.`
              : "Your payment was not completed, so your registration is not yet confirmed. Please try again."}
          </p>
          <Link
            href={`/tournaments/${tournamentSlug}/register${retryQuery}`}
            className="btn-primary mt-2 rounded-md text-center"
          >
            Try Again
          </Link>
          <Link
            href={`/tournaments/${tournamentSlug}`}
            className="btn-secondary mt-4 rounded-md text-center"
          >
            Back to Tournament
          </Link>
        </div>
      </div>
    );
  }

  // state === "none" (or pending without a registration row to show)
  return (
    <div className="mx-auto max-w-lg">
      <div className="card card--featured flex flex-col p-8 text-center">
        <h2 className="confirm-title">No registration found</h2>
        <p className="confirm-body">
          {participant
            ? `We couldn't find a registration for ${participant.firstName} in this tournament.`
            : "We couldn't find a registration for this tournament under your account."}
        </p>
        <Link
          href={`/tournaments/${tournamentSlug}`}
          className="btn-secondary mt-2 rounded-md text-center"
        >
          Back to Tournament
        </Link>
      </div>
    </div>
  );
}
