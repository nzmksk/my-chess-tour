"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ORGANIZER_AGREEMENT_HISTORY,
  ORGANIZER_AGREEMENT_VERSION,
  changesSince,
} from "@/lib/legal";

interface Props {
  organizationId: string;
  /** What the organization last accepted. NULL = never accepted anything. */
  agreementVersion: string | null;
}

/**
 * Blocking notice shown when an organization is not on the current Organizer
 * Agreement — either because the version was bumped or because the org predates
 * the agreement entirely.
 *
 * It lives on the dashboard because that is the organizer's first screen; when
 * the payouts page arrives it should move (or be rendered there too), since a
 * stale agreement is exactly what stops a payout.
 *
 * Only an owner (org.manage) can accept. The API enforces that; here a failure
 * simply surfaces the message, which for an admin reads as "ask your owner".
 *
 * The panel names what actually changed since the version this organization
 * accepted, taken from ORGANIZER_AGREEMENT_HISTORY. Asking someone to re-accept
 * a money-movement document without telling them what moved is how you get a
 * reflexive tick, which is worth nothing when the claw-back clause is tested.
 * An organization that skipped a version sees every version it missed.
 */
export default function AgreementGate({
  organizationId,
  agreementVersion,
}: Props) {
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (agreementVersion === ORGANIZER_AGREEMENT_VERSION) return null;

  const changes = changesSince(ORGANIZER_AGREEMENT_HISTORY, agreementVersion);

  async function handleAccept() {
    if (submitting || !accepted) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/v1/organizations/${organizationId}/agreement`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agreement_accepted: true }),
        },
      );

      if (!res.ok) {
        const json = await res.json();
        setError(
          json.error?.message ?? "Could not record your acceptance. Try again.",
        );
        return;
      }

      router.refresh();
    } catch {
      setError("A network error occurred. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      aria-labelledby="agreement-gate-heading"
      className="border-warning/40 bg-warning/10 mb-8 rounded-md border p-5"
    >
      <h2
        id="agreement-gate-heading"
        className="font-cinzel text-text-primary mb-2 text-base font-bold tracking-wide"
      >
        {agreementVersion
          ? "The Organizer Agreement has been updated"
          : "Accept the Organizer Agreement"}
      </h2>

      <p className="font-lato text-text-secondary mb-3 text-sm">
        Version {ORGANIZER_AGREEMENT_VERSION} covers how entry fees are
        collected, how and when payouts are made, and what you owe back if a
        tournament is cancelled after you have been paid.{" "}
        <strong className="text-text-primary">
          Payouts are held until it is accepted.
        </strong>
      </p>

      {changes.length > 0 && (
        <div className="border-border bg-bg-sunken mb-4 rounded-md border p-4">
          <p className="font-lato text-text-primary mb-2 text-sm font-semibold">
            {agreementVersion
              ? `What changed since version ${agreementVersion}`
              : "What it covers"}
          </p>
          <ul className="font-lato text-text-secondary list-disc space-y-1 pl-5 text-sm">
            {changes.map((change) => (
              <li key={change}>{change}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="check-row">
        <input
          id="agreement-gate"
          type="checkbox"
          className="checkbox"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
          aria-label="I have read and accept the Organizer Agreement"
        />
        <label className="check-label" htmlFor="agreement-gate">
          I have read and accept the{" "}
          <a
            href="/organizer-agreement"
            target="_blank"
            rel="noopener noreferrer"
            className="modal-trigger-link"
          >
            Organizer Agreement
          </a>{" "}
          on behalf of this organization.
        </label>
      </div>

      {error && (
        <p className="font-lato text-error mt-2 text-sm" role="alert">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handleAccept}
        disabled={!accepted || submitting}
        className="btn-primary mt-4 rounded-md"
      >
        {submitting ? "Recording…" : "Accept Agreement"}
      </button>
    </section>
  );
}
