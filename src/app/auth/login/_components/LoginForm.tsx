"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { login } from "../_actions/login";
import { INITIAL_LOGIN_STATE } from "../types";
import { SIGNUP_FORM_STORAGE_KEY } from "@/lib/signup-storage";

export default function LoginForm({
  successMessage,
}: {
  successMessage?: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    login,
    INITIAL_LOGIN_STATE,
  );
  const [showPassword, setShowPassword] = useState(false);
  const [emailValue, setEmailValue] = useState("");
  const [passwordValue, setPasswordValue] = useState("");

  // Correct password but unverified account: seed the verify step with the
  // email (so it can prefill and resend the code) and send them there. The
  // password is deliberately not stored — the verify endpoint mints the
  // session server-side without it.
  useEffect(() => {
    if (!state.needsVerification) return;
    try {
      sessionStorage.setItem(
        SIGNUP_FORM_STORAGE_KEY,
        JSON.stringify({
          email: emailValue.trim(),
        }),
      );
    } catch {
      // Ignore unavailable storage; the verify page can still resend.
    }
    router.push("/auth/signup/verify");
  }, [state, router, emailValue]);

  // Screen 2C — Account Locked
  if (state.locked) {
    const minutes = state.lockedSeconds
      ? Math.ceil(state.lockedSeconds / 60)
      : 15;
    return (
      <div className="auth-page">
        <div className="centered-col">
          <div className="auth-card card mx-0 my-auto max-w-100 text-center">
            <div
              className="confirm-icon confirm-icon--danger"
              role="img"
              aria-label="Account locked"
            >
              ♙
            </div>
            <h1 className="confirm-title">Account Locked</h1>
            <p className="confirm-body">
              Too many failed sign-in attempts. Your account has been
              temporarily locked.
              <br />
              <br />
              <strong className="font-cinzel text-gold-muted tracking-wider">
                Unlocks in ~{minutes} minute{minutes !== 1 ? "s" : ""}
              </strong>
            </p>
            <div className="confirm-actions">
              <Link href="/auth/forgot-password" className="btn-primary">
                Reset Password
              </Link>
              <a
                href="mailto:mychesstour@gmail.com"
                className="btn-secondary mt-2 block text-center"
              >
                Contact Support
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Screen 2A / 2B — Login form (clean or with errors)
  return (
    <div className="auth-page">
      <div className="centered-col">
        <div className="auth-card card card--featured">
          <div className="auth-card-header">
            <span className="auth-logo">MY Chess Tour</span>
            <h1 className="auth-heading">Welcome Back</h1>
            <p className="auth-subheading">
              Enter your credentials to continue
            </p>
            <hr className="divider-gold" />
          </div>

          {successMessage && (
            <div className="success-banner" role="status">
              <span className="mt-px shrink-0 text-sm" aria-hidden="true">
                ✓
              </span>
              <p className="success-text">{successMessage}</p>
            </div>
          )}

          {state.error && (
            <div className="error-banner" role="alert">
              <span className="mt-px shrink-0 text-sm" aria-hidden="true">
                ⚠
              </span>
              <p className="error-text">
                {state.error}
                {state.attemptsRemaining !== null &&
                  state.attemptsRemaining > 0 && (
                    <>
                      {" "}
                      <strong>
                        {state.attemptsRemaining} attempt
                        {state.attemptsRemaining !== 1 ? "s" : ""} remaining
                      </strong>{" "}
                      before your account is temporarily locked.
                    </>
                  )}
              </p>
            </div>
          )}

          <form action={formAction}>
            {/* Email */}
            <div className="form-group">
              <div className="label-row">
                <label className="input-label" htmlFor="email">
                  Email Address
                </label>
              </div>
              <input
                id="email"
                name="email"
                className="input"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                required
                value={emailValue}
                onChange={(e) => setEmailValue(e.target.value)}
              />
            </div>

            {/* Password */}
            <div className="form-group mb-1">
              <div className="label-row">
                <label className="input-label" htmlFor="password">
                  Password
                </label>
              </div>
              <div className="input-wrap">
                <input
                  id="password"
                  name="password"
                  className={`input input--icon${state.error ? " input-error" : ""}`}
                  type={showPassword ? "text" : "password"}
                  placeholder="Your password"
                  autoComplete="current-password"
                  required
                  value={passwordValue}
                  onChange={(e) => setPasswordValue(e.target.value)}
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
            </div>

            {/* Remember me + Forgot password */}
            <div className="remember-forgot-row">
              <div className="check-row mb-0 items-center">
                <input
                  id="keepSignedIn"
                  name="keepSignedIn"
                  type="checkbox"
                  className="checkbox"
                />
                <label
                  htmlFor="keepSignedIn"
                  className="check-label m-auto text-xs"
                >
                  Keep me signed in
                </label>
              </div>
              <Link href="/auth/forgot-password" className="forgot-link">
                Forgot password?
              </Link>
            </div>

            <button
              type="submit"
              className="btn-primary"
              disabled={pending}
              aria-disabled={pending}
            >
              {pending ? "Signing In\u2026" : "Sign In"}
            </button>
          </form>

          <p className="auth-footer mt-lg">
            New to MY Chess Tour?{" "}
            <Link href="/auth/signup">Create an account</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
