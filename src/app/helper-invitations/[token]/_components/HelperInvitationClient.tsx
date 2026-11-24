"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  rememberSignupReturnTo,
  SIGNUP_FORM_STORAGE_KEY,
} from "@/lib/auth/signup-storage";
import { HELPER_RELATIONSHIP_LABELS } from "@/lib/guardianship/helper-relationships";
import type { HelperInvitationView } from "@/services/guardianship/helpers";

interface Props {
  token: string;
  invitation: HelperInvitationView | null;
  loadFailed: boolean;
  signedIn: boolean;
  viewerEmail: string | null;
}

function Card({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <div className="auth-page">
      <div className="centered-col">
        <div className="auth-card card card--featured">
          <div className="auth-card-header">
            <span className="auth-logo">MY Chess Tour</span>
            <h1 className="auth-heading">{heading}</h1>
            <hr className="divider-gold" />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

function Message({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-lato text-text-secondary mb-4 text-center text-sm leading-relaxed">
      {children}
    </p>
  );
}

export default function HelperInvitationClient({
  token,
  invitation,
  loadFailed,
  signedIn,
  viewerEmail,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<"accepted" | "declined" | null>(null);
  const [agreed, setAgreed] = useState(false);

  if (loadFailed) {
    return (
      <Card heading="Something Went Wrong">
        <Message>
          We couldn&apos;t load this invitation. Please try again in a moment.
        </Message>
      </Card>
    );
  }

  if (!invitation) {
    return (
      <Card heading="Invitation Not Found">
        <Message>
          This invitation link isn&apos;t valid. Check that you copied the whole
          link from the email.
        </Message>
      </Card>
    );
  }

  const player = invitation.playerName ?? "This player";
  const role = HELPER_RELATIONSHIP_LABELS[invitation.relationship];

  if (outcome === "accepted") {
    return (
      <Card heading="You're Now a Helper">
        <Message>
          You can now help <strong>{player}</strong> as their {role}. They can
          remove you at any time, and you can step down from Settings.
        </Message>
        <Link href="/settings" className="btn-primary">
          Go to Settings
        </Link>
      </Card>
    );
  }

  if (outcome === "declined" || invitation.state === "declined") {
    return (
      <Card heading="Invitation Declined">
        <Message>
          You declined to help <strong>{player}</strong>. Nothing else is
          needed.
        </Message>
      </Card>
    );
  }

  if (invitation.state === "accepted") {
    return (
      <Card heading="Already Accepted">
        <Message>
          This invitation has already been used. Each invitation works once.
        </Message>
      </Card>
    );
  }

  if (invitation.state === "revoked") {
    return (
      <Card heading="Invitation Withdrawn">
        <Message>
          {player} withdrew this invitation. Ask them to send a new one if you
          think that&apos;s a mistake.
        </Message>
      </Card>
    );
  }

  if (invitation.state === "expired") {
    return (
      <Card heading="Invitation Expired">
        <Message>
          This invitation has expired. Invitations last 72 hours. Ask {player}{" "}
          to send a new one.
        </Message>
      </Card>
    );
  }

  async function respond(action: "accept" | "decline") {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/v1/helper-invitations/${token}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "accept" ? { accept_terms: true } : {}),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(
          json.error?.message ?? "Something went wrong. Please try again.",
        );
        return;
      }
      setOutcome(action === "accept" ? "accepted" : "declined");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  function createAccount() {
    try {
      sessionStorage.setItem(
        SIGNUP_FORM_STORAGE_KEY,
        JSON.stringify({ email: invitation!.email }),
      );
    } catch {}
    rememberSignupReturnTo(`/helper-invitations/${token}`);
    router.push("/auth/signup");
  }

  const expiry =
    invitation.hoursLeft <= 1
      ? "It expires within the hour."
      : `It expires in ${invitation.hoursLeft} hours.`;
  const path = `/helper-invitations/${token}`;

  return (
    <Card heading="Help a Player">
      <Message>
        <strong>{player}</strong> asked you to help with their MY Chess Tour
        account as their {role}. You&apos;d be able to register them for
        tournaments, pay for their entries and keep their player profile up to
        date, acting for them. {player} stays in charge of their account and can
        remove you at any time.
      </Message>
      <p className="font-lato text-text-muted mb-6 text-center text-xs">
        Sent to {invitation.email}. {expiry}
      </p>

      {error && (
        <div className="error-banner" role="alert">
          <span className="mt-px shrink-0 text-sm" aria-hidden="true">
            ⚠
          </span>
          <p className="error-text">{error}</p>
        </div>
      )}

      {signedIn && viewerEmail && (
        <p className="font-lato text-text-muted mb-4 text-center text-xs">
          You&apos;re signed in as {viewerEmail}. Accepting works only from the
          account this invitation was sent to.
        </p>
      )}

      <div className="flex flex-col gap-3">
        {signedIn && (
          <>
            <label className="font-lato text-text-secondary flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
              />
              <span>
                I&apos;m 18 or over, and I&apos;ll act for {player} under the{" "}
                <Link href="/terms" className="underline" target="_blank">
                  Terms
                </Link>
                , only as they authorise.
              </span>
            </label>
            <button
              type="button"
              className="btn-primary"
              disabled={busy !== null || !agreed}
              aria-disabled={busy !== null || !agreed}
              onClick={() => respond("accept")}
            >
              {busy === "accept" ? "Accepting…" : "Accept Invitation"}
            </button>
          </>
        )}

        {!signedIn && (
          <>
            <Link
              href={`/auth/login?redirectTo=${encodeURIComponent(path)}`}
              className="btn-primary"
            >
              Log In to Accept
            </Link>
            <button
              type="button"
              className="btn-secondary"
              onClick={createAccount}
            >
              Create an Account
            </button>
          </>
        )}

        <button
          type="button"
          className="btn-danger"
          disabled={busy !== null}
          aria-disabled={busy !== null}
          onClick={() => respond("decline")}
        >
          {busy === "decline" ? "Declining…" : "Decline"}
        </button>
      </div>
    </Card>
  );
}
