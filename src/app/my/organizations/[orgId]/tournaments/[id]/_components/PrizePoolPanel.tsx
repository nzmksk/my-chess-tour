"use client";

import { useEffect, useState } from "react";
import { formatRinggit } from "@/services/payouts/format";
import { prizeAwardStateLabel } from "@/services/prizes/problems";
import type { PrizePoolPosition } from "@/services/prizes/pool";
import type { PrizeAwardView } from "@/services/prizes/awards";
import type { PrizesJson } from "@/lib/tournaments/prize-funding";

// The organizer's side of a platform-managed prize pool (#523). Funding is
// automatic: publishing emailed every sponsor a CHIP payment link for their
// share, and the tournament stays unlisted until the pool is paid in. This
// shows where each sponsor stands, retries a link that didn't go out, and,
// after the event, takes the winners. MY Chess Tour approves each award and
// sends the money; entry fees never fund any of it. Reads and writes go through
// the organization's prize routes, which enforce payout.view / payout.request.

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
  /** Superseded by a newer request (the share changed) or withdrawn. */
  cancelled_at: string | null;
  created_at: string;
}

interface DeclaredPrize {
  key: string;
  category: string;
  place: string | null;
  amount_cents: number;
}

/** Every prize with money on it, as enter_prize_award identifies them. */
export function declaredPrizes(
  prizes: PrizesJson | null | undefined,
): DeclaredPrize[] {
  const out: DeclaredPrize[] = [];
  for (const cat of prizes?.categories ?? []) {
    for (const entry of cat.entries ?? []) {
      if (
        !cat.name ||
        !entry.place ||
        !(entry.amount_cents && entry.amount_cents > 0)
      )
        continue;
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
    out.push({
      key: `${sp.name}|`,
      category: sp.name,
      place: null,
      amount_cents: sp.amount_cents,
    });
  }
  return out;
}

const FUNDING_STATUS: Record<
  Funding["status"],
  { label: string; className: string }
> = {
  pending: { label: "Awaiting payment", className: "text-warning" },
  paid: { label: "Paid", className: "text-success" },
  failed: { label: "Failed", className: "text-danger" },
};

const AWARD_CLASS: Record<string, string> = {
  Paid: "text-success",
  Failed: "text-danger",
  Rejected: "text-danger",
  Withdrawn: "text-text-muted",
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card flex flex-col gap-1 px-4 py-3">
      <p className="font-lato text-text-muted text-xs tracking-widest uppercase">
        {label}
      </p>
      <p className="font-cinzel text-text-primary text-lg font-bold">{value}</p>
    </div>
  );
}

async function readJson(res: Response) {
  return res.json().catch(() => null);
}

type PanelData =
  | {
      pool: PrizePoolPosition;
      status: string;
      fundings: Funding[];
      missingContacts: string[];
      awards: PrizeAwardView[];
    }
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
        error:
          fJson?.error?.message ??
          aJson?.error?.message ??
          "Couldn't load the prize pool.",
      };
    }
    return {
      pool: fJson.data.pool,
      status: fJson.data.status,
      fundings: fJson.data.fundings,
      missingContacts: fJson.data.missing_contacts ?? [],
      awards: aJson.data.awards,
    };
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
  const [status, setStatus] = useState<string>("");
  const [fundings, setFundings] = useState<Funding[]>([]);
  const [missingContacts, setMissingContacts] = useState<string[]>([]);
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
      setStatus(result.status);
      setFundings(result.fundings);
      setMissingContacts(result.missingContacts);
      setAwards(result.awards);
    });
    return () => {
      cancelled = true;
    };
  }, [base, version]);

  // ---- funding ----
  const [retryBusy, setRetryBusy] = useState(false);
  const [retryMessage, setRetryMessage] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function retryLinks() {
    setRetryMessage(null);
    setRetryBusy(true);
    try {
      const res = await fetch(`${base}/prize-funding`, { method: "POST" });
      const json = await readJson(res);
      if (!res.ok) {
        setRetryMessage({
          ok: false,
          text: json?.error?.message ?? "Couldn't send the links.",
        });
        return;
      }
      setRetryMessage({
        ok: true,
        text:
          json.data.linked > 0
            ? `Sent ${json.data.linked} payment link${json.data.linked === 1 ? "" : "s"}.`
            : "Nothing outstanding to send.",
      });
      reload();
    } catch {
      setRetryMessage({
        ok: false,
        text: "A network error occurred. Please try again.",
      });
    } finally {
      setRetryBusy(false);
    }
  }

  async function copyLink(f: Funding) {
    if (!f.checkout_url) return;
    try {
      await navigator.clipboard.writeText(f.checkout_url);
      setCopiedId(f.id);
    } catch {
      // Clipboard blocked (insecure context, permissions): the sponsor was
      // emailed the link anyway.
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
      setAwardError(
        "Enter the amount in ringgit. Split a tied prize by entering each share.",
      );
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
      setAwardMessage(
        "Entered. MY Chess Tour will check it against the results and send the prize.",
      );
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

  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);

  async function withdrawAward(award: PrizeAwardView) {
    setAwardError(null);
    setAwardMessage(null);
    setWithdrawingId(award.id);
    try {
      const res = await fetch(`${base}/prize-awards/${award.id}/withdraw`, {
        method: "POST",
      });
      const json = await readJson(res);
      if (!res.ok) {
        setAwardError(json?.error?.message ?? "Couldn't withdraw the award.");
        reload();
        return;
      }
      setAwardMessage(
        "Withdrawn. You can enter the corrected winner for that prize above.",
      );
      reload();
    } catch {
      setAwardError("A network error occurred. Please try again.");
    } finally {
      setWithdrawingId(null);
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
  const pending = status === "pending_funding";
  // A superseded request is history unless it was paid anyway.
  const shown = fundings.filter((f) => !f.cancelled_at || f.status === "paid");
  const unlinked = shown.some((f) => f.status === "pending" && !f.checkout_url);

  return (
    <div className="mb-8">
      <h2 className="font-cinzel text-text-primary mb-1 text-base font-bold tracking-wide">
        Prize Pool
      </h2>
      <p className="font-lato text-text-muted mb-3 text-xs">
        MY Chess Tour holds this tournament&apos;s prize money apart from your
        entry-fee revenue and pays the winners.{" "}
        {pending
          ? `Each sponsor has been emailed a payment link for their share. The tournament stays hidden from players until the full pool is paid in: ${formatRinggit(unfunded)} still to come.`
          : pool.fully_funded
            ? "The pool is fully funded, so the tournament is listed and registration is open."
            : `The prizes were raised, so registration is paused until the top-up is paid: ${formatRinggit(unfunded)} still to come.`}{" "}
        Anything not awarded is returned to the funders.
      </p>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Declared" value={formatRinggit(pool.declared_cents)} />
        <Stat label="Funded" value={formatRinggit(pool.funded_cents)} />
        <Stat
          label="Paid to winners"
          value={formatRinggit(pool.paid_out_cents)}
        />
        <Stat label="Uncommitted" value={formatRinggit(pool.available_cents)} />
      </div>

      {/* Funding */}
      <div className="card mb-4 flex flex-col gap-3 px-5 py-4">
        <h3 className="font-cinzel text-text-primary text-sm font-bold tracking-wide">
          Sponsors
        </h3>
        {missingContacts.length > 0 && (
          <p className="font-lato text-warning text-xs">
            No email address for {missingContacts.join(", ")}, so no payment
            link has been sent. Add it under Edit Tournament, Prizes, and the
            link goes out when you save.
          </p>
        )}
        {shown.length === 0 && missingContacts.length === 0 && (
          <p className="font-lato text-text-muted text-xs">
            Payment links are sent to the sponsors when the tournament is
            published.
          </p>
        )}
        {shown.length > 0 && (
          <ul className="flex flex-col gap-2">
            {shown.map((f) => (
              <li
                key={f.id}
                className="font-lato flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <span className="text-text-body">
                  {f.funder_name} · {formatRinggit(f.amount_cents)}
                  <span className="text-text-muted block text-xs">
                    {f.funder_email}
                  </span>
                </span>
                <span
                  className={`${FUNDING_STATUS[f.status].className} flex items-center gap-2 text-xs`}
                >
                  {f.status === "pending" && !f.checkout_url
                    ? "Link not sent yet"
                    : FUNDING_STATUS[f.status].label}
                  {f.status === "pending" && f.checkout_url && (
                    <button
                      type="button"
                      className="text-accent cursor-pointer underline"
                      onClick={() => copyLink(f)}
                    >
                      {copiedId === f.id ? "Copied" : "Copy link"}
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {unlinked && (
          <button
            type="button"
            className="btn-primary w-fit rounded-md px-4 py-2 text-xs"
            onClick={retryLinks}
            disabled={retryBusy}
          >
            {retryBusy ? "Sending…" : "Retry sending links"}
          </button>
        )}
        {retryMessage && (
          <p
            className={`font-lato text-xs ${retryMessage.ok ? "text-success" : "text-danger"}`}
          >
            {retryMessage.text}
          </p>
        )}
      </div>

      {/* Winners: only once the tournament is listed and can have players. */}
      {!pending && (
        <div className="card flex flex-col gap-3 px-5 py-4">
          <h3 className="font-cinzel text-text-primary text-sm font-bold tracking-wide">
            Winners
          </h3>
          <p className="font-lato text-text-muted text-xs">
            Enter each winner from the arbiter&apos;s final results, from the
            last day of play. Nothing is paid until MY Chess Tour approves it,
            and a winner without verified bank details is asked to add them.
            Entered the wrong winner or amount? Withdraw it while it awaits
            review and enter it again.
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
                  {o.place ? `${o.category} — ${o.place}` : o.category} (
                  {formatRinggit(o.amount_cents)})
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
          {awardError && (
            <p className="font-lato text-danger text-xs">{awardError}</p>
          )}
          {awardMessage && (
            <p className="font-lato text-success text-xs">{awardMessage}</p>
          )}
          {awards.length > 0 && (
            <ul className="flex flex-col gap-1">
              {awards.map((a) => {
                const state = prizeAwardStateLabel(a);
                const withdrawable =
                  a.approval === "pending" && !a.withdrawn_at;
                return (
                  <li
                    key={a.id}
                    className="font-lato flex flex-wrap items-center justify-between gap-2 text-sm"
                  >
                    <span className="text-text-body">
                      {a.winner_name} ·{" "}
                      {a.place ? `${a.category} — ${a.place}` : a.category} ·{" "}
                      {formatRinggit(a.amount_cents)}
                    </span>
                    <span className={AWARD_CLASS[state] ?? "text-text-muted"}>
                      {state}
                      {a.approval === "rejected" &&
                        !a.withdrawn_at &&
                        a.rejection_reason &&
                        ` — ${a.rejection_reason}`}
                      {a.approval === "approved" &&
                        a.status === "pending" &&
                        !a.winner_bank_status &&
                        (a.payee_reason === "guardian_of_minor"
                          ? " — waiting for the guardian's bank details"
                          : " — waiting for the winner's bank details")}
                      {withdrawable && (
                        <button
                          type="button"
                          className="text-accent ml-2 cursor-pointer text-xs underline disabled:cursor-not-allowed disabled:opacity-50"
                          onClick={() => withdrawAward(a)}
                          disabled={withdrawingId !== null}
                          aria-label={`Withdraw the award to ${a.winner_name}`}
                        >
                          {withdrawingId === a.id ? "Withdrawing…" : "Withdraw"}
                        </button>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
