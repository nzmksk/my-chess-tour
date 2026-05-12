import Link from "next/link";
import type { RegistrationRow } from "../types";
import { toTitleCase } from "@/app/tournaments/utils";

interface Props {
  registration: RegistrationRow;
  tournamentId: string;
}

export default function RegistrationPending({ registration, tournamentId }: Props) {
  return (
    <div className="max-w-lg mx-auto">
      <div className="card card--featured p-8 flex flex-col text-center">
        <div className="confirm-icon">♟</div>
        <h2 className="confirm-title">Registration Submitted</h2>
        <p className="confirm-body">
          Your spot is reserved. Your registration is pending payment
          confirmation.
        </p>
        <div className="session-info text-left mt-2">
          <div className="session-row">
            <span className="session-key">Reference</span>
            <span className="session-val font-mono text-xs">
              {registration.id}
            </span>
          </div>
          <div className="session-row">
            <span className="session-key">Fee Tier</span>
            <span className="session-val">
              {toTitleCase(registration.fee_tier)}
            </span>
          </div>
          <div className="session-row">
            <span className="session-key">Status</span>
            <span className="session-val text-amber-400">Pending Payment</span>
          </div>
        </div>
        <Link
          href={`/tournaments/${tournamentId}`}
          className="btn-secondary rounded-md text-center mt-2"
        >
          Back to Tournament
        </Link>
      </div>
    </div>
  );
}
