import Link from "next/link";
import type { PaymentState } from "../_lib/resolvePaymentState";
import type { RegistrationRow } from "../types";
import RegistrationPending from "./RegistrationPending";

interface Props {
  state: PaymentState;
  registration: RegistrationRow | null;
  tournamentSlug: string;
}

/**
 * Renders the post-payment status card based on the *resolved* payment state,
 * shared by the success and failure return pages.
 */
export default function PaymentStatusView({
  state,
  registration,
  tournamentSlug,
}: Props) {
  if (state === "confirmed") {
    return (
      <div className="mx-auto max-w-lg">
        <div className="card card--featured flex flex-col p-8 text-center">
          <div className="confirm-icon">✓</div>
          <h2 className="confirm-title">Payment Successful</h2>
          <p className="confirm-body">
            Your payment has been confirmed. Your registration is now active. We
            look forward to seeing you at the tournament.
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
            Your payment was not completed, so your registration is not yet
            confirmed. Please try again.
          </p>
          <Link
            href={`/tournaments/${tournamentSlug}/register`}
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
          We couldn&apos;t find a registration for this tournament under your
          account.
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
