"use client";

import { useEffect, useState } from "react";
import { useTournamentWizard } from "../TournamentWizardContext";

interface OrgResult {
  id: string;
  name: string;
}

const SEARCH_DEBOUNCE_MS = 250;

/**
 * Optionally nominates another approved organization to receive this tournament's
 * payout. The nomination is sent when the wizard saves (WizardShell) and redirects
 * nothing until the nominee accepts it.
 */
export default function PayoutStep() {
  const { payoutData, setPayoutData, canNominate, orgId } = useTournamentWizard();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OrgResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);

  const chosenId = payoutData.beneficiaryOrgId;
  const editable = canNominate && !payoutData.locked;
  const isSaved = chosenId === payoutData.savedBeneficiaryOrgId;

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/v1/organizations/search?q=${encodeURIComponent(q)}`,
          { signal: controller.signal },
        );
        if (!res.ok) throw new Error("search failed");
        const json = (await res.json()) as { data: OrgResult[] };
        setResults(json.data.filter((o) => o.id !== orgId));
        setSearchError(null);
      } catch {
        if (!controller.signal.aborted) {
          setSearchError("Could not search organizations. Please try again.");
        }
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, orgId]);

  function choose(org: OrgResult) {
    setPayoutData((prev) => ({
      ...prev,
      beneficiaryOrgId: org.id,
      beneficiaryOrgName: org.name,
    }));
    setQuery("");
    setResults([]);
  }

  function clear() {
    setPayoutData((prev) => ({
      ...prev,
      beneficiaryOrgId: null,
      beneficiaryOrgName: "",
    }));
  }

  const showResults = query.trim().length >= 2;

  return (
    <div>
      <h2 className="font-cinzel text-text-primary mb-1 text-lg font-bold tracking-wide">
        Payout Recipient
      </h2>
      <p className="font-lato text-text-muted mb-6 text-sm">
        Your organization receives this tournament&apos;s payout. You can nominate
        another approved organization to receive it instead. This is optional, and
        most tournaments won&apos;t need it.
      </p>

      {chosenId ? (
        <div className="border-border bg-bg-base mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
          <div className="min-w-0">
            <p className="font-lato text-text-primary text-sm font-semibold">
              {payoutData.beneficiaryOrgName || "Nominated organization"}
            </p>
            <p className="font-lato text-text-muted mt-0.5 text-xs">
              {!isSaved
                ? "Will be nominated when you save."
                : payoutData.accepted
                  ? "Accepted. The payout goes to this organization."
                  : "Waiting for this organization to accept. Until it does, the payout stays with you."}
            </p>
          </div>
          {editable && (
            <button
              type="button"
              onClick={clear}
              className="font-lato border-border text-text-muted hover:border-gold-muted hover:text-text-primary cursor-pointer rounded-md border bg-transparent px-3 py-1 text-xs transition duration-200"
            >
              Remove
            </button>
          )}
        </div>
      ) : (
        <p className="font-lato text-text-secondary mb-4 text-sm">
          No beneficiary. The payout goes to your organization.
        </p>
      )}

      {editable && !chosenId && (
        <div className="mb-4">
          <label
            htmlFor="beneficiary-search"
            className="font-lato text-text-secondary mb-1 block text-xs font-semibold"
          >
            Search approved organizations
          </label>
          <input
            id="beneficiary-search"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Organization name"
            autoComplete="off"
            className="font-lato bg-bg-base border-border text-text-primary placeholder:text-text-muted focus:border-gold-bright w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
          />
          {searchError && (
            <p className="font-lato text-danger mt-2 text-xs">{searchError}</p>
          )}
          {showResults && results.length > 0 && (
            <ul className="border-border bg-bg-base mt-2 overflow-hidden rounded-lg border">
              {results.map((org) => (
                <li key={org.id} className="border-border border-b last:border-b-0">
                  <button
                    type="button"
                    onClick={() => choose(org)}
                    className="font-lato text-text-primary hover:bg-bg-raised w-full cursor-pointer bg-transparent px-3 py-2 text-left text-sm transition-colors"
                  >
                    {org.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!canNominate && (
        <p className="font-lato text-text-muted text-xs">
          Only an organization owner can change who receives the payout.
        </p>
      )}
      {canNominate && payoutData.locked && (
        <p className="font-lato text-text-muted text-xs">
          The payout recipient is locked because a player has already paid.
        </p>
      )}

      <div className="bg-warning/10 border-warning/30 mt-4 rounded-md border p-3">
        <p className="font-lato text-text-secondary text-xs leading-relaxed">
          The nominated organization must accept before anything changes, and its
          bank account and agreement must be in order. Nominating a beneficiary
          rules out early payouts for this tournament, and your organization stays
          fully liable for the money, whoever receives it. The choice locks once a
          player has paid.
        </p>
      </div>
    </div>
  );
}
