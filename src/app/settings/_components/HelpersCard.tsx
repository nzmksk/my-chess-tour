"use client";

import { useCallback, useEffect, useState } from "react";
import { formatInstantDate } from "@/lib/tournaments/datetime";
import {
  HELPER_RELATIONSHIPS,
  HELPER_RELATIONSHIP_LABELS,
  isHelperRelationship,
  type HelperRelationship,
} from "@/lib/guardianship/helper-relationships";
import type {
  HelpersOverview,
  HelperView,
  PendingHelperInvitation,
} from "@/services/guardianship/helpers";

const RELATIONSHIP_OPTION_LABELS: Record<HelperRelationship, string> = {
  carer: "Carer",
  parent: "Parent",
  coach: "Coach",
  other: "Someone else",
};

function relationshipLabel(relationship: string): string {
  return isHelperRelationship(relationship)
    ? HELPER_RELATIONSHIP_LABELS[relationship]
    : relationship.replace("_", " ");
}

function date(iso: string): string {
  return formatInstantDate(iso, undefined, { withZone: false });
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const json = await res.json().catch(() => null);
  return json?.error?.message ?? fallback;
}

async function fetchOverview(): Promise<HelpersOverview | null> {
  try {
    const res = await fetch("/api/v1/me/helpers", { cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data ?? null;
  } catch {
    return null;
  }
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="font-cinzel text-gold-muted mb-2 text-xs font-semibold tracking-widest uppercase">
      {children}
    </h3>
  );
}

function PersonRow({
  person,
  actionLabel,
  confirmText,
  confirmLabel,
  onConfirm,
}: {
  person: HelperView;
  actionLabel: string;
  confirmText: string;
  confirmLabel: string;
  onConfirm: () => Promise<string | null>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = person.name ?? "Unnamed player";

  async function confirm() {
    setBusy(true);
    setError(null);
    const failure = await onConfirm();
    setBusy(false);
    if (failure) setError(failure);
  }

  return (
    <li className="border-border border-b py-3 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-lato text-text-primary text-sm">{name}</p>
          <p className="font-lato text-text-muted text-xs">
            {relationshipLabel(person.relationship)} · since{" "}
            {date(person.since)}
          </p>
        </div>
        {!confirming && (
          <button
            type="button"
            className="font-lato text-text-muted hover:text-text-secondary text-sm underline"
            onClick={() => setConfirming(true)}
            aria-label={`${actionLabel}: ${name}`}
          >
            {actionLabel}
          </button>
        )}
      </div>
      {confirming && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="font-lato text-text-secondary text-sm">{confirmText}</p>
          {error && (
            <p className="font-lato text-sm text-red-400" role="alert">
              {error}
            </p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              className="btn-secondary w-fit rounded-md"
              onClick={() => {
                setConfirming(false);
                setError(null);
              }}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary w-fit rounded-md"
              onClick={confirm}
              disabled={busy}
            >
              {busy ? "Working…" : confirmLabel}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function InvitationRow({
  invitation,
  onWithdraw,
  onResend,
}: {
  invitation: PendingHelperInvitation;
  onWithdraw: () => Promise<string | null>;
  onResend: () => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    const failure = await action();
    setBusy(false);
    if (failure) setError(failure);
  }

  const expired = invitation.state === "expired";

  return (
    <li className="border-border border-b py-3 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-lato text-text-primary text-sm">
            {invitation.email}
          </p>
          <p className="font-lato text-text-muted text-xs">
            {relationshipLabel(invitation.relationship)} ·{" "}
            {expired
              ? "expired"
              : `waiting for an answer until ${date(invitation.expires_at)}`}
          </p>
        </div>
        <div className="flex gap-3">
          {expired && (
            <button
              type="button"
              className="font-lato text-text-muted hover:text-text-secondary text-sm underline"
              disabled={busy}
              onClick={() => run(onResend)}
            >
              Resend
            </button>
          )}
          <button
            type="button"
            className="font-lato text-text-muted hover:text-text-secondary text-sm underline"
            disabled={busy}
            onClick={() => run(onWithdraw)}
            aria-label={`Withdraw the invitation to ${invitation.email}`}
          >
            Withdraw
          </button>
        </div>
      </div>
      {error && (
        <p className="font-lato mt-2 text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

export default function HelpersCard() {
  const [overview, setOverview] = useState<HelpersOverview | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [email, setEmail] = useState("");
  const [relationship, setRelationship] = useState<HelperRelationship>("carer");
  const [sending, setSending] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteNotice, setInviteNotice] = useState<string | null>(null);

  const apply = useCallback((data: HelpersOverview | null) => {
    if (data) setOverview(data);
    setLoadError(data === null);
  }, []);

  const load = useCallback(async () => apply(await fetchOverview()), [apply]);

  useEffect(() => {
    let cancelled = false;
    fetchOverview().then((data) => {
      if (!cancelled) apply(data);
    });
    return () => {
      cancelled = true;
    };
  }, [apply]);

  async function invite(
    to: string,
    as: HelperRelationship,
  ): Promise<string | null> {
    try {
      const res = await fetch("/api/v1/me/helpers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: to, relationship: as }),
      });
      if (!res.ok) {
        return errorMessage(res, "The invitation couldn't be sent.");
      }
      const json = await res.json();
      setInviteNotice(
        json.data.email_sent
          ? `Invitation sent to ${json.data.email}. It expires in 72 hours.`
          : `The invitation to ${json.data.email} was saved, but the email didn't go out. Use Resend to try again.`,
      );
      await load();
      return null;
    } catch {
      return "A network error occurred. Please try again.";
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setInviteError(null);
    setInviteNotice(null);
    const failure = await invite(email.trim(), relationship);
    setSending(false);
    if (failure) {
      setInviteError(failure);
    } else {
      setEmail("");
    }
  }

  async function remove(url: string, fallback: string): Promise<string | null> {
    try {
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) return errorMessage(res, fallback);
      await load();
      return null;
    } catch {
      return "A network error occurred. Please try again.";
    }
  }

  return (
    <div className="card p-6">
      <h2 className="font-cinzel text-text-primary border-border mb-4 border-b pb-3 text-base font-semibold tracking-wider">
        Helpers
      </h2>

      {loadError && (
        <p className="font-lato text-sm text-red-400" role="alert">
          We couldn&apos;t load your helpers. Refresh the page to try again.
        </p>
      )}

      {!overview && !loadError && (
        <p className="font-lato text-text-muted text-sm">Loading…</p>
      )}

      {overview && (
        <div className="flex flex-col gap-6">
          {overview.can_invite && (
            <section>
              <p className="font-lato text-text-muted mb-4 text-sm">
                A helper, such as a carer, can register you for tournaments, pay
                for your entries and update your player profile for you. You
                stay in charge of your account and can remove a helper at any
                time. Your helper needs their own MY Chess Tour account.
              </p>

              {overview.helpers.length > 0 && (
                <div className="mb-4">
                  <SectionHeading>Your helpers</SectionHeading>
                  <ul>
                    {overview.helpers.map((helper) => (
                      <PersonRow
                        key={helper.guardianship_id}
                        person={helper}
                        actionLabel="Remove"
                        confirmText={`${helper.name ?? "This helper"} will no longer be able to act for you. Registrations and payments they already made stay as they are.`}
                        confirmLabel="Remove helper"
                        onConfirm={() =>
                          remove(
                            `/api/v1/me/helpers/${helper.guardianship_id}`,
                            "The helper couldn't be removed.",
                          )
                        }
                      />
                    ))}
                  </ul>
                </div>
              )}

              {overview.invitations.length > 0 && (
                <div className="mb-4">
                  <SectionHeading>Invitations</SectionHeading>
                  <ul>
                    {overview.invitations.map((invitation) => (
                      <InvitationRow
                        key={invitation.id}
                        invitation={invitation}
                        onWithdraw={() =>
                          remove(
                            `/api/v1/me/helper-invitations/${invitation.id}`,
                            "The invitation couldn't be withdrawn.",
                          )
                        }
                        onResend={() =>
                          invite(invitation.email, invitation.relationship)
                        }
                      />
                    ))}
                  </ul>
                </div>
              )}

              <form onSubmit={handleInvite} className="flex flex-col gap-3">
                <SectionHeading>Invite a helper</SectionHeading>
                <label className="font-lato text-text-secondary flex flex-col gap-1 text-sm">
                  Their email address
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="input"
                    autoComplete="off"
                  />
                </label>
                <label className="font-lato text-text-secondary flex flex-col gap-1 text-sm">
                  They are your
                  <select
                    value={relationship}
                    onChange={(e) =>
                      setRelationship(e.target.value as HelperRelationship)
                    }
                    className="input"
                  >
                    {HELPER_RELATIONSHIPS.map((value) => (
                      <option key={value} value={value}>
                        {RELATIONSHIP_OPTION_LABELS[value]}
                      </option>
                    ))}
                  </select>
                </label>
                {inviteError && (
                  <p className="font-lato text-sm text-red-400" role="alert">
                    {inviteError}
                  </p>
                )}
                {inviteNotice && (
                  <p
                    className="font-lato text-sm text-emerald-400"
                    role="status"
                  >
                    {inviteNotice}
                  </p>
                )}
                <button
                  type="submit"
                  className="btn-primary w-fit rounded-md"
                  disabled={sending || !email.trim()}
                >
                  {sending ? "Sending…" : "Send invitation"}
                </button>
              </form>
            </section>
          )}

          {overview.helping.length > 0 && (
            <section>
              <SectionHeading>Players you help</SectionHeading>
              <ul>
                {overview.helping.map((player) => (
                  <PersonRow
                    key={player.guardianship_id}
                    person={player}
                    actionLabel="Step down"
                    confirmText={`You will no longer be able to act for ${player.name ?? "this player"}. Registrations and payments you already made stay as they are.`}
                    confirmLabel="Step down"
                    onConfirm={() =>
                      remove(
                        `/api/v1/me/helpers/${player.guardianship_id}`,
                        "You couldn't step down. Please try again.",
                      )
                    }
                  />
                ))}
              </ul>
            </section>
          )}

          {!overview.can_invite && overview.helping.length === 0 && (
            <p className="font-lato text-text-muted text-sm">
              Helpers are available to players aged 18 or over who sign in to
              their own account.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
