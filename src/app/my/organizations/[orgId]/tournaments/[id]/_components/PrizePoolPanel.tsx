"use client";

import { useEffect, useState } from "react";
import { formatRinggit } from "@/services/payouts/format";
import { prizeAwardStateLabel } from "@/services/prizes/problems";
import type { PrizePoolPosition } from "@/services/prizes/pool";
import type { PrizeAwardView } from "@/services/prizes/awards";
import type { PrizesJson } from "@/lib/tournaments/prize-funding";

// The organizer's side of a platform-managed prize pool (#523): fund it (forward
// a CHIP checkout link to each sponsor), then name the winners after the event.
// MY Chess Tour approves each award and sends the money; entry fees never fund
// any of it. Reads and writes go through the organization's prize routes, which
// enforce payout.view / payout.request.

interface Participant {
  user_id: string;
  name: string;
  status: string;
}

interface Funding {
  id: string;
  funder_name: string;
  funder_email: string;
  amount_cents: number;
  status: "pending" | "paid" | "failed";
  checkout_url: string | null;
  paid_at: string | null;
  created_at: string;
}

interface DeclaredPrize {
  key: string;
  category: string;
  place: string | null;
  amount_cents: number;
}

/** Every prize with money on it, as enter_prize_award identifies them. */
export function declaredPrizes(prizes: PrizesJson | null | undefined): DeclaredPrize[] {
  const out: DeclaredPrize[] = [];
  for (const cat of prizes?.categories ?? []) {
    for (const entry of cat.entries ?? []) {
      if (!cat.name || !entry.place || !(entry.amount_cents && entry.amount_cents > 0)) continue;
      out.push({
        key: `${cat.name}|${entry.place}`,
        category: cat.name,
        place: entry.place,
        amount_cents: entry.amount_cents,
      });
    }
  }
  for (const sp of prizes?.special ?? []) {
    if (!sp.name || !(sp.amount_cents && sp.amount_cents > 0)) continue;
    out.push({ key: `${sp.name}|`, category: sp.name, place: null, amount_cents: sp.amount_cents });
  }
  return out;
}

const FUNDING_STATUS: Record<Funding["status"], { label: string; className: string }> = {
  pending: { label: "Awaiting payment", className: "text-warning" },
  paid: { label: "Paid", className: "text-success" },
  failed: { label: "Failed", className: "text-danger" },
};

const AWARD_CLASS: Record<string, string> = {
  Paid: "text-success",
  Failed: "text-danger",
  Rejected: "text-danger",
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card flex flex-col gap-1 px-4 py-3">
      <p className="font-lato text-text-muted text-xs tracking-widest uppercase">{label}</p>
      <p className="font-cinzel text-text-primary text-lg font-bold">{value}</p>
    </div>
  );
}

async function readJson(res: Response) {
  return res.json().catch(() => null);
}

type PanelData =
  | { pool: PrizePoolPosition; fundings: Funding[]; awards: PrizeAwardView[] }
  | { error: string };

async function fetchPanel(base: string): Promise<PanelData> {
  try {
    const [fRes, aRes] = await Promise.all([
      fetch(`${base}/prize-funding`, { cache: "no-store" }),
      fetch(`${base}/prize-awards`, { cache: "no-store" }),
    ]);
    const [fJson, aJson] = await Promise.all([readJson(fRes), readJson(aRes)]);
    if (!fRes.ok || !aRes.ok) {
      return {
        error: fJson?.error?.message ?? aJson?.error?.message ?? "Couldn't load the prize pool.",
      };
    }
    return { pool: fJson.data.pool, fundings: fJson.data.fundings, awards: aJson.data.awards };
  } catch {
    return { error: "A network error occurred while loading the prize pool." };
  }
}

export default function PrizePoolPanel({
  orgId,
  tournamentId,
  prizes,
  participants,
}: {
  orgId: string;
  tournamentId: string;
  prizes: PrizesJson | null;
  participants: Participant[];
}) {
  const base = `/api/v1/organizations/${orgId}/tournaments/${tournamentId}`;
  const [pool, setPool] = useState<PrizePoolPosition | null>(null);
  const [fundings, setFundings] = useState<Funding[]>([]);
  const [awards, setAwards] = useState<PrizeAwardView[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Bumped after a successful write, to re-read the pool.
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((v) => v + 1);

  useEffect(() => {
    let cancelled = false;
    fetchPanel(base).then((result) => {
      if (cancelled) return;
      if ("error" in result) {
        setLoadError(result.error);
        return;
      }
      setLoadError(null);
      setPool(result.pool);
      setFundings(result.fundings);
      setAwards(result.awards);
    });
    return () => {
      cancelled = true;
    };
  }, [base, version]);

  // ---- funding form ----
  const [funderName, setFunderName] = useState("");
  const [funderEmail, setFunderEmail] = useState("");
  const [fundAmount, setFundAmount] = useState("");
  const [fundBusy, setFundBusy] = useState(false);
  const [fundError, setFundError] = useState<string | null>(null);
  const [newLink, setNewLink] = useState<string | null>(null);

  async function requestFunding() {
    setFundError(null);
    setNewLink(null);
    const trimmed = fundAmount.trim();
    const cents = trimmed ? Math.round(Number(trimmed) * 100) : undefined;
    if (cents !== undefined && (!Number.isSafeInteger(cents) || cents <= 0)) {
      setFundError("Enter an amount in ringgit, e.g. 500.00, or leave it blank for the rest.");
      return;
    }
    setFundBusy(true);
    try {
      const res = await fetch(`${base}/prize-funding`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          funder_name: funderName.trim(),
          funder_email: funderEmail.trim(),
          ...(cents !== undefined ? { amount_cents: cents } : {}),
        }),
      });
      const json = await readJson(res);
      if (!res.ok) {
        setFundError(json?.error?.message ?? "Couldn't create the payment link.");
        return;
      }
      setNewLink(json.data.checkout_url);
      setFunderName("");
      setFunderEmail("");
      setFundAmount("");
      reload();
    } catch {
      setFundError("A network error occurred. Please try again.");
    } finally {
      setFundBusy(false);
    }
  }

  // ---- winner form ----
  const options = declaredPrizes(prizes);
  const players = participants.filter((p) => p.status === "confirmed");
  const [winnerId, setWinnerId] = useState("");
  const [prizeKey, setPrizeKey] = useState("");
  const [awardAmount, setAwardAmount] = useState("");
  const [awardBusy, setAwardBusy] = useState(false);
  const [awardError, setAwardError] = useState<string | null>(null);
  const [awardMessage, setAwardMessage] = useState<string | null>(null);

  function choosePrize(key: string) {
    setPrizeKey(key);
    const prize = options.find((o) => o.key === key);
    setAwardAmount(prize ? (prize.amount_cents / 100).toFixed(2) : "");
  }

  async function enterWinner() {
    setAwardError(null);
    setAwardMessage(null);
    const prize = options.find((o) => o.key === prizeKey);
    const cents = Math.round(Number(awardAmount.trim()) * 100);
    if (!winnerId || !prize) {
      setAwardError("Choose the winner and the prize.");
      return;
    }
    if (!Number.isSafeInteger(cents) || cents <= 0) {
      setAwardError("Enter the amount in ringgit. Split a tied prize by entering each share.");
      return;
    }
    setAwardBusy(true);
    try {
      const res = await fetch(`${base}/prize-awards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: winnerId,
          category: prize.category,
          place: prize.place,
          amount_cents: cents,
        }),
      });
      const json = await readJson(res);
      if (!res.ok) {
        setAwardError(json?.error?.message ?? "Couldn't enter the winner.");
        return;
      }
      setAwardMessage("Entered. MY Chess Tour will check it against the results and send the prize.");
      setWinnerId("");
      setPrizeKey("");
      setAwardAmount("");
      reload();
    } catch {
      setAwardError("A network error occurred. Please try again.");
    } finally {
      setAwardBusy(false);
    }
  }

  if (loadError) {
    return (
      <div className="mb-8">
        <h2 className="font-cinzel text-text-primary mb-2 text-base font-bold tracking-wide">
          Prize Pool
        </h2>
        <p className="font-lato text-danger text-sm">{loadError}</p>
      </div>
    );
  }
  if (!pool) return null;

  const unfunded = Math.max(0, pool.declared_cents - pool.funded_cents);

  return (
    <div className="mb-8">
      <h2 className="font-cinzel text-text-primary mb-1 text-base font-bold tracking-wide">
        Prize Pool
      </h2>
      <p className="font-lato text-text-muted mb-3 text-xs">
        MY Chess Tour holds this tournament&apos;s prize money apart from your entry-fee revenue
        and pays the winners. {pool.fully_funded
          ? "The pool is fully funded, so registration is open."
          : `Registration opens once the full pool is paid in: ${formatRinggit(unfunded)} still to come.`}{" "}
        Anything not awarded is returned to the funders.
      </p>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Declared" value={formatRinggit(pool.declared_cents)} />
        <Stat label="Funded" value={formatRinggit(pool.funded_cents)} />
        <Stat label="Paid to winners" value={formatRinggit(pool.paid_out_cents)} />
        <Stat label="Uncommitted" value={formatRinggit(pool.available_cents)} />
      </div>

      {/* Funding */}
      <div className="card mb-4 flex flex-col gap-3 px-5 py-4">
        <h3 className="font-cinzel text-text-primary text-sm font-bold tracking-wide">Funding</h3>
        {unfunded > 0 && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <input
              className="input text-sm"
              placeholder="Sponsor name"
              aria-label="Sponsor name"
              value={funderName}
              onChange={(e) => setFunderName(e.target.value)}
              disabled={fundBusy}
            />
            <input
              className="input text-sm"
              type="email"
              placeholder="Sponsor email"
              aria-label="Sponsor email"
              value={funderEmail}
              onChange={(e) => setFunderEmail(e.target.value)}
              disabled={fundBusy}
            />
            <input
              className="input text-sm"
              inputMode="decimal"
              placeholder={`Amount (blank = ${formatRinggit(unfunded)})`}
              aria-label="Amount in ringgit"
              value={fundAmount}
              onChange={(e) => setFundAmount(e.target.value)}
              disabled={fundBusy}
            />
            <button
              type="button"
              className="btn-primary rounded-md px-4 py-2 text-xs sm:col-span-3 sm:w-fit"
              onClick={requestFunding}
              disabled={fundBusy || !funderName.trim() || !funderEmail.trim()}
            >
              {fundBusy ? "Creating…" : "Create payment link"}
            </button>
          </div>
        )}
        {fundError && <p className="font-lato text-danger text-xs">{fundError}</p>}
        {newLink && (
          <p className="font-lato text-success text-xs break-all">
            Send this link to the sponsor: <a href={newLink} className="underline">{newLink}</a>
          </p>
        )}
        {fundings.length > 0 && (
          <ul className="flex flex-col gap-1">
            {fundings.map((f) => (
              <li key={f.id} className="font-lato flex flex-wrap justify-between gap-2 text-sm">
                <span className="text-text-body">
                  {f.funder_name} · {formatRinggit(f.amount_cents)}
                </span>
                <span className={FUNDING_STATUS[f.status].className}>
                  {FUNDING_STATUS[f.status].label}
                  {f.status === "pending" && f.checkout_url && (
                    <>
                      {" · "}
                      <a href={f.checkout_url} className="underline">
                        payment link
                      </a>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Winners */}
      <div className="card flex flex-col gap-3 px-5 py-4">
        <h3 className="font-cinzel text-text-primary text-sm font-bold tracking-wide">Winners</h3>
        <p className="font-lato text-text-muted text-xs">
          Enter each winner from the arbiter&apos;s final results, from the last day of play.
          Nothing is paid until MY Chess Tour approves it, and a winner without verified bank
          details is asked to add them.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <select
            className="input text-sm"
            aria-label="Winner"
            value={winnerId}
            onChange={(e) => setWinnerId(e.target.value)}
            disabled={awardBusy}
          >
            <option value="">Winner…</option>
            {players.map((p) => (
              <option key={p.user_id} value={p.user_id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            className="input text-sm"
            aria-label="Prize"
            value={prizeKey}
            onChange={(e) => choosePrize(e.target.value)}
            disabled={awardBusy}
          >
            <option value="">Prize…</option>
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.place ? `${o.category} — ${o.place}` : o.category} ({formatRinggit(o.amount_cents)})
              </option>
            ))}
          </select>
          <input
            className="input text-sm"
            inputMode="decimal"
            placeholder="Amount (RM)"
            aria-label="Award amount in ringgit"
            value={awardAmount}
            onChange={(e) => setAwardAmount(e.target.value)}
            disabled={awardBusy}
          />
          <button
            type="button"
            className="btn-primary rounded-md px-4 py-2 text-xs sm:col-span-3 sm:w-fit"
            onClick={enterWinner}
            disabled={awardBusy}
          >
            {awardBusy ? "Entering…" : "Enter winner"}
          </button>
        </div>
        {awardError && <p className="font-lato text-danger text-xs">{awardError}</p>}
        {awardMessage && <p className="font-lato text-success text-xs">{awardMessage}</p>}
        {awards.length > 0 && (
          <ul className="flex flex-col gap-1">
            {awards.map((a) => {
              const state = prizeAwardStateLabel(a);
              return (
                <li key={a.id} className="font-lato flex flex-wrap justify-between gap-2 text-sm">
                  <span className="text-text-body">
                    {a.winner_name} · {a.place ? `${a.category} — ${a.place}` : a.category} ·{" "}
                    {formatRinggit(a.amount_cents)}
                  </span>
                  <span className={AWARD_CLASS[state] ?? "text-text-muted"}>
                    {state}
                    {a.approval === "rejected" && a.rejection_reason && ` — ${a.rejection_reason}`}
                    {a.approval === "approved" && a.status === "pending" && !a.winner_bank_status &&
                      " — waiting for the winner's bank details"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
