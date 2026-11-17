"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ROLE_CONFIG } from "@/lib/auth/roles";
import {
  rememberSignupReturnTo,
  SIGNUP_FORM_STORAGE_KEY,
} from "@/lib/auth/signup-storage";
import type { InvitationView } from "@/services/organizations/invitations";

interface Props {
  token: string;
  invitation: InvitationView | null;
  loadFailed: boolean;
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

export default function InvitationClient({
  token,
  invitation,
  loadFailed,
  viewerEmail,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);

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

  const org = invitation.organization;
  const invitedBy = invitation.inviterName ?? "Someone";
  const roleLabel = ROLE_CONFIG[invitation.role].label.toLowerCase();
  const signedInAsInvitee =
    viewerEmail !== null &&
    viewerEmail.toLowerCase() === invitation.email.toLowerCase();
  const path = `/invitations/${token}`;

  if (declined || invitation.state === "declined") {
    return (
      <Card heading="Invitation Declined">
        <Message>
          You declined the invitation to join <strong>{org.name}</strong>.
          Nothing else is needed.
        </Message>
      </Card>
    );
  }

  if (invitation.state === "accepted") {
    return (
      <Card heading="Already Accepted">
        <Message>
          This invitation to join <strong>{org.name}</strong> has already been
          accepted.
        </Message>
        {signedInAsInvitee && (
          <Link href={`/my/organizations/${org.id}`} className="btn-primary">
            Go to Dashboard
          </Link>
        )}
      </Card>
    );
  }

  if (invitation.state === "revoked") {
    return (
      <Card heading="Invitation Withdrawn">
        <Message>
          {org.name} withdrew this invitation. If you think that&apos;s a
          mistake, ask them to send a new one.
        </Message>
      </Card>
    );
  }

  if (invitation.state === "expired") {
    return (
      <Card heading="Invitation Expired">
        <Message>
          This invitation to join <strong>{org.name}</strong> has expired.
          Invitations last 30 days. Ask {invitedBy} to send a new one.
        </Message>
      </Card>
    );
  }

  if (!org.available) {
    return (
      <Card heading="Invitation Unavailable">
        <Message>
          {org.name} isn&apos;t accepting new members right now.
        </Message>
      </Card>
    );
  }

  async function respond(action: "accept" | "decline") {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/v1/invitations/${token}/${action}`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error?.message ?? "Something went wrong. Please try again.");
        return;
      }
      if (action === "accept") {
        router.push(`/my/organizations/${json.data.organization_id}`);
        router.refresh();
      } else {
        setDeclined(true);
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  function createAccount() {
    // Seed signup the way login seeds the verify step: prefill the invited
    // address, and come back here once the account is verified.
    try {
      sessionStorage.setItem(
        SIGNUP_FORM_STORAGE_KEY,
        JSON.stringify({ email: invitation!.email }),
      );
    } catch {
      // Unavailable storage: they can still type the address themselves.
    }
    rememberSignupReturnTo(path);
    router.push("/auth/signup");
  }

  // daysLeft is computed on the server, so both renders show the same text.
  const expiry =
    invitation.daysLeft <= 1
      ? "It expires within a day."
      : `It expires in ${invitation.daysLeft} days.`;

  return (
    <Card heading="You're Invited">
      <Message>
        {invitedBy} invited you to join <strong>{org.name}</strong> on MY Chess
        Tour as {roleLabel === "admin" ? "an" : "a"} {roleLabel}.
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

      {viewerEmail !== null && !signedInAsInvitee && (
        <div className="info-banner" role="status">
          <p className="info-text">
            You&apos;re signed in as {viewerEmail}. To accept, log out and sign
            in as {invitation.email}.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {signedInAsInvitee && (
          <button
            type="button"
            className="btn-primary"
            disabled={busy !== null}
            aria-disabled={busy !== null}
            onClick={() => respond("accept")}
          >
            {busy === "accept" ? "Joining…" : "Accept Invitation"}
          </button>
        )}

        {viewerEmail === null && (
          <>
            <Link
              href={`/auth/login?redirectTo=${encodeURIComponent(path)}`}
              className="btn-primary"
            >
              Log In to Accept
            </Link>
            <button type="button" className="btn-secondary" onClick={createAccount}>
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
