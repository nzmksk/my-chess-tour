"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { checkPasswordRequirements } from "@/services/auth/auth-validation";
import type { AccountClaimState } from "@/services/guardianship/account-claims";

export interface ClaimSummary {
  state: AccountClaimState;
  email: string;
  playerFirstName: string;
  guardianName: string;
}

interface Props {
  token: string;
  claim: ClaimSummary | null;
  loadFailed: boolean;
}

const REQUIREMENTS: {
  key: keyof ReturnType<typeof checkPasswordRequirements>;
  label: string;
}[] = [
  { key: "minLength", label: "8+ characters" },
  { key: "hasUppercase", label: "1 uppercase letter" },
  { key: "hasNumber", label: "1 number" },
  { key: "hasLowercase", label: "1 lowercase letter" },
  { key: "hasSymbol", label: "1 symbol (!@#$…)" },
];

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

export default function ClaimClient({ token, claim, loadFailed }: Props) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  if (loadFailed) {
    return (
      <Card heading="Something Went Wrong">
        <Message>
          We couldn&apos;t load this link. Please try again in a moment.
        </Message>
      </Card>
    );
  }

  if (!claim) {
    return (
      <Card heading="Link Not Found">
        <Message>
          This link isn&apos;t valid. Check that you copied the whole link from
          the email.
        </Message>
      </Card>
    );
  }

  if (done || claim.state === "accepted") {
    return (
      <Card heading={done ? "Your Account Is Ready" : "Already Set Up"}>
        <Message>
          {done
            ? "Your player record is now yours. "
            : "This link has already been used. "}
          Sign in with <strong>{claim.email}</strong>.
        </Message>
        <Link href="/auth/login" className="btn-primary">
          Sign In
        </Link>
      </Card>
    );
  }

  if (claim.state === "expired") {
    return (
      <Card heading="Link Expired">
        <Message>
          This link has expired. Links last 72 hours. Ask {claim.guardianName}{" "}
          to send a new one.
        </Message>
      </Card>
    );
  }

  if (claim.state === "closed") {
    return (
      <Card heading="Link No Longer Valid">
        <Message>
          This link can&apos;t be used any more. Ask {claim.guardianName} for a
          new one.
        </Message>
      </Card>
    );
  }

  const requirements = checkPasswordRequirements(password);
  const passwordOk = Object.values(requirements).every(Boolean);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const problem = !passwordOk
      ? "Your password doesn't meet the requirements yet."
      : password !== confirm
        ? "The passwords don't match."
        : !agreed
          ? "Please accept the Terms of Service and Privacy Policy."
          : null;
    if (problem) {
      setError(problem);
      errorRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/account-claims/${token}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, accept_terms: true }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(
          json?.error?.message ?? "Something went wrong. Please try again.",
        );
        errorRef.current?.focus();
        return;
      }
      setDone(true);
    } catch {
      setError("Network error. Please try again.");
      errorRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card heading="Set Up Your Account">
      <Message>
        Hi {claim.playerFirstName}, <strong>{claim.guardianName}</strong> is
        handing your MY Chess Tour player record over to you. You&apos;ll sign
        in with <strong>{claim.email}</strong>.
      </Message>
      <div className="info-banner">
        <p className="info-text">
          You keep your registrations, results, player profile and public
          profile page. Once you set your password, {claim.guardianName} can no
          longer manage your record. Payments they made stay with them.
        </p>
      </div>

      <div ref={errorRef} tabIndex={-1} className="outline-none">
        {error && (
          <div className="error-banner" role="alert">
            <p className="error-text">{error}</p>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} noValidate>
        <div className="form-group">
          <div className="label-row">
            <label className="input-label" htmlFor="claim-password">
              Password
            </label>
          </div>
          <div className="input-wrap">
            <input
              id="claim-password"
              className="input input--icon"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              aria-describedby="claim-password-requirements"
              required
            />
            <button
              type="button"
              className="eye-btn"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              <span
                className={showPassword ? "eye-off-icon" : "eye-icon"}
                aria-hidden="true"
              />
            </button>
          </div>
          <div id="claim-password-requirements" className="pw-requirements">
            <p className="pw-req-title">Password must contain</p>
            <ul className="pw-req-grid">
              {REQUIREMENTS.map(({ key, label }) => (
                <li
                  key={key}
                  className={`pw-req${requirements[key] ? "pw-req--met" : ""}`}
                >
                  <div className="pw-req-dot" aria-hidden="true" />
                  {label}
                  <span className="sr-only">
                    {requirements[key] ? " (met)" : " (not met yet)"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="form-group">
          <div className="label-row">
            <label className="input-label" htmlFor="claim-confirm">
              Confirm Password
            </label>
          </div>
          <input
            id="claim-confirm"
            className="input"
            type={showPassword ? "text" : "password"}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
          />
        </div>

        <div className="check-row">
          <input
            id="claim-terms"
            type="checkbox"
            className="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
          />
          <label className="check-label" htmlFor="claim-terms">
            I accept the{" "}
            <Link href="/terms" target="_blank">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy" target="_blank">
              Privacy Policy
            </Link>
            .
          </label>
        </div>

        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Setting Up…" : "Create My Account"}
        </button>
      </form>
    </Card>
  );
}
